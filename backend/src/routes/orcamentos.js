const express = require('express');
const crypto = require('crypto');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

async function sincronizarComissoes(orcamento_id, vendedor_id, projetista_id, valor_final, pct_vendedor, pct_projetista, indicacao, taxa_medicao) {
  await db.run('DELETE FROM comissoes WHERE orcamento_id=$1', [orcamento_id]);

  if (vendedor_id && pct_vendedor > 0) {
    await db.run(`
      INSERT INTO comissoes (tipo, pessoa_id, orcamento_id, valor_pedido, percentual, valor_comissao, status)
      VALUES ('vendedor',$1,$2,$3,$4,$5,'pendente')
    `, [vendedor_id, orcamento_id, valor_final, pct_vendedor, (valor_final * pct_vendedor) / 100]);
  }

  if (projetista_id && pct_projetista > 0) {
    await db.run(`
      INSERT INTO comissoes (tipo, pessoa_id, orcamento_id, valor_pedido, percentual, valor_comissao, status)
      VALUES ('vendedor',$1,$2,$3,$4,$5,'pendente')
    `, [projetista_id, orcamento_id, valor_final, pct_projetista, (valor_final * pct_projetista) / 100]);
  }

  if (indicacao && projetista_id) {
    if (valor_final > 0) {
      await db.run(`
        INSERT INTO comissoes (tipo, pessoa_id, orcamento_id, valor_pedido, percentual, valor_comissao, status)
        VALUES ('vendedor',$1,$2,$3,5,$4,'pendente')
      `, [projetista_id, orcamento_id, valor_final, (valor_final * 5) / 100]);
    }
    if (taxa_medicao > 0) {
      await db.run(`
        INSERT INTO comissoes (tipo, pessoa_id, orcamento_id, valor_pedido, percentual, valor_comissao, status)
        VALUES ('vendedor',$1,$2,$3,0,$3,'pendente')
      `, [projetista_id, orcamento_id, taxa_medicao]);
    }
  }
}

async function gerarNumero() {
  const ultimo = await db.get('SELECT numero FROM orcamentos ORDER BY id DESC LIMIT 1');
  if (!ultimo) return 'ORC-0001';
  const match = ultimo.numero.match(/(\d+)$/);
  if (!match) return 'ORC-' + String(Date.now()).slice(-6);
  return 'ORC-' + String(parseInt(match[1]) + 1).padStart(4, '0');
}

// GET /api/orcamentos
router.get('/', async (req, res) => {
  try {
    const { status, cliente_id, busca } = req.query;
    let sql = `
      SELECT o.*, c.nome as cliente_nome, u.nome as vendedor_nome
      FROM orcamentos o
      LEFT JOIN clientes c ON c.id = o.cliente_id
      LEFT JOIN usuarios u ON u.id = o.vendedor_id
      WHERE o.deleted_at IS NULL
    `;
    const params = [];
    let idx = 1;
    if (status)     { sql += ` AND o.status=$${idx++}`;     params.push(status); }
    if (cliente_id) { sql += ` AND o.cliente_id=$${idx++}`; params.push(cliente_id); }
    if (busca)      {
      sql += ` AND (o.numero ILIKE $${idx} OR c.nome ILIKE $${idx})`;
      params.push(`%${busca}%`); idx++;
    }
    sql += ' ORDER BY o.criado_em DESC';
    res.json(await db.all(sql, params));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar orçamentos' });
  }
});

// GET /api/orcamentos/lixeira  ← deve vir ANTES de /:id
router.get('/lixeira', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT o.*, c.nome as cliente_nome
      FROM orcamentos o
      LEFT JOIN clientes c ON c.id = o.cliente_id
      WHERE o.deleted_at IS NOT NULL
        AND o.deleted_at > NOW() - INTERVAL '15 days'
      ORDER BY o.deleted_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar lixeira' });
  }
});

// POST /api/orcamentos/:id/restaurar  ← antes de /:id para evitar conflito
router.post('/:id/restaurar', async (req, res) => {
  try {
    await db.run(`UPDATE orcamentos SET deleted_at=NULL WHERE id=$1`, [req.params.id]);
    await db.run(`UPDATE pedidos SET deleted_at=NULL WHERE orcamento_id=$1`, [req.params.id]);
    res.json({ mensagem: 'Orçamento restaurado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao restaurar orçamento' });
  }
});

