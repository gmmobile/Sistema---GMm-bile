const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  // Sem estes timeouts, uma query numa conexão morta do Neon pendura para
  // sempre e trava o boot (migrações) ou a requisição inteira.
  query_timeout: 30000,
  statement_timeout: 30000,
});

// Neon (serverless) pode derrubar conexões ociosas do pool a qualquer momento.
// Sem este listener, esse erro assíncrono derruba o processo Node inteiro.
pool.on('error', (err) => {
  console.error('[pg pool] erro em conexão ociosa:', err.message);
});

// Ping a cada 4 min impede o Neon de suspender o compute por inatividade —
// sem isso a primeira consulta após um período parado leva vários segundos
// (cold start) e derruba as conexões do pool.
const keepAliveTimer = setInterval(() => {
  pool.query('SELECT 1').catch(() => {});
}, 4 * 60 * 1000);
if (keepAliveTimer.unref) keepAliveTimer.unref();

const RETRYABLE = /Connection terminated|ECONNRESET|ETIMEDOUT|terminating connection|connection is closed|server closed the connection|Query read timeout|timeout exceeded/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Uma query que falha por queda de conexão do lado do banco é re-executada
// (com pequeno atraso crescente) — falha real de SQL não é retentada.
// Várias tentativas são necessárias porque bancos serverless (Neon) podem
// suspender o compute e derrubar TODAS as conexões do pool de uma vez;
// cada retentativa força o pool a abrir uma conexão nova.
async function queryWithRetry(text, params) {
  const ATTEMPTS = 4;
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      if (i === ATTEMPTS || !RETRYABLE.test(err.message)) throw err;
      console.warn(`[pg pool] conexão perdida (tentativa ${i}/${ATTEMPTS}):`, err.message);
      await sleep(150 * i);
    }
  }
}

const db = {
  // Executa query e retorna todas as linhas
  query: (text, params = []) => queryWithRetry(text, params),

  // Retorna array de linhas
  all: async (text, params = []) => {
    const res = await queryWithRetry(text, params);
    return res.rows;
  },

  // Retorna primeira linha ou null
  get: async (text, params = []) => {
    const res = await queryWithRetry(text, params);
    return res.rows[0] || null;
  },

  // Executa sem retorno (INSERT/UPDATE/DELETE)
  run: async (text, params = []) => {
    const res = await queryWithRetry(text, params);
    return res;
  },

  // INSERT com RETURNING id — retorna o id criado
  insert: async (text, params = []) => {
    const res = await queryWithRetry(text + ' RETURNING id', params);
    return res.rows[0]?.id;
  },

  pool,
};

module.exports = db;
