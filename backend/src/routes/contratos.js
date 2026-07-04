const express = require('express');
const crypto  = require('crypto');
const db      = require('../utils/db');
const { autenticar } = require('../middlewares/auth');
const { criarUpload, deletarArquivo } = require('../utils/cloudinary');

const router = express.Router();
router.use(autenticar);

const upload = criarUpload({
  folder: 'anexos',
  allowedFormats: ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'],
  resourceType: 'auto',
});

// GET — listar anexos de um pedido
router.get('/:pedido_id', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT a.*, u.nome as enviado_por
      FROM pedido_anexos a
      LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.pedido_id = $1
      ORDER BY a.criado_em DESC
    `, [req.params.pedido_id]);
    res.json(rows);
  } catch (err) {
    console.error('[contratos GET]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// POST — upload de anexo
router.post('/:pedido_id', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Arquivo não enviado ou tipo não permitido (use PDF, imagem ou Word).' });

    const pedidoId = req.params.pedido_id;
    const pedido = await db.get('SELECT id FROM pedidos WHERE id = $1', [pedidoId]);
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });

    const caminho = req.file.path; // URL do Cloudinary
    const nomeOriginal = Buffer.from(req.file.originalname, 'latin1').toString('utf8').normalize('NFC');

    const id = await db.insert(`
      INSERT INTO pedido_anexos (pedido_id, nome_arquivo, caminho, tamanho, usuario_id)
      VALUES ($1,$2,$3,$4,$5)
    `, [pedido.id, nomeOriginal, caminho, req.file.size, req.usuario?.id || null]);

    res.status(201).json({ id, nome_arquivo: nomeOriginal, caminho, tamanho: req.file.size });
  } catch (err) {
    console.error('[contratos POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// DELETE — remover anexo
router.delete('/:id', async (req, res) => {
  try {
    const row = await db.get('SELECT * FROM pedido_anexos WHERE id = $1', [req.params.id]);
    if (!row) return res.status(404).json({ erro: 'Não encontrado' });
    await deletarArquivo(row.caminho);
    await db.run('DELETE FROM pedido_anexos WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[contratos DELETE]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
