/* ════════════════════════════════════════════════════════════════
   CORA — emissão de boleto/PIX, consulta/cancelamento de cobranças,
   webhook de confirmação de pagamento e endpoint de sincronização
   de extrato para uso pelo Vercel Cron.

   IMPORTANTE: o webhook do Cora não tem assinatura documentada (ver
   plano) — a segurança da rota /webhook/:secret é o próprio segredo
   no path (CORA_WEBHOOK_SECRET), não um JWT de usuário. Por isso
   este router NÃO aplica autenticar() globalmente como os demais;
   cada rota decide sua própria autenticação.
   ════════════════════════════════════════════════════════════════ */
const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');
const coraService = require('../services/coraService');
const conciliacaoRoute = require('./conciliacao');

const router = express.Router();

const n = v => parseFloat(v) || 0;

/* ── Rotas autenticadas (uso normal do ERP, dentro do app) ── */
const autenticado = express.Router();
autenticado.use(autenticar);

autenticado.post('/boletos', async (req, res) => {
  await emitir(req, res, ['BANK_SLIP']);
});

autenticado.post('/pix', async (req, res) => {
  await emitir(req, res, ['PIX']);
});

async function emitir(req, res, paymentForms) {
  try {
    const { lancamento_id } = req.body;
    if (!lancamento_id) return res.status(400).json({ erro: 'lancamento_id é obrigatório' });

    const lanc = await db.get(`SELECT * FROM lancamentos WHERE id=$1`, [lancamento_id]);
    if (!lanc) return res.status(404).json({ erro: 'Lançamento não encontrado' });
    if (!lanc.cliente_id) return res.status(400).json({ erro: 'Lançamento sem cliente vinculado — não é possível emitir cobrança' });

    const cliente = await db.get(`SELECT * FROM clientes WHERE id=$1`, [lanc.cliente_id]);
    if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });
    if (!cliente.cpf_cnpj) return res.status(400).json({ erro: 'Cliente sem CPF/CNPJ cadastrado — obrigatório para emitir cobrança' });

    const resp = await coraService.emitirCobranca({
      cliente: { nome: cliente.nome, email: cliente.email, documento: cliente.cpf_cnpj },
      valorCentavos: Math.round(n(lanc.valor) * 100),
      descricao: lanc.descricao,
      vencimento: lanc.data_vencimento,
      paymentForms,
    });

    const tipo = paymentForms.includes('BANK_SLIP') ? 'boleto' : 'pix';
    const id = await db.insert(
      `INSERT INTO cora_cobrancas (lancamento_id, cliente_id, cora_id, tipo, status, valor, vencimento,
         linha_digitavel, codigo_barras, qr_code_pix, payload_bruto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [lancamento_id, cliente.id, resp.id, tipo, (resp.status || 'emitido').toLowerCase(),
       n(lanc.valor), lanc.data_vencimento,
       resp.payment_options?.bank_slip?.digitable || null,
       resp.payment_options?.bank_slip?.barcode || null,
       resp.pix?.emv || null,
       JSON.stringify(resp)]
    );

    res.status(201).json({
      id, cora_id: resp.id,
      linha_digitavel: resp.payment_options?.bank_slip?.digitable || null,
      codigo_barras: resp.payment_options?.bank_slip?.barcode || null,
      boleto_url: resp.payment_options?.bank_slip?.url || null,
      qr_code_pix: resp.pix?.emv || null,
    });
  } catch (err) {
    console.error('[cora emitir]', err.message);
    res.status(500).json({ erro: 'Erro ao emitir cobrança no Cora: ' + err.message });
  }
}

autenticado.get('/cobrancas', async (req, res) => {
  try {
    const { lancamento_id } = req.query;
    let sql = `SELECT * FROM cora_cobrancas`;
    const params = [];
    if (lancamento_id) { sql += ` WHERE lancamento_id=$1`; params.push(lancamento_id); }
    sql += ` ORDER BY criado_em DESC`;
    res.json(await db.all(sql, params));
  } catch (err) {
    console.error('[cora cobrancas GET]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

autenticado.post('/cobrancas/:id/cancelar', async (req, res) => {
  try {
    const cob = await db.get(`SELECT * FROM cora_cobrancas WHERE id=$1`, [req.params.id]);
    if (!cob) return res.status(404).json({ erro: 'Cobrança não encontrada' });
    if (cob.status === 'pago') return res.status(409).json({ erro: 'Não é possível cancelar uma cobrança já paga' });

    await coraService.cancelarCobranca(cob.cora_id);
    await db.run(`UPDATE cora_cobrancas SET status='cancelado' WHERE id=$1`, [req.params.id]);
    res.json({ mensagem: 'Cobrança cancelada' });
  } catch (err) {
    console.error('[cora cancelar]', err.message);
    res.status(500).json({ erro: 'Erro ao cancelar no Cora: ' + err.message });
  }
});

/* ── Sincronização de extrato sob demanda pelo Vercel Cron ──
   Autenticação por segredo compartilhado, não JWT de usuário. A Vercel
   injeta automaticamente o header "Authorization: Bearer $CRON_SECRET"
   em toda chamada disparada pelo Cron quando essa env var existe —
   por isso usamos CRON_SECRET (convenção da própria Vercel), não um
   nome específico do Cora. */
router.get('/cron/sincronizar-extrato', async (req, res) => {
  try {
    const segredo = req.header('Authorization');
    if (!process.env.CRON_SECRET || segredo !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ erro: 'Não autorizado' });
    }
    const contaId = req.query.conta_id || process.env.CORA_CONTA_ID_PADRAO;
    if (!contaId) return res.status(400).json({ erro: 'conta_id não informado (nem CORA_CONTA_ID_PADRAO configurado)' });

    const resultado = await conciliacaoRoute.sincronizarExtratoCora(contaId, req.query.dias || 2);
    res.json(resultado);
  } catch (err) {
    console.error('[cora cron sincronizar-extrato]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ── Webhook — recebido do Cora. Corpo vem VAZIO; os dados relevantes
   (tipo de evento, id do recurso) vêm nos headers. A rota confirma o
   status real chamando a API do Cora de volta, não confia em nada do
   corpo da requisição (nem existe corpo). Autenticação: segredo no
   path (CORA_WEBHOOK_SECRET) — o Cora não documenta assinatura HMAC. ══ */
router.post('/webhook/:secret', async (req, res) => {
  try {
    if (!process.env.CORA_WEBHOOK_SECRET || req.params.secret !== process.env.CORA_WEBHOOK_SECRET) {
      return res.status(404).end(); // não revela existência da rota pra quem não tem o segredo
    }

    const tipoEvento = req.header('webhook-event-type') || null;
    const resourceId = req.header('webhook-resource-id') || null;

    await db.run(
      `INSERT INTO cora_webhook_log (tipo_evento, payload) VALUES ($1,$2)`,
      [tipoEvento, JSON.stringify({ headers: req.headers, resourceId })]
    );

    // Responde rápido pro Cora (evita retry desnecessário); processa depois.
    res.json({ success: true });

    if (tipoEvento && tipoEvento.startsWith('invoice.') && resourceId) {
      try {
        const detalhe = await coraService.consultarCobranca(resourceId);
        const statusCora = (detalhe.status || '').toUpperCase();
        const cob = await db.get(`SELECT * FROM cora_cobrancas WHERE cora_id=$1`, [resourceId]);
        if (cob) {
          const novoStatus = statusCora === 'PAID' ? 'pago' : statusCora === 'CANCELLED' ? 'cancelado' : statusCora === 'LATE' ? 'vencido' : cob.status;
          await db.run(
            `UPDATE cora_cobrancas SET status=$1, payload_bruto=$2, pago_em=CASE WHEN $1='pago' THEN NOW() ELSE pago_em END WHERE id=$3`,
            [novoStatus, JSON.stringify(detalhe), cob.id]
          );
          if (novoStatus === 'pago' && cob.lancamento_id) {
            await db.run(
              `UPDATE lancamentos SET status='pago', data_pagamento=COALESCE(data_pagamento, CURRENT_DATE::text) WHERE id=$1 AND status<>'pago'`,
              [cob.lancamento_id]
            );
          }
        }
        await db.run(`UPDATE cora_webhook_log SET processado=true WHERE tipo_evento=$1 AND payload->>'resourceId'=$2 AND processado=false`, [tipoEvento, resourceId]);
      } catch (e) {
        console.error('[cora webhook processamento]', e.message);
        await db.run(`UPDATE cora_webhook_log SET erro=$1 WHERE tipo_evento=$2 AND payload->>'resourceId'=$3 AND processado=false`, [e.message, tipoEvento, resourceId]);
      }
    }
  } catch (err) {
    console.error('[cora webhook]', err.message);
    if (!res.headersSent) res.status(500).json({ erro: err.message });
  }
});

router.use(autenticado);

module.exports = router;
