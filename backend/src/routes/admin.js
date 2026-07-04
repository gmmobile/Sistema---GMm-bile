const express = require('express');
const db = require('../utils/db');
const { autenticar, autorizar } = require('../middlewares/auth');
const { criarUpload, deletarArquivo } = require('../utils/cloudinary');

const router = express.Router();

const uploadLogo = criarUpload({ folder: 'logo', allowedFormats: ['jpg', 'jpeg', 'png', 'webp', 'svg'] });

// GET /api/admin/configuracoes-loja — público (usado na tela de login para carregar logo)
router.get('/configuracoes-loja', async (req, res) => {
  try {
    const cfg = await db.get('SELECT nome_empresa, logo_path, cor_primaria FROM configuracoes_loja WHERE id=1');
    res.json(cfg || {});
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar configurações' });
  }
});

router.use(autenticar);

// GET /api/admin/atividades
router.get('/atividades', async (req, res) => {
  try {
    const { modulo } = req.query;
    const limite = Math.min(Math.max(parseInt(req.query.limite) || 100, 1), 1000);
    let sql = `
      SELECT a.*, u.nome as usuario_nome, u.perfil as usuario_perfil
      FROM atividades a LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;
    if (modulo) { sql += ` AND a.modulo=$${idx}`; params.push(modulo); idx++; }
    sql += ` ORDER BY a.criado_em DESC LIMIT $${idx}`;
    params.push(limite);
    res.json(await db.all(sql, params));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar atividades' });
  }
});

// PUT /api/admin/configuracoes-loja
router.put('/configuracoes-loja', autorizar('gestor'), uploadLogo.single('logo'), async (req, res) => {
  try {
    const { nome_empresa, cnpj, telefone, whatsapp, email, site,
            cep, rua, numero, bairro, cidade, estado, cor_primaria } = req.body;

    const atual = await db.get('SELECT logo_path FROM configuracoes_loja WHERE id=1');
    let logoFinal = atual?.logo_path || null;

    if (req.file) {
      await deletarArquivo(logoFinal);
      logoFinal = req.file.path;
    }

    await db.run(`
      UPDATE configuracoes_loja SET
        nome_empresa=$1, cnpj=$2, telefone=$3, whatsapp=$4, email=$5, site=$6,
        cep=$7, rua=$8, numero=$9, bairro=$10, cidade=$11, estado=$12,
        logo_path=$13, cor_primaria=$14, atualizado_em=NOW()
      WHERE id=1
    `, [nome_empresa||'Minha Empresa', cnpj||null, telefone||null, whatsapp||null,
        email||null, site||null, cep||null, rua||null, numero||null, bairro||null,
        cidade||null, estado||null, logoFinal, cor_primaria||'#6366f1']);

    res.json({ mensagem: 'Configurações salvas' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao salvar configurações' });
  }
});

// GET /api/admin/backup — não disponível na Vercel (sem sistema de arquivos)
router.get('/backup', autorizar('gestor'), (req, res) => {
  res.status(501).json({ erro: 'Backup não disponível na versão cloud. Use o painel do Neon para exportar os dados.' });
});

module.exports = router;
