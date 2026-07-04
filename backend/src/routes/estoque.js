const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

router.get('/produtos', async (req, res) => {
  try {
    const { busca, categoria, alerta } = req.query;
    let sql = 'SELECT * FROM produtos WHERE ativo=1';
    const params = [];
    let idx = 1;
    if (busca)       { sql += ` AND (nome ILIKE $${idx} OR codigo ILIKE $${idx})`; params.push(`%${busca}%`); idx++; }
    if (categoria)   { sql += ` AND categoria=$${idx++}`; params.push(categoria); }
    if (alerta === '1') { sql += ' AND estoque_atual <= estoque_minimo'; }
    sql += ' ORDER BY nome ASC';
    res.json(await db.all(sql, params));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar produtos' });
  }
});

router.get('/produtos/:id', async (req, res) => {
  try {
    const p = await db.get('SELECT * FROM produtos WHERE id=$1', [req.params.id]);
    if (!p) return res.status(404).json({ erro: 'Produto não encontrado' });
    res.json(p);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar produto' });
  }
});

router.post('/produtos', async (req, res) => {
  try {
    const { nome, codigo, categoria, unidade, estoque_atual, estoque_minimo, valor_custo, descricao } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
    const id = await db.insert(`
      INSERT INTO produtos (nome, codigo, categoria, unidade, estoque_atual, estoque_minimo, valor_custo, descricao)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [nome, codigo||null, categoria||null, unidade||'un',
        parseFloat(estoque_atual)||0, parseFloat(estoque_minimo)||0,
        parseFloat(valor_custo)||0, descricao||null]);
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao criar produto' });
  }
});

router.put('/produtos/:id', async (req, res) => {
  try {
    const { nome, codigo, categoria, unidade, estoque_minimo, valor_custo, descricao } = req.body;
    await db.run(`
      UPDATE produtos SET nome=$1, codigo=$2, categoria=$3, unidade=$4, estoque_minimo=$5, valor_custo=$6, descricao=$7 WHERE id=$8
    `, [nome, codigo||null, categoria||null, unidade||'un',
        parseFloat(estoque_minimo)||0, Math.max(parseFloat(valor_custo)||0, 0), descricao||null, req.params.id]);
    res.json({ mensagem: 'Produto atualizado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar produto' });
  }
});

router.delete('/produtos/:id', async (req, res) => {
  try {
    await db.run('UPDATE produtos SET ativo=0 WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Produto removido' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover produto' });
  }
});

router.get('/movimentos', async (req, res) => {
  try {
    const { produto_id, tipo, inicio, fim } = req.query;
    let sql = `
      SELECT m.*, p.nome as produto_nome, p.unidade, u.nome as usuario_nome
      FROM movimentos_estoque m
      LEFT JOIN produtos p ON p.id = m.produto_id
      LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;
    if (produto_id) { sql += ` AND m.produto_id=$${idx++}`; params.push(produto_id); }
    if (tipo)       { sql += ` AND m.tipo=$${idx++}`;        params.push(tipo); }
    if (inicio)     { sql += ` AND m.criado_em>=$${idx++}`;  params.push(inicio); }
    if (fim)        { sql += ` AND m.criado_em<=$${idx++}`;  params.push(fim + 'T23:59:59'); }
    sql += ' ORDER BY m.criado_em DESC';
    res.json(await db.all(sql, params));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar movimentos' });
  }
});

router.post('/movimentos', async (req, res) => {
  try {
    const { produto_id, tipo, quantidade, valor_unitario, observacao, pedido_id } = req.body;
    if (!produto_id || !tipo || !quantidade)
      return res.status(400).json({ erro: 'produto_id, tipo e quantidade são obrigatórios' });
    const qtd = parseFloat(quantidade);
    if (qtd <= 0) return res.status(400).json({ erro: 'Quantidade deve ser maior que zero' });

    const produto = await db.get('SELECT * FROM produtos WHERE id=$1 AND ativo=1', [produto_id]);
    if (!produto) return res.status(404).json({ erro: 'Produto não encontrado' });

    const delta = tipo === 'entrada' ? qtd : tipo === 'saida' ? -qtd : 0;
    const novoEstoque = parseFloat(produto.estoque_atual) + delta;
    if (tipo === 'saida' && novoEstoque < 0)
      return res.status(400).json({ erro: 'Estoque insuficiente' });

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, valor_unitario, observacao, pedido_id, usuario_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [produto_id, tipo, qtd, parseFloat(valor_unitario)||null, observacao||null, pedido_id||null, req.usuario.id]);

      if (tipo === 'ajuste') {
        await client.query('UPDATE produtos SET estoque_atual=$1 WHERE id=$2', [qtd, produto_id]);
      } else {
        await client.query('UPDATE produtos SET estoque_atual=estoque_atual+$1 WHERE id=$2', [delta, produto_id]);
      }
      await client.query('COMMIT');
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const atualizado = await db.get('SELECT estoque_atual FROM produtos WHERE id=$1', [produto_id]);
    res.status(201).json({ mensagem: 'Movimento registrado', estoque_atual: atualizado.estoque_atual });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao registrar movimento' });
  }
});

router.get('/alertas', async (req, res) => {
  try {
    const rows = await db.all(`SELECT * FROM produtos WHERE ativo=1 AND estoque_atual <= estoque_minimo ORDER BY (estoque_atual - estoque_minimo) ASC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar alertas' });
  }
});

router.get('/categorias', async (req, res) => {
  try {
    const rows = await db.all(`SELECT DISTINCT categoria FROM produtos WHERE ativo=1 AND categoria IS NOT NULL ORDER BY categoria`);
    res.json(rows.map(r => r.categoria));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar categorias' });
  }
});

router.get('/resumo', async (req, res) => {
  try {
    const r = await db.get(`
      SELECT
        COUNT(*) as total_produtos,
        SUM(CASE WHEN estoque_atual <= estoque_minimo THEN 1 ELSE 0 END) as alertas,
        COALESCE(SUM(CASE WHEN valor_custo >= 0 THEN estoque_atual * valor_custo ELSE 0 END),0) as valor_total,
        COALESCE(SUM(estoque_atual),0) as itens_total
      FROM produtos WHERE ativo=1
    `);
    res.json(r);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar resumo' });
  }
});

module.exports = router;
