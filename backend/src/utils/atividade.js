const db = require('./db');

async function log(usuario_id, acao, modulo, descricao, referencia_id = null) {
  try {
    await db.run(
      'INSERT INTO atividades (usuario_id, acao, modulo, descricao, referencia_id) VALUES ($1,$2,$3,$4,$5)',
      [usuario_id, acao, modulo, descricao, referencia_id]
    );
  } catch(e) { /* não travar a request por falha de log */ }
}

module.exports = log;
