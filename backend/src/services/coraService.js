/* ════════════════════════════════════════════════════════════════
   CORA SERVICE — integração com a API do Banco Cora (Direct Integration)
   Toda a lógica de autenticação mTLS + client_credentials e as
   chamadas de negócio (extrato, emissão de boleto/PIX, webhook)
   ficam isoladas aqui. Nenhuma outra parte do sistema fala com o
   Cora diretamente.

   Credenciais nunca ficam no código — vêm de variáveis de ambiente:
     CORA_CLIENT_ID
     CORA_CERT_PEM_BASE64   (certificate.pem, em base64)
     CORA_KEY_PEM_BASE64    (private-key.key, em base64)
     CORA_ENV                'sandbox' (default) | 'production'
     CORA_AUTH_BASE_URL      opcional, sobrescreve o host de autenticação
     CORA_API_BASE_URL       opcional, sobrescreve o host das APIs de negócio

   Hosts confirmados na documentação oficial (developers.cora.com.br)
   para o ambiente sandbox/stage:
     auth: https://matls-clients.api.stage.cora.com.br
     api:  https://api.stage.cora.com.br
   Os hosts de produção ainda não foram confirmados — devem ser
   definidos via CORA_AUTH_BASE_URL/CORA_API_BASE_URL quando o
   cliente tiver credenciais de produção, ou atualizados aqui assim
   que confirmados.
   ════════════════════════════════════════════════════════════════ */
const https = require('https');
const crypto = require('crypto');
const db = require('../utils/db');

const HOSTS_SANDBOX = {
  auth: 'https://matls-clients.api.stage.cora.com.br',
  api: 'https://api.stage.cora.com.br',
};
const HOSTS_PRODUCTION = {
  // TODO: confirmar com o painel/documentação do Cora ao ativar produção.
  auth: process.env.CORA_AUTH_BASE_URL || 'https://matls-clients.api.cora.com.br',
  api: process.env.CORA_API_BASE_URL || 'https://api.cora.com.br',
};

function carregarConfig() {
  const clientId = process.env.CORA_CLIENT_ID;
  const certB64 = process.env.CORA_CERT_PEM_BASE64;
  const keyB64 = process.env.CORA_KEY_PEM_BASE64;
  if (!clientId || !certB64 || !keyB64) {
    throw new Error('Credenciais do Cora não configuradas (CORA_CLIENT_ID / CORA_CERT_PEM_BASE64 / CORA_KEY_PEM_BASE64)');
  }
  const cert = Buffer.from(certB64, 'base64').toString('utf8');
  const key = Buffer.from(keyB64, 'base64').toString('utf8');
  const ambiente = process.env.CORA_ENV === 'production' ? 'production' : 'sandbox';
  const hosts = ambiente === 'production' ? HOSTS_PRODUCTION : HOSTS_SANDBOX;
  return { clientId, cert, key, ambiente, hosts };
}

function requisitar({ baseUrl, path, method = 'GET', headers = {}, body, cert, key }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const req = https.request(url, {
      method,
      cert,
      key,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          const err = new Error(`Cora API respondeu ${res.statusCode}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
          err.status = res.statusCode;
          err.body = parsed;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function obterToken() {
  const config = carregarConfig();
  const cache = await db.get(`SELECT * FROM cora_auth_cache ORDER BY id DESC LIMIT 1`);
  const margemSegundos = 120;
  if (cache && new Date(cache.expira_em).getTime() > Date.now() + margemSegundos * 1000) {
    return { token: cache.access_token, config };
  }

  const corpo = `grant_type=client_credentials&client_id=${encodeURIComponent(config.clientId)}`;
  const resp = await requisitar({
    baseUrl: config.hosts.auth,
    path: '/token',
    method: 'POST',
    cert: config.cert,
    key: config.key,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
  });

  if (!resp || !resp.access_token) {
    throw new Error('Cora não retornou access_token: ' + JSON.stringify(resp));
  }
  const expiraEm = new Date(Date.now() + (resp.expires_in || 86400) * 1000);
  await db.run(`INSERT INTO cora_auth_cache (access_token, expira_em) VALUES ($1,$2)`, [resp.access_token, expiraEm]);
  await db.run(`DELETE FROM cora_auth_cache WHERE id NOT IN (SELECT id FROM cora_auth_cache ORDER BY id DESC LIMIT 1)`);

  return { token: resp.access_token, config };
}

async function chamarApi(method, path, body, { idempotente = false } = {}) {
  const { token, config } = await obterToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (body) headers['Content-Type'] = 'application/json';
  if (idempotente) headers['Idempotency-Key'] = crypto.randomUUID();

  return requisitar({
    baseUrl: config.hosts.api,
    path,
    method,
    cert: config.cert,
    key: config.key,
    headers,
    body,
  });
}

/* ── Extrato ──
   GET /bank-statement/statement?start=YYYY-MM-DD&end=YYYY-MM-DD&page=&perPage= */
async function consultarExtrato(dataIni, dataFim, page = 0, perPage = 100) {
  const qs = new URLSearchParams({ start: dataIni, end: dataFim, page: String(page), perPage: String(perPage) });
  return chamarApi('GET', `/bank-statement/statement?${qs}`);
}

/* ── Emissão de cobrança (boleto e/ou PIX) — POST /v2/invoices/
   paymentForms: array com 'BANK_SLIP' e/ou 'PIX' */
async function emitirCobranca({ cliente, valorCentavos, descricao, vencimento, paymentForms = ['BANK_SLIP', 'PIX'], code }) {
  const payload = {
    code: code || undefined,
    customer: {
      name: cliente.nome,
      email: cliente.email || undefined,
      document: { identity: (cliente.documento || '').replace(/\D/g, ''), type: cliente.tipoDocumento || (cliente.documento?.replace(/\D/g, '').length > 11 ? 'CNPJ' : 'CPF') },
    },
    services: [{ name: descricao?.slice(0, 60) || 'Cobrança', description: descricao?.slice(0, 100) || 'Cobrança', amount: valorCentavos }],
    payment_terms: { due_date: vencimento },
    payment_forms: paymentForms,
  };
  return chamarApi('POST', '/v2/invoices/', payload, { idempotente: true });
}

async function consultarCobranca(coraId) {
  return chamarApi('GET', `/v2/invoices/${encodeURIComponent(coraId)}`);
}

async function cancelarCobranca(coraId) {
  return chamarApi('DELETE', `/v2/invoices/${encodeURIComponent(coraId)}`);
}

/* ── Webhook — registra nosso endpoint pra receber notificações
   POST /endpoints/ { url, resource, trigger } */
async function registrarWebhook(url, resource = '*', trigger = '*') {
  return chamarApi('POST', '/endpoints/', { url, resource, trigger }, { idempotente: true });
}

module.exports = {
  obterToken,
  chamarApi,
  consultarExtrato,
  emitirCobranca,
  consultarCobranca,
  cancelarCobranca,
  registrarWebhook,
};
