const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

router.get('/', async (req, res) => {
  try {
    const { busca, categoria } = req.query;
    let sql = 'SELECT * FROM fornecedores WHERE ativo=1';
    const params = [];
    let idx = 1;
    if (busca)     { sql += ` AND (nome ILIKE $${idx} OR cnpj ILIKE $${idx})`; params.push(`%${busca}%`); idx++; }
    if (categoria) { sql += ` AND categoria=$${idx++}`; params.push(categoria); }
    sql += ' ORDER BY nome ASC';
    res.json(await db.all(sql, params));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar fornecedores' });
  }
});

router.get('/categorias', async (req, res) => {
  try {
    const rows = await db.all(`SELECT DISTINCT categoria FROM fornecedores WHERE ativo=1 AND categoria IS NOT NULL ORDER BY categoria`);
    res.json(rows.map(r => r.categoria));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar categorias' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const f = await db.get('SELECT * FROM fornecedores WHERE id=$1', [req.params.id]);
    if (!f) return res.status(404).json({ erro: 'Fornecedor não encontrado' });
    res.json(f);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar fornecedor' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { nome, cnpj, email, telefone, whatsapp, categoria, prazo_pagamento, banco, agencia, conta, chave_pix, cep, rua, numero, bairro, cidade, estado, observacoes } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
    const id = await db.insert(`
      INSERT INTO fornecedores (nome,cnpj,email,telefone,whatsapp,categoria,prazo_pagamento,banco,agencia,conta,chave_pix,cep,rua,numero,bairro,cidade,estado,observacoes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    `, [nome,cnpj||null,email||null,telefone||null,whatsapp||null,categoria||null,parseInt(prazo_pagamento)||30,banco||null,agencia||null,conta||null,chave_pix||null,cep||null,rua||null,numero||null,bairro||null,cidade||null,estado||null,observacoes||null]);
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao criar fornecedor' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { nome, cnpj, email, telefone, whatsapp, categoria, prazo_pagamento, banco, agencia, conta, chave_pix, cep, rua, numero, bairro, cidade, estado, observacoes } = req.body;
    await db.run(`
      UPDATE fornecedores SET nome=$1,cnpj=$2,email=$3,telefone=$4,whatsapp=$5,categoria=$6,prazo_pagamento=$7,banco=$8,agencia=$9,conta=$10,chave_pix=$11,cep=$12,rua=$13,numero=$14,bairro=$15,cidade=$16,estado=$17,observacoes=$18 WHERE id=$19
    `, [nome,cnpj||null,email||null,telefone||null,whatsapp||null,categoria||null,parseInt(prazo_pagamento)||30,banco||null,agencia||null,conta||null,chave_pix||null,cep||null,rua||null,numero||null,bairro||null,cidade||null,estado||null,observacoes||null,req.params.id]);
    res.json({ mensagem: 'Fornecedor atualizado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar fornecedor' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.run('UPDATE fornecedores SET ativo=0 WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Fornecedor removido' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover fornecedor' });
  }
});

module.exports = router;
