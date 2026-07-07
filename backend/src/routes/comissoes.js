const express = require('express');
const db = require('../utils/db');
const { autenticar, autorizar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

router.get('/', async (req, res) => {
  try {
    const { status, tipo } = req.query;
    let sql = `SELECT c.*, p.numero as pedido_numero, o.numero as orcamento_numero
               FROM comissoes c
               LEFT JOIN pedidos p ON p.id = c.pedido_id
               LEFT JOIN orcamentos o ON o.id = c.orcamento_id
               WHERE 1=1`;
    const params = [];
    let idx = 1;
    if (status) { sql += ` AND c.status = $${idx++}`; params.push(status); }
    if (tipo)   { sql += ` AND c.tipo = $${idx++}`;   params.push(tipo); }
    sql += ' ORDER BY c.data_geracao DESC';
    const rows = await db.all(sql, params);

    const com = await Promise.all(rows.map(async r => {
      let nome = '—';
      if (r.tipo === 'vendedor') {
        const u = await db.get('SELECT nome FROM usuarios WHERE id=$1', [r.pessoa_id]);
        nome = u?.nome || '—';
      } else {
        const p = await db.get('SELECT nome FROM parceiros WHERE id=$1', [r.pessoa_id]);
        nome = p?.nome || '—';
      }
      return { ...r, pessoa_nome: nome };
    }));

    res.json(com);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar comissões' });
  }
});

router.post('/', autorizar('gestor','financeiro'), async (req, res) => {
  try {
    const { tipo, pessoa_id, pedido_id, valor_pedido, percentual } = req.body;
    if (!tipo || !pessoa_id || !valor_pedido || !percentual)
      return res.status(400).json({ erro: 'Campos obrigatórios faltando' });
    const vpNum = parseFloat(valor_pedido);
    const percNum = parseFloat(percentual);
    if (isNaN(vpNum) || vpNum <= 0) return res.status(400).json({ erro: 'Valor do pedido deve ser positivo' });
    if (isNaN(percNum) || percNum <= 0 || percNum > 100) return res.status(400).json({ erro: 'Percentual inválido (0-100)' });
    const valor_comissao = (vpNum * percNum) / 100;
    const id = await db.insert(`
      INSERT INTO comissoes (tipo, pessoa_id, pedido_id, valor_pedido, percentual, valor_comissao)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [tipo, pessoa_id, pedido_id||null, vpNum, percNum, valor_comissao]);
    res.status(201).json({ id, valor_comissao });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao criar comissão' });
  }
});

router.put('/:id/pagar', autorizar('gestor','financeiro'), async (req, res) => {
  try {
    const { forma_pagamento } = req.body;
    const com = await db.get('SELECT * FROM comissoes WHERE id=$1', [req.params.id]);
    if (!com) return res.status(404).json({ erro: 'Comissão não encontrada' });

    const hoje = new Date().toISOString().split('T')[0];
    await db.run(`UPDATE comissoes SET status='pago', data_pagamento=$1, forma_pagamento=$2 WHERE id=$3`,
      [hoje, forma_pagamento||null, req.params.id]);

    let descPessoa = com.tipo, parceiroId = null;
    if (com.tipo === 'parceiro') {
      const p = await db.get('SELECT nome FROM parceiros WHERE id=$1', [com.pessoa_id]);
      descPessoa = p?.nome || 'Parceiro';
      parceiroId = com.pessoa_id;
    }

    await db.run(`
      INSERT INTO lancamentos (tipo, descricao, valor, data_vencimento, data_pagamento, status, forma_pagamento, parceiro_id, pedido_id)
      VALUES ('despesa',$1,$2,$3,$3,'pago',$4,$5,$6)
    `, [`Comissão — ${descPessoa} (Ped. ${com.pedido_id||'—'})`, com.valor_comissao, hoje, forma_pagamento||null, parceiroId, com.pedido_id||null]);

    if (parceiroId) {
      await db.run(
        `INSERT INTO parc_historico (parceiro_id, tipo, descricao) VALUES ($1,'comissao_paga',$2)`,
        [parceiroId, `Comissão de R$ ${(+com.valor_comissao).toLocaleString('pt-BR',{minimumFractionDigits:2})} paga`]
      );
    }

    res.json({ mensagem: 'Comissão paga e lançada no financeiro' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao pagar comissão' });
  }
});

module.exports = router;
