const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: { erro: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha || typeof email !== 'string' || typeof senha !== 'string') {
      return res.status(400).json({ erro: 'E-mail e senha são obrigatórios' });
    }
    if (email.length > 255 || senha.length > 255) {
      return res.status(400).json({ erro: 'Credenciais inválidas' });
    }

    const usuario = await db.get(
      'SELECT * FROM usuarios WHERE email = $1 AND ativo = 1',
      [email.trim().toLowerCase()]
    );
    if (!usuario) return res.status(401).json({ erro: 'Credenciais inválidas' });

    const senhaCorreta = bcrypt.compareSync(senha, usuario.senha_hash);
    if (!senhaCorreta) return res.status(401).json({ erro: 'Credenciais inválidas' });

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('[SEGURANÇA] JWT_SECRET não configurado!');
      return res.status(500).json({ erro: 'Erro de configuração do servidor' });
    }

    const token = jwt.sign(
      { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
      secret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil, foto: usuario.foto }
    });
  } catch (err) {
    console.error('[LOGIN ERROR]', err.message);
    res.status(500).json({ erro: 'Erro ao processar login. Tente novamente.' });
  }
});

// GET /api/auth/me
router.get('/me', autenticar, async (req, res) => {
  try {
    const usuario = await db.get(
      'SELECT id, nome, email, perfil, foto FROM usuarios WHERE id = $1',
      [req.usuario.id]
    );
    res.json(usuario);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar usuário' });
  }
});

// GET /api/auth/usuarios
router.get('/usuarios', autenticar, async (req, res) => {
  try {
    const { perfil } = req.query;
    let sql = 'SELECT id, nome, email, perfil FROM usuarios WHERE ativo = 1';
    const params = [];
    if (perfil) { sql += ' AND perfil = $1'; params.push(perfil); }
    sql += ' ORDER BY nome';
    res.json(await db.all(sql, params));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar usuários' });
  }
});

// POST /api/auth/trocar-senha
router.post('/trocar-senha', autenticar, async (req, res) => {
  try {
    const { senha_atual, nova_senha } = req.body;
    if (!senha_atual || !nova_senha)
      return res.status(400).json({ erro: 'Senha atual e nova senha são obrigatórias' });
    if (nova_senha.length < 6)
      return res.status(400).json({ erro: 'Nova senha deve ter pelo menos 6 caracteres' });

    const usuario = await db.get('SELECT * FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (!bcrypt.compareSync(senha_atual, usuario.senha_hash))
      return res.status(401).json({ erro: 'Senha atual incorreta' });

    const novoHash = bcrypt.hashSync(nova_senha, 10);
    await db.run('UPDATE usuarios SET senha_hash = $1, atualizado_em = NOW() WHERE id = $2',
      [novoHash, req.usuario.id]);

    res.json({ mensagem: 'Senha alterada com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao trocar senha' });
  }
});

module.exports = router;