// GET /api/orcamentos/:id
router.get('/:id', async (req, res) => {
  try {
    const o = await db.get(`
      SELECT o.*, c.nome as cliente_nome, c.telefone as cliente_tel, c.whatsapp as cliente_whatsapp,
             c.email as cliente_email, u.nome as vendedor_nome
      FROM orcamentos o
      LEFT JOIN clientes c ON c.id = o.cliente_id
      LEFT JOIN usuarios u ON u.id = o.vendedor_id
      WHERE o.id=$1
    `, [req.params.id]);
    if (!o) return res.status(404).json({ erro: 'Orçamento não encontrado' });
    o.itens = await db.all('SELECT * FROM itens_pedido WHERE orcamento_id=$1 AND pedido_id IS NULL ORDER BY id', [o.id]);
    res.json(o);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar orçamento' });
  }
});

// POST /api/orcamentos
router.post('/', async (req, res) => {
  try {
    const { cliente_id, lead_id, validade_dias, desconto, condicao_pagamento, observacoes, itens = [],
            valor_global, comissao_vendedor, comissao_projetista, projetista_id, indicacao_projetista, taxa_medicao,
            frete, montagem, tipo_projeto, valor_entrada, num_parcelas, data_primeira_parcela,
            dias_projeto, dias_producao, dias_montagem, brindes, campanha } = req.body;
    let { parceiro_id } = req.body;
    if (!cliente_id) return res.status(400).json({ erro: 'Cliente é obrigatório' });

    // Se veio de um lead, registra interação e busca origem/parceiro para rastreabilidade
    if (lead_id) {
      const lead = await db.get('SELECT origem, parceiro_id FROM leads WHERE id=$1', [lead_id]);
      if (lead) {
        if (!parceiro_id && lead.parceiro_id) parceiro_id = lead.parceiro_id;
        await db.run(
          `UPDATE leads SET etapa='orcamento_enviado', atualizado_em=NOW() WHERE id=$1 AND etapa NOT IN ('pedido_confirmado','perdido')`,
          [lead_id]
        );
        await db.run(
          `INSERT INTO lead_interacoes (lead_id, tipo, descricao) VALUES ($1,'orcamento','Orçamento criado')`,
          [lead_id]
        );
      }
    }

    const numero = await gerarNumero();
    const vg = parseFloat(valor_global) || 0;
    const itens_total = itens.reduce((s, i) => s + (parseFloat(i.valor_unitario)||0) * (parseInt(i.quantidade)||1), 0);
    const valor_total = vg + itens_total;
    const desc = parseFloat(desconto) || 0;
    const valor_final = valor_total - desc;

    const client = await db.pool.connect();
    let id;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`
        INSERT INTO orcamentos (numero, cliente_id, lead_id, vendedor_id, valor_global, valor_total, desconto, valor_final,
          condicao_pagamento, validade_dias, observacoes, comissao_vendedor, comissao_projetista, projetista_id, indicacao_projetista, taxa_medicao,
          frete, montagem, tipo_projeto, valor_entrada, num_parcelas, data_primeira_parcela,
          dias_projeto, dias_producao, dias_montagem, brindes, campanha, parceiro_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28) RETURNING id
      `, [numero, cliente_id, lead_id||null, req.usuario.id, vg, valor_total, desc, valor_final,
          condicao_pagamento||null, parseInt(validade_dias)||15, observacoes||null,
          parseFloat(comissao_vendedor)||0, parseFloat(comissao_projetista)||0, projetista_id||null,
          indicacao_projetista ? 1 : 0, parseFloat(taxa_medicao)||0,
          parseFloat(frete)||0, parseFloat(montagem)||0, tipo_projeto||null,
          parseFloat(valor_entrada)||0, parseInt(num_parcelas)||1, data_primeira_parcela||null,
          parseInt(dias_projeto)||7, parseInt(dias_producao)||20, parseInt(dias_montagem)||2,
          JSON.stringify(brindes||[]), campanha||null, parceiro_id||null]);
      id = rows[0].id;

      for (const i of itens) {
        const vt = (parseFloat(i.valor_unitario)||0) * (parseInt(i.quantidade)||1);
        await client.query(`
          INSERT INTO itens_pedido (orcamento_id, ambiente, descricao, material, quantidade, valor_unitario, valor_total, cor, imagem_url)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [id, i.ambiente||null, i.descricao, i.material||null, parseInt(i.quantidade)||1, parseFloat(i.valor_unitario)||0, vt, i.cor||null, i.imagem_url||null]);
      }
      await client.query('COMMIT');
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }

    await sincronizarComissoes(id, req.usuario.id, projetista_id||null, valor_final,
      parseFloat(comissao_vendedor)||0, parseFloat(comissao_projetista)||0,
      indicacao_projetista, parseFloat(taxa_medicao)||0);

    res.status(201).json({ id, numero });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar orçamento' });
  }
});

// PUT /api/orcamentos/:id
router.put('/:id', async (req, res) => {
  try {
    const { validade_dias, desconto, condicao_pagamento, observacoes, itens = [],
            valor_global, comissao_vendedor, comissao_projetista, projetista_id, indicacao_projetista, taxa_medicao,
            frete, montagem, tipo_projeto, valor_entrada, num_parcelas, data_primeira_parcela,
            dias_projeto, dias_producao, dias_montagem, brindes, campanha, parceiro_id } = req.body;
    const vg = parseFloat(valor_global) || 0;
    const itens_total = itens.reduce((s, i) => s + (parseFloat(i.valor_unitario)||0) * (parseInt(i.quantidade)||1), 0);
    const valor_total = vg + itens_total;
    const desc = parseFloat(desconto) || 0;
    const valor_final = valor_total - desc;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        UPDATE orcamentos SET validade_dias=$1, valor_global=$2, desconto=$3, valor_total=$4, valor_final=$5,
          condicao_pagamento=$6, observacoes=$7, comissao_vendedor=$8, comissao_projetista=$9, projetista_id=$10,
          indicacao_projetista=$11, taxa_medicao=$12,
          frete=$13, montagem=$14, tipo_projeto=$15, valor_entrada=$16, num_parcelas=$17, data_primeira_parcela=$18,
          dias_projeto=$19, dias_producao=$20, dias_montagem=$21, brindes=$22, campanha=$23, parceiro_id=$25,
          atualizado_em=NOW() WHERE id=$24
      `, [parseInt(validade_dias)||15, vg, desc, valor_total, valor_final,
          condicao_pagamento||null, observacoes||null,
          parseFloat(comissao_vendedor)||0, parseFloat(comissao_projetista)||0,
          projetista_id||null, indicacao_projetista ? 1 : 0, parseFloat(taxa_medicao)||0,
          parseFloat(frete)||0, parseFloat(montagem)||0, tipo_projeto||null,
          parseFloat(valor_entrada)||0, parseInt(num_parcelas)||1, data_primeira_parcela||null,
          parseInt(dias_projeto)||7, parseInt(dias_producao)||20, parseInt(dias_montagem)||2,
          JSON.stringify(brindes||[]), campanha||null,
          req.params.id, parceiro_id||null]);

      await client.query('DELETE FROM itens_pedido WHERE orcamento_id=$1 AND pedido_id IS NULL', [req.params.id]);
      for (const i of itens) {
        const vt = (parseFloat(i.valor_unitario)||0) * (parseInt(i.quantidade)||1);
        await client.query(`
          INSERT INTO itens_pedido (orcamento_id, ambiente, descricao, material, quantidade, valor_unitario, valor_total, cor, imagem_url)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [req.params.id, i.ambiente||null, i.descricao, i.material||null, parseInt(i.quantidade)||1, parseFloat(i.valor_unitario)||0, vt, i.cor||null, i.imagem_url||null]);
      }
      await client.query('COMMIT');
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }

    const orc = await db.get('SELECT vendedor_id FROM orcamentos WHERE id=$1', [req.params.id]);
    await sincronizarComissoes(parseInt(req.params.id), orc?.vendedor_id, projetista_id||null, valor_final,
      parseFloat(comissao_vendedor)||0, parseFloat(comissao_projetista)||0,
      indicacao_projetista, parseFloat(taxa_medicao)||0);

    res.json({ mensagem: 'Orçamento atualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar orçamento' });
  }
});

// PATCH /api/orcamentos/:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, data_prevista_entrega, prazo_garantia_meses } = req.body;
    const validos = ['rascunho', 'enviado', 'aprovado', 'recusado'];
    if (!validos.includes(status)) return res.status(400).json({ erro: 'Status inválido' });

    await db.run('UPDATE orcamentos SET status=$1, atualizado_em=NOW() WHERE id=$2', [status, req.params.id]);

    if (status === 'aprovado') {
      const orc = await db.get('SELECT * FROM orcamentos WHERE id=$1', [req.params.id]);
      if (orc) {
        // ── Receita prevista no financeiro ──
        try {
          const jaPrevista = await db.get(
            `SELECT id FROM lancamentos WHERE orcamento_id=$1 AND origem='orcamento' LIMIT 1`, [orc.id]
          );
          if (!jaPrevista) {
            const cli = orc.cliente_id
              ? await db.get('SELECT nome FROM clientes WHERE id=$1', [orc.cliente_id])
              : null;
            await db.run(
              `INSERT INTO lancamentos
                (tipo, descricao, valor, data_vencimento, status, orcamento_id, cliente_id, origem)
               VALUES ('receita',$1,$2,$3,'pendente',$4,$5,'orcamento')`,
              [
                `Receita prevista — ${cli?.nome || 'Cliente'} (Orc. #${orc.id})`,
                orc.valor_final || orc.valor_total,
                new Date().toISOString().split('T')[0],
                orc.id,
                orc.cliente_id || null,
              ]
            );
          }
        } catch (e) { console.error('[fin-receita-prevista]', e.message); }

        try {
          const result = await criarPedidoDeOrcamento(orc, { data_prevista_entrega, prazo_garantia_meses });
          return res.json({ mensagem: 'Orçamento aprovado e pedido criado', ...result, auto_criado: !result.ja_existia });
        } catch (err) {
          console.error('[auto-pedido]', err.message);
        }
      }
    }

    res.json({ mensagem: 'Status atualizado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar status' });
  }
});

