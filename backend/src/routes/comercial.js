const express = require('express');
const crypto = require('crypto');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

// ── ORÇAMENTOS ──

router.get('/orcamentos', async (req, res) => {
  try {
    const { status, busca } = req.query;
    let sql = `
      SELECT o.*, c.nome as cliente_nome, u.nome as vendedor_nome
      FROM orcamentos o
      LEFT JOIN clientes c ON c.id = o.cliente_id
      LEFT JOIN usuarios u ON u.id = o.vendedor_id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;
    if (status) { sql += ` AND o.status = $${idx++}`; params.push(status); }
    if (busca)  {
      sql += ` AND (c.nome ILIKE $${idx} OR o.numero ILIKE $${idx})`;
      params.push(`%${busca}%`); idx++;
    }
    sql += ` ORDER BY o.criado_em DESC`;
    res.json(await db.all(sql, params));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar orçamentos' });
  }
});

router.get('/orcamentos/:id', async (req, res) => {
  try {
    const orc = await db.get(`
      SELECT o.*, c.nome as cliente_nome, u.nome as vendedor_nome
      FROM orcamentos o
      LEFT JOIN clientes c ON c.id = o.cliente_id
      LEFT JOIN usuarios u ON u.id = o.vendedor_id
      WHERE o.id = $1
    `, [req.params.id]);
    if (!orc) return res.status(404).json({ erro: 'Orçamento não encontrado' });
    const itens = await db.all('SELECT * FROM itens_pedido WHERE orcamento_id = $1', [req.params.id]);
    res.json({ ...orc, itens });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar orçamento' });
  }
});

router.post('/orcamentos', async (req, res) => {
  try {
    const { cliente_id, lead_id, vendedor_id, condicao_pagamento, validade_dias, observacoes, itens = [] } = req.body;

    const num = 'ORC-' + String(Date.now()).slice(-6);
    const desconto = req.body.desconto || 0;
    const valor_total = itens.reduce((s, i) => s + ((parseFloat(i.valor_unitario)||0) * (parseInt(i.quantidade)||1)), 0);
    const valor_final = valor_total - desconto;

    const id = await db.insert(`
      INSERT INTO orcamentos (numero, cliente_id, lead_id, vendedor_id, valor_total, desconto, valor_final,
        condicao_pagamento, validade_dias, observacoes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [num, cliente_id, lead_id, vendedor_id || req.usuario.id, valor_total, desconto, valor_final,
        condicao_pagamento, validade_dias || 15, observacoes]);

    for (const i of itens) {
      await db.run(`
        INSERT INTO itens_pedido (orcamento_id, ambiente, descricao, material, quantidade, valor_unitario, valor_total)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [id, i.ambiente, i.descricao, i.material, i.quantidade, i.valor_unitario,
          (parseFloat(i.valor_unitario)||0) * (parseInt(i.quantidade)||1)]);
    }

    res.status(201).json({ id, numero: num });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar orçamento' });
  }
});

router.put('/orcamentos/:id', async (req, res) => {
  try {
    const { cliente_id, condicao_pagamento, validade_dias, observacoes, desconto = 0, itens = [] } = req.body;
    const valor_total = itens.reduce((s, i) => s + ((parseFloat(i.valor_unitario)||0) * (parseInt(i.quantidade)||1)), 0);
    const valor_final = valor_total - desconto;

    await db.run(`
      UPDATE orcamentos SET cliente_id=$1, condicao_pagamento=$2, validade_dias=$3,
        observacoes=$4, desconto=$5, valor_total=$6, valor_final=$7, atualizado_em=NOW()
      WHERE id=$8
    `, [cliente_id, condicao_pagamento, validade_dias, observacoes, desconto, valor_total, valor_final, req.params.id]);

    await db.run('DELETE FROM itens_pedido WHERE orcamento_id = $1', [req.params.id]);
    for (const i of itens) {
      await db.run(`
        INSERT INTO itens_pedido (orcamento_id, ambiente, descricao, material, quantidade, valor_unitario, valor_total)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [req.params.id, i.ambiente, i.descricao, i.material, i.quantidade, i.valor_unitario,
          (parseFloat(i.valor_unitario)||0) * (parseInt(i.quantidade)||1)]);
    }

    res.json({ mensagem: 'Orçamento atualizado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar orçamento' });
  }
});

