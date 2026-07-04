const jwt = require('jsonwebtoken');

function autenticar(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token não fornecido' });
  }
  const token = header.split(' ')[1];
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ erro: 'Erro de configuração do servidor' });
    const payload = jwt.verify(token, secret);
    req.usuario = payload;
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}

function autorizar(...perfis) {
  return (req, res, next) => {
    if (!perfis.includes(req.usuario.perfil)) {
      return res.status(403).json({ erro: 'Sem permissão para esta ação' });
    }
    next();
  };
}

module.exports = { autenticar, autorizar };
