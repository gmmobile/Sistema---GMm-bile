const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

router.get('/', async (req, res) => {
  try {
    const { pedido_id } = req.query;
    if (!pedido_id) return res.status(400).json({ erro: 'pedido_id obrigatório' });
    const rows = await db.all(`
      SELECT c.*, u.nome as usuario_nome
      FROM cobrancas c
      LEFT JOIN usuarios u ON u.id = c.usuario_id
      WHERE c.pedido_id = $1
      ORDER BY c.data_cobranca DESC, c.criado_em DESC
    `, [pedido_id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar cobranças' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { pedido_id, observacao, data_cobranca } = req.body;
    if (!pedido_id || !observacao)
      return res.status(400).json({ erro: 'pedido_id e observacao são obrigatórios' });
    const data = data_cobranca || new Date().toISOString().split('T')[0];
    const id = await db.insert(
      'INSERT INTO cobrancas (pedido_id, observacao, data_cobranca, usuario_id) VALUES ($1,$2,$3,$4)',
      [pedido_id, observacao, data, req.usuario.id]
    );
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao registrar cobrança' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM cobrancas WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Registro removido' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover cobrança' });
  }
});

module.exports = router;