router.put('/orcamentos/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const STATUS_ORC = ['rascunho','enviado','aprovado','recusado','expirado'];
    if (!status || !STATUS_ORC.includes(status))
      return res.status(400).json({ erro: 'Status inválido' });

    const ant = await db.get('SELECT status FROM orcamentos WHERE id=$1', [req.params.id]);
    if (!ant) return res.status(404).json({ erro: 'Orçamento não encontrado' });

    await db.run('UPDATE orcamentos SET status=$1, atualizado_em=NOW() WHERE id=$2', [status, req.params.id]);
    await db.run(
      `INSERT INTO historico_orcamentos (orcamento_id, usuario_id, usuario_nome, descricao) VALUES ($1,$2,$3,$4)`,
      [req.params.id, req.usuario?.id, req.usuario?.nome, `Status alterado de "${ant?.status||'?'}" para "${status}"`]
    );
    res.json({ mensagem: 'Status atualizado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar status' });
  }
});

router.get('/orcamentos/:id/historico', async (req, res) => {
  try {
    const historico = await db.all(
      'SELECT * FROM historico_orcamentos WHERE orcamento_id = $1 ORDER BY criado_em DESC',
      [req.params.id]
    );
    res.json(historico);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar histórico' });
  }
});

router.post('/orcamentos/:id/converter-pedido', async (req, res) => {
  try {
    const orc = await db.get('SELECT * FROM orcamentos WHERE id = $1', [req.params.id]);
    if (!orc) return res.status(404).json({ erro: 'Orçamento não encontrado' });

    const { data_prevista_entrega, prazo_garantia_meses = 12, parcelas = [] } = req.body;
    const num = 'PED-' + String(Date.now()).slice(-6);
    const token = crypto.randomBytes(16).toString('hex');

    const pedidoId = await db.insert(`
      INSERT INTO pedidos (numero, orcamento_id, cliente_id, vendedor_id, valor_total, desconto, valor_final,
        condicao_pagamento, data_prevista_entrega, observacoes, token, prazo_garantia_meses)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `, [num, orc.id, orc.cliente_id, orc.vendedor_id, orc.valor_total, orc.desconto, orc.valor_final,
        orc.condicao_pagamento, data_prevista_entrega, orc.observacoes, token, prazo_garantia_meses]);

    const itens = await db.all('SELECT * FROM itens_pedido WHERE orcamento_id = $1', [orc.id]);
    for (const i of itens) {
      await db.run(`
        INSERT INTO itens_pedido (pedido_id, ambiente, descricao, material, quantidade, valor_unitario, valor_total)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [pedidoId, i.ambiente, i.descricao, i.material, i.quantidade, i.valor_unitario, i.valor_total]);
    }

    await db.run('UPDATE orcamentos SET status=$1, atualizado_em=NOW() WHERE id=$2', ['aprovado', orc.id]);

    for (let i = 0; i < parcelas.length; i++) {
      const p = parcelas[i];
      const desc = parcelas.length === 1
        ? `Pagamento – ${num}`
        : `Parcela ${i+1}/${parcelas.length} – ${num}`;
      await db.run(`
        INSERT INTO lancamentos (descricao, tipo, valor, status, data_vencimento, pedido_id)
        VALUES ($1,'receita',$2,'pendente',$3,$4)
      `, [desc, p.valor, p.data_vencimento, pedidoId]);
    }

    await db.run(
      `INSERT INTO historico_orcamentos (orcamento_id, usuario_id, usuario_nome, descricao) VALUES ($1,$2,$3,$4)`,
      [orc.id, req.usuario?.id, req.usuario?.nome, `Convertido em pedido ${num}`]
    );

    res.status(201).json({ id: pedidoId, numero: num, token, mensagem: 'Pedido criado com sucesso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao converter orçamento' });
  }
});

// ── PEDIDOS ──

router.get('/pedidos', async (req, res) => {
  try {
    const { status, busca } = req.query;
    let sql = `
      SELECT p.*, c.nome as cliente_nome, c.whatsapp as cliente_whatsapp,
             c.telefone as cliente_tel, u.nome as vendedor_nome
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      LEFT JOIN usuarios u ON u.id = p.vendedor_id
      WHERE p.deleted_at IS NULL
    `;
    const params = [];
    let idx = 1;
    if (status) { sql += ` AND p.status = $${idx++}`; params.push(status); }
    if (busca)  {
      sql += ` AND (c.nome ILIKE $${idx} OR p.numero ILIKE $${idx})`;
      params.push(`%${busca}%`); idx++;
    }
    sql += ` ORDER BY p.criado_em DESC`;
    res.json(await db.all(sql, params));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar pedidos' });
  }
});

// GET /api/comercial/pedidos/lixeira  ← antes de /pedidos/:id
router.get('/pedidos/lixeira', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT p.*, c.nome as cliente_nome
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.deleted_at IS NOT NULL
        AND p.deleted_at > NOW() - INTERVAL '15 days'
      ORDER BY p.deleted_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar lixeira de pedidos' });
  }
});

// POST /api/comercial/pedidos/:id/restaurar  ← antes de /pedidos/:id
router.post('/pedidos/:id/restaurar', async (req, res) => {
  try {
    await db.run(`UPDATE pedidos SET deleted_at=NULL WHERE id=$1`, [req.params.id]);
    const pedido = await db.get('SELECT orcamento_id FROM pedidos WHERE id=$1', [req.params.id]);
    if (pedido?.orcamento_id) {
      await db.run(`UPDATE orcamentos SET deleted_at=NULL WHERE id=$1`, [pedido.orcamento_id]);
    }
    res.json({ mensagem: 'Pedido restaurado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao restaurar pedido' });
  }
});

router.get('/pedidos/:id', async (req, res) => {
  try {
    const pedido = await db.get(`
      SELECT p.*, c.nome as cliente_nome, c.telefone as cliente_telefone,
             c.whatsapp as cliente_whatsapp, u.nome as vendedor_nome
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      LEFT JOIN usuarios u ON u.id = p.vendedor_id
      WHERE p.id = $1
    `, [req.params.id]);
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });
    const itens = await db.all('SELECT * FROM itens_pedido WHERE pedido_id = $1', [req.params.id]);
    res.json({ ...pedido, itens });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar pedido' });
  }
});

router.put('/pedidos/:id', async (req, res) => {
  try {
    const { data_prevista_entrega, valor_total, desconto = 0, condicao_pagamento,
            observacoes, prazo_garantia_meses, itens = [] } = req.body;

    const valor_final = (parseFloat(valor_total)||0) - (parseFloat(desconto)||0);

    await db.run(`
      UPDATE pedidos SET
        data_prevista_entrega=$1, valor_total=$2, desconto=$3, valor_final=$4,
        condicao_pagamento=$5, observacoes=$6, prazo_garantia_meses=$7, atualizado_em=NOW()
      WHERE id=$8
    `, [data_prevista_entrega||null, parseFloat(valor_total)||0, parseFloat(desconto)||0,
        valor_final, condicao_pagamento, observacoes, prazo_garantia_meses||12, req.params.id]);

    if (itens.length) {
      await db.run('DELETE FROM itens_pedido WHERE pedido_id = $1', [req.params.id]);
      for (const i of itens) {
        await db.run(`
          INSERT INTO itens_pedido (pedido_id, ambiente, descricao, material, quantidade, valor_unitario, valor_total)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
        `, [req.params.id, i.ambiente, i.descricao, i.material, i.quantidade, i.valor_unitario,
            (parseFloat(i.valor_unitario)||0) * (parseInt(i.quantidade)||1)]);
      }
    }

    res.json({ mensagem: 'Pedido atualizado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar pedido' });
  }
});

router.put('/pedidos/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const STATUS_PED = ['confirmado','medicao','projeto','producao','pronto','entrega','instalacao','concluido','cancelado'];
    if (!status || !STATUS_PED.includes(status))
      return res.status(400).json({ erro: 'Status inválido' });

    const STATUS_ETAPA = {
      confirmado: 'medicao', medicao: 'medicao', projeto: 'projeto',
      producao: 'producao', pronto: 'producao',
      entrega: 'entrega', instalacao: 'instalacao',
    };
    const novaEtapa = STATUS_ETAPA[status] || null;

    let sql = 'UPDATE pedidos SET status=$1, atualizado_em=NOW()';
    const params = [status];
    let idx = 2;

    if (status === 'concluido') { sql += `, data_entrega_real=NOW()`; }
    if (novaEtapa) { sql += `, etapa_producao=$${idx++}, etapa_atualizada_em=NOW()`; params.push(novaEtapa); }

    sql += ` WHERE id=$${idx}`;
    params.push(req.params.id);

    await db.run(sql, params);

    const pedido = await db.get(`
      SELECT p.numero, c.nome AS cliente_nome, c.whatsapp AS cliente_whatsapp,
             conf.nome_empresa, p.token
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      LEFT JOIN configuracoes_loja conf ON conf.id = 1
      WHERE p.id = $1
    `, [req.params.id]);

    const LABELS = {
      producao: 'entrou em produção', instalacao: 'está pronto para instalação',
      entrega: 'foi entregue', concluido: 'foi concluído', cancelado: 'foi cancelado'
    };

    let whatsappLink = null;
    if (pedido?.cliente_whatsapp) {
      const fone = pedido.cliente_whatsapp.replace(/\D/g, '');
      const label = LABELS[status] || `teve status alterado para "${status}"`;
      const msg = encodeURIComponent(
        `Olá ${pedido.cliente_nome}! Seu pedido *${pedido.numero}* ${label}.\n\n` +
        `🔗 Acompanhe: ${process.env.BASE_URL||'http://localhost:3000'}/pages/portal-cliente.html?token=${pedido.token}\n\n` +
        `— ${pedido.nome_empresa || 'Nossa empresa'}`
      );
      whatsappLink = `https://wa.me/55${fone}?text=${msg}`;
    }

    res.json({ mensagem: 'Status atualizado', whatsappLink });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar status' });
  }
});

router.put('/pedidos/:id/prazo', async (req, res) => {
  try {
    const { data_prevista_entrega } = req.body;
    if (!data_prevista_entrega || !/^\d{4}-\d{2}-\d{2}$/.test(data_prevista_entrega))
      return res.status(400).json({ erro: 'Data inválida. Use o formato AAAA-MM-DD.' });

    const pedido = await db.get('SELECT id FROM pedidos WHERE id=$1', [req.params.id]);
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });

    await db.run('UPDATE pedidos SET data_prevista_entrega=$1, atualizado_em=NOW() WHERE id=$2',
      [data_prevista_entrega, req.params.id]);
    res.json({ mensagem: 'Prazo atualizado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar prazo' });
  }
});

// DELETE /api/comercial/pedidos/:id — soft delete em cascata
router.delete('/pedidos/:id', async (req, res) => {
  try {
    const pedido = await db.get('SELECT id, orcamento_id FROM pedidos WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });

    await db.run(`UPDATE pedidos SET deleted_at=NOW() WHERE id=$1`, [req.params.id]);
    // Apaga o orçamento vinculado também
    if (pedido.orcamento_id) {
      await db.run(`UPDATE orcamentos SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL`, [pedido.orcamento_id]);
    }
    res.json({ mensagem: 'Pedido movido para a lixeira' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao remover pedido' });
  }
});

module.exports = router;