async function criarPedidoDeOrcamento(orc, opcoes = {}) {
  const { data_prevista_entrega, prazo_garantia_meses = 12 } = opcoes;
  const existente = await db.get('SELECT id FROM pedidos WHERE orcamento_id=$1', [orc.id]);
  if (existente) return { pedido_id: existente.id, ja_existia: true };

  const num   = 'PED-' + String(Date.now()).slice(-6);
  const token = crypto.randomBytes(16).toString('hex');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Busca lead vinculado ao orçamento para propagar origem
  let leadOrigem = null;
  if (orc.lead_id) {
    const lead = await db.get('SELECT origem FROM leads WHERE id=$1', [orc.lead_id]);
    leadOrigem = lead?.origem || null;
  }

  const { rows } = await client.query(`
      INSERT INTO pedidos (numero, orcamento_id, cliente_id, vendedor_id, valor_total, desconto, valor_final,
        condicao_pagamento, data_prevista_entrega, observacoes, token, prazo_garantia_meses,
        lead_id, origem, etapa_producao, etapa_atualizada_em, parceiro_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'novo_pedido',NOW(),$15) RETURNING id
    `, [num, orc.id, orc.cliente_id, orc.vendedor_id, orc.valor_total, orc.desconto,
        orc.valor_final || orc.valor_total, orc.condicao_pagamento,
        data_prevista_entrega||null, orc.observacoes, token, prazo_garantia_meses,
        orc.lead_id || null, leadOrigem, orc.parceiro_id || null]);
    const pedidoId = rows[0].id;

    const itens = await db.all('SELECT * FROM itens_pedido WHERE orcamento_id=$1 AND pedido_id IS NULL', [orc.id]);
    for (const i of itens) {
      await client.query(`
        INSERT INTO itens_pedido (pedido_id, ambiente, descricao, material, quantidade, valor_unitario, valor_total)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [pedidoId, i.ambiente, i.descricao, i.material, i.quantidade, i.valor_unitario, i.valor_total]);
    }
    await client.query('UPDATE orcamentos SET status=$1, atualizado_em=NOW() WHERE id=$2', ['aprovado', orc.id]);
    await client.query('COMMIT');

    // ── Contas a Receber: gera parcelas automaticamente ──
    try {
      const uuidv4 = require('crypto').randomUUID;
      const valorFinal   = +(orc.valor_final || orc.valor_total) || 0;
      const entrada      = +(orc.valor_entrada) || 0;
      const nParcelas    = +(orc.num_parcelas) || 1;
      const grupoId      = uuidv4();
      const hoje         = new Date().toISOString().split('T')[0];
      const dataPrimeira = orc.data_primeira_parcela || hoje;

      // Cancela receita prevista anterior (criada na aprovação do orçamento)
      await db.run(
        `UPDATE lancamentos SET status='cancelado'
         WHERE orcamento_id=$1 AND origem='orcamento' AND status='pendente'`,
        [orc.id]
      );

      const cli = orc.cliente_id
        ? await db.get('SELECT nome FROM clientes WHERE id=$1', [orc.cliente_id])
        : null;
      const nomeCliente = cli?.nome || 'Cliente';

      // Lançamento de entrada
      if (entrada > 0) {
        await db.run(
          `INSERT INTO lancamentos
            (tipo, descricao, valor, data_vencimento, status, pedido_id, orcamento_id,
             cliente_id, origem, parcela_num, parcela_total, grupo_parcela_id)
           VALUES ('receita',$1,$2,$3,'pendente',$4,$5,$6,'pedido',0,$7,$8)`,
          [`Entrada — ${nomeCliente} (Ped. ${num})`, entrada, hoje,
           pedidoId, orc.id, orc.cliente_id || null, nParcelas + 1, grupoId]
        );
      }

      // Parcelas mensais
      const valorParcela = +((valorFinal - entrada) / nParcelas).toFixed(2);
      const baseDate     = new Date(dataPrimeira + 'T12:00:00');
      for (let i = 0; i < nParcelas; i++) {
        const d = new Date(baseDate);
        d.setMonth(d.getMonth() + i);
        const venc = d.toISOString().split('T')[0];
        await db.run(
          `INSERT INTO lancamentos
            (tipo, descricao, valor, data_vencimento, status, pedido_id, orcamento_id,
             cliente_id, origem, parcela_num, parcela_total, grupo_parcela_id)
           VALUES ('receita',$1,$2,$3,'pendente',$4,$5,$6,'pedido',$7,$8,$9)`,
          [`${nomeCliente} — Parcela ${i+1}/${nParcelas} (Ped. ${num})`,
           valorParcela, venc, pedidoId, orc.id, orc.cliente_id || null,
           i + 1, nParcelas, grupoId]
        );
      }
    } catch (e) { console.error('[fin-parcelas]', e.message); }

    // ── Comissão do parceiro indicador: gerada automaticamente quando o
    // orçamento vinculado a um parceiro vira pedido, rastreando indicação → venda ──
    if (orc.parceiro_id) {
      try {
        const parc = await db.get('SELECT nome, percentual_comissao FROM parceiros WHERE id=$1', [orc.parceiro_id]);
        const valorFinalComissao = +(orc.valor_final || orc.valor_total) || 0;
        const percentual = +(parc?.percentual_comissao) || 0;
        if (parc && percentual > 0 && valorFinalComissao > 0) {
          const valorComissao = +(valorFinalComissao * percentual / 100).toFixed(2);
          await db.run(`
            INSERT INTO comissoes (tipo, pessoa_id, pedido_id, orcamento_id, valor_pedido, percentual, valor_comissao, status)
            VALUES ('parceiro',$1,$2,$3,$4,$5,$6,'pendente')
          `, [orc.parceiro_id, pedidoId, orc.id, valorFinalComissao, percentual, valorComissao]);
          await db.run(
            `INSERT INTO parc_historico (parceiro_id, tipo, descricao) VALUES ($1,'venda',$2)`,
            [orc.parceiro_id, `Venda gerada — Pedido ${num} (R$ ${valorFinalComissao.toLocaleString('pt-BR',{minimumFractionDigits:2})}) — comissão de R$ ${valorComissao.toLocaleString('pt-BR',{minimumFractionDigits:2})} pendente`]
          );
        }
      } catch (e) { console.error('[comissao-parceiro]', e.message); }
    }

    return { pedido_id: pedidoId, numero: num, token };
  } catch(e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
}

// POST /api/orcamentos/:id/converter
router.post('/:id/converter', async (req, res) => {
  try {
    const orc = await db.get('SELECT * FROM orcamentos WHERE id=$1', [req.params.id]);
    if (!orc) return res.status(404).json({ erro: 'Orçamento não encontrado' });
    if (orc.status !== 'aprovado') return res.status(400).json({ erro: 'Orçamento precisa estar aprovado para converter' });
    const result = await criarPedidoDeOrcamento(orc, req.body);
    res.status(result.ja_existia ? 200 : 201).json({ mensagem: result.ja_existia ? 'Pedido já existe' : 'Pedido criado', ...result });
  } catch(err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE /api/orcamentos/:id  — soft delete em cascata
router.delete('/:id', async (req, res) => {
  try {
    const orc = await db.get('SELECT id FROM orcamentos WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!orc) return res.status(404).json({ erro: 'Orçamento não encontrado' });

    await db.run(`UPDATE orcamentos SET deleted_at=NOW() WHERE id=$1`, [req.params.id]);
    // Apaga o pedido vinculado junto (se existir)
    await db.run(`UPDATE pedidos SET deleted_at=NOW() WHERE orcamento_id=$1 AND deleted_at IS NULL`, [req.params.id]);

    res.json({ mensagem: 'Orçamento movido para a lixeira' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao remover orçamento' });
  }
});

module.exports = router;
