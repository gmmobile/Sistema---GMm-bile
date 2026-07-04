const express = require('express');
const db = require('../utils/db');

const router = express.Router();

// Rota pública — sem autenticação
router.get('/pedido/:token', async (req, res) => {
  try {
    const pedido = await db.get(`
      SELECT p.id, p.numero, p.status, p.etapa_producao,
             p.data_prevista_entrega, p.data_entrega_real,
             p.valor_final, p.condicao_pagamento, p.observacoes,
             p.prazo_garantia_meses, p.criado_em,
             c.nome AS cliente_nome,
             conf.nome_empresa, conf.logo_path, conf.cor_primaria, conf.telefone, conf.whatsapp
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      LEFT JOIN configuracoes_loja conf ON conf.id = 1
      WHERE p.token = $1
    `, [req.params.token]);

    if (!pedido) return res.status(404).json({ erro: 'Link inválido ou pedido não encontrado' });

    const itens = await db.all(`
      SELECT ambiente, descricao, quantidade, valor_unitario, valor_total
      FROM itens_pedido WHERE pedido_id = $1
    `, [pedido.id]);

    res.json({ ...pedido, itens });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar pedido' });
  }
});

module.exports = router;
