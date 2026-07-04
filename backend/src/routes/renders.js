const express = require('express');
const crypto  = require('crypto');
const db      = require('../utils/db');
const { autenticar } = require('../middlewares/auth');
const { criarUpload, deletarArquivo } = require('../utils/cloudinary');

const router = express.Router();
router.use(autenticar);

const upload = criarUpload({
  folder: 'renders',
  allowedFormats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
  resourceType: 'auto',
});

router.get('/', async (req, res) => {
  try {
    const { cliente_id } = req.query;
    let sql = `SELECT r.*, c.nome as cliente_nome FROM renders r LEFT JOIN clientes c ON c.id=r.cliente_id WHERE 1=1`;
    const params = [];
    if (cliente_id) { sql += ' AND r.cliente_id=$1'; params.push(cliente_id); }
    sql += ' ORDER BY r.criado_em DESC';
    res.json(await db.all(sql, params));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar renders' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const r = await db.get(`SELECT r.*, c.nome as cliente_nome FROM renders r LEFT JOIN clientes c ON c.id=r.cliente_id WHERE r.id=$1`, [req.params.id]);
    if (!r) return res.status(404).json({ erro: 'Render não encontrado' });
    res.json(r);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar render' });
  }
});

router.post('/', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Arquivo é obrigatório' });
    const { nome, ambiente, cliente_id, pedido_id } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });

    const isImg = req.file.mimetype?.startsWith('image/');
    const token = crypto.randomBytes(16).toString('hex');
    const arquivo_path = req.file.path; // URL do Cloudinary

    const id = await db.insert(`
      INSERT INTO renders (nome, arquivo_path, tipo, ambiente, cliente_id, pedido_id, token_publico)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [nome, arquivo_path, isImg ? 'imagem' : 'pdf', ambiente||null, cliente_id||null, pedido_id||null, token]);

    res.status(201).json({ id, token_publico: token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao salvar render' });
  }
});

router.put('/:id/aprovar', async (req, res) => {
  try {
    await db.run('UPDATE renders SET aprovado=1, data_aprovacao=NOW() WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Render aprovado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao aprovar render' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await db.get('SELECT arquivo_path FROM renders WHERE id=$1', [req.params.id]);
    if (r?.arquivo_path) await deletarArquivo(r.arquivo_path);
    await db.run('DELETE FROM renders WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Render removido' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover render' });
  }
});

module.exports = router;
