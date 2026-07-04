const express = require('express');
const db = require('../utils/db');
const { autenticar, autorizar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

// GET /api/metas/vendedores
router.get('/vendedores', async (req, res) => {
  try {
    const v = await db.all(`SELECT id, nome FROM usuarios WHERE perfil IN ('vendedor','gestor') AND ativo=1 ORDER BY nome`);
    res.json(v);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar vendedores' });
  }
});

// GET /api/metas/ranking
router.get('/ranking', async (req, res) => {
  try {
    const hoje = new Date();
    const mes = req.query.mes || String(hoje.getMonth()+1).padStart(2,'0');
    const ano = req.query.ano || String(hoje.getFullYear());
    const mesAno = `${ano}-${mes}`;

    const vendedores = await db.all(`
      SELECT u.id, u.nome,
        COALESCE(SUM(p.valor_final),0) as total_vendido,
        COUNT(p.id) as qtd_pedidos,
        COALESCE(AVG(p.valor_final),0) as ticket_medio
      FROM usuarios u
      LEFT JOIN pedidos p ON p.vendedor_id = u.id
        AND p.status NOT IN ('cancelado')
        AND p.valor_final IS NOT NULL AND p.valor_final > 0
        AND TO_CHAR(p.criado_em,'YYYY-MM') = $1
      WHERE u.ativo = 1
      GROUP BY u.id, u.nome
      ORDER BY total_vendido DESC
    `, [mesAno]);

    const comMeta = await Promise.all(vendedores.map(async (v, i) => {
      const meta = await db.get('SELECT valor_meta FROM metas WHERE vendedor_id=$1 AND mes=$2 AND ano=$3',
        [v.id, parseInt(mes), parseInt(ano)]);
      const valor_meta = meta?.valor_meta || 0;
      const total = parseFloat(v.total_vendido);
      const percentual = valor_meta > 0 ? Math.round((total / valor_meta) * 100) : 0;
      return { ...v, posicao: i+1, valor_meta, percentual_meta: percentual };
    }));

    res.json(comMeta);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar ranking' });
  }
});

// GET /api/metas
router.get('/', async (req, res) => {
  try {
    const hoje = new Date();
    const mes = parseInt(req.query.mes || hoje.getMonth()+1);
    const ano = parseInt(req.query.ano || hoje.getFullYear());
    const metas = await db.all(`
      SELECT m.*, u.nome as vendedor_nome FROM metas m
      JOIN usuarios u ON u.id = m.vendedor_id
      WHERE m.mes=$1 AND m.ano=$2
    `, [mes, ano]);
    res.json(metas);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar metas' });
  }
});

// POST /api/metas
router.post('/', autorizar('gestor'), async (req, res) => {
  try {
    const { vendedor_id, mes, ano, valor_meta } = req.body;
    if (!vendedor_id || !mes || !ano || !valor_meta)
      return res.status(400).json({ erro: 'Campos obrigatórios faltando' });
    const metaNum = parseFloat(valor_meta);
    if (isNaN(metaNum) || metaNum <= 0) return res.status(400).json({ erro: 'Valor da meta deve ser positivo' });

    await db.run(`
      INSERT INTO metas (vendedor_id, mes, ano, valor_meta) VALUES ($1,$2,$3,$4)
      ON CONFLICT(vendedor_id,mes,ano) DO UPDATE SET valor_meta=EXCLUDED.valor_meta
    `, [vendedor_id, mes, ano, metaNum]);

    res.json({ mensagem: 'Meta definida com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao definir meta' });
  }
});

module.exports = router;
