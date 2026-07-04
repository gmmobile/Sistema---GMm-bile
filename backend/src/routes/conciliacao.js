const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

// Sanitiza datas TEXT 'YYYY-MM-DD'
const dStr = v => String(v || '').slice(0, 10).replace(/[^0-9-]/g, '');

// ─── Score de compatibilidade ──────────────────────────────────────────────────
function calcularScore(extrato, lancamento) {
  const tipoOk = (extrato.tipo === 'credito' && lancamento.tipo === 'receita') ||
                 (extrato.tipo === 'debito'  && lancamento.tipo === 'despesa');
  if (!tipoOk) return null;

  let score = 0;
  const motivos = [];

  // Valor — 40 pts
  const diffV = Math.abs(extrato.valor - lancamento.valor);
  const pctV  = lancamento.valor > 0 ? diffV / lancamento.valor : 1;
  if (pctV === 0)        { score += 40; motivos.push('Valor exato'); }
  else if (pctV <= 0.01) { score += 32; motivos.push('Valor ±1%'); }
  else if (pctV <= 0.05) { score += 20; motivos.push('Valor ±5%'); }
  else if (pctV <= 0.15) { score += 8; }
  else return null; // diferença >15%

  // Data — 30 pts
  const dataRef = lancamento.data_pagamento || lancamento.data_vencimento;
  if (dataRef) {
    const de = new Date(dStr(extrato.data) + 'T12:00:00');
    const dl = new Date(dStr(dataRef) + 'T12:00:00');
    const dias = Math.abs((de - dl) / 86400000);
    if (dias === 0)      { score += 30; motivos.push('Data exata'); }
    else if (dias <= 1)  { score += 24; motivos.push('Data ±1 dia'); }
    else if (dias <= 3)  { score += 18; motivos.push('Data ±3 dias'); }
    else if (dias <= 7)  { score += 10; motivos.push('Data ±7 dias'); }
    else if (dias <= 30) { score += 3; }
  }

  // Descrição / nome — 20 pts
  const descE = (extrato.descricao || '').toLowerCase();
  const textos = [lancamento.descricao, lancamento.cliente_nome, lancamento.fornecedor_nome]
    .filter(Boolean).join(' ').toLowerCase();
  const palavras = [...new Set(textos.split(/\s+/).filter(p => p.length > 3))];
  if (palavras.length > 0) {
    const hits = palavras.filter(p => descE.includes(p)).length;
    const pts  = Math.round(20 * Math.min((hits / palavras.length) * 1.5, 1));
    score += pts;
    if (pts >= 8) motivos.push('Descrição similar');
  }

  // Pedido na descrição — 10 pts
  if (lancamento.pedido_id && descE.includes(String(lancamento.pedido_id))) {
    score += 10; motivos.push('Nº pedido encontrado');
  }

  return { score: Math.min(score, 100), motivos };
}

// ─── Parser CSV ────────────────────────────────────────────────────────────────
function parseCsv(content) {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].toLowerCase().split(sep).map(h => h.trim().replace(/["\s]/g, ''));

  return lines.slice(1).map(line => {
    const cols = line.split(sep).map(c => c.trim().replace(/"/g, ''));
    const row  = {};
    headers.forEach((h, i) => { row[h] = cols[i] || ''; });

    const data    = (row.data || row.date || row.dt || '').trim();
    const desc    = row.descricao || row.historico || row.memo || row.description || '';
    const creditoRaw = row.credito || row.entrada || row.credit || '';
    const debitoRaw  = row.debito  || row.saida   || row.debit  || '';
    const valorRaw   = row.valor   || row.value   || row.amount || '0';
    const tipoRaw    = (row.tipo   || row.type    || '').toLowerCase();

    let valor, tipo;
    if (creditoRaw || debitoRaw) {
      const cv = parseFloat(creditoRaw.replace(',', '.')) || 0;
      const dv = parseFloat(debitoRaw.replace(',', '.'))  || 0;
      if (cv > 0)      { valor = cv; tipo = 'credito'; }
      else if (dv > 0) { valor = dv; tipo = 'debito'; }
      else return null;
    } else {
      valor = parseFloat(String(valorRaw).replace(/\./g, '').replace(',', '.'));
      if (isNaN(valor) || valor === 0) return null;
      if (['c','credito','credit','entrada'].includes(tipoRaw))     tipo = 'credito';
      else if (['d','debito','debit','saida'].includes(tipoRaw))    tipo = 'debito';
      else { tipo = valor > 0 ? 'credito' : 'debito'; valor = Math.abs(valor); }
    }

    // Normalizar data DD/MM/YYYY → YYYY-MM-DD
    let dataNorm = data;
    if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(dataNorm)) {
      const parts = dataNorm.split(/[\/\-]/);
      dataNorm = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }

    return { data: dStr(dataNorm), descricao: desc || 'Sem descrição', valor: Math.abs(valor), tipo };
  }).filter(l => l && l.valor > 0 && l.data);
}

// ─── Parser OFX / OFC ─────────────────────────────────────────────────────────
function parseOFX(content) {
  const text    = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const result  = [];
  const getTag  = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}>([^<\n]+)`, 'i'));
    return m ? m[1].trim() : null;
  };

  // XML-style (closing tags)
  const xmlBlocks = [...text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)];
  const blocks    = xmlBlocks.length > 0
    ? xmlBlocks.map(m => m[1])
    : text.split(/<STMTTRN>/i).slice(1);

  for (const block of blocks) {
    const dtposted = getTag(block, 'DTPOSTED');
    const trnamt   = getTag(block, 'TRNAMT');
    const fitid    = getTag(block, 'FITID');
    const memo     = getTag(block, 'MEMO') || getTag(block, 'NAME');
    if (!dtposted || !trnamt) continue;
    const y  = dtposted.slice(0, 4);
    const mo = dtposted.slice(4, 6);
    const d  = dtposted.slice(6, 8);
    const val = parseFloat(trnamt.replace(',', '.'));
    result.push({
      data: `${y}-${mo}-${d}`,
      descricao: memo || 'Transação',
      valor: Math.abs(val),
      tipo: val >= 0 ? 'credito' : 'debito',
      fitid,
    });
  }
  return result;
}

// ─── Helper: busca candidatos de lançamento para um extrato ───────────────────
async function buscarCandidatos(extrato, diasJanela = 30, conta_id = null) {
  const tipoLanc = extrato.tipo === 'credito' ? 'receita' : 'despesa';
  const d   = new Date(dStr(extrato.data) + 'T12:00:00');
  const d0  = new Date(d.getTime() - diasJanela * 86400000).toISOString().split('T')[0];
  const d1  = new Date(d.getTime() + diasJanela * 86400000).toISOString().split('T')[0];
  const vMin = extrato.valor * 0.80;
  const vMax = extrato.valor * 1.20;

  let sql = `
    SELECT l.*,
      cli.nome  AS cliente_nome,
      forn.nome AS fornecedor_nome,
      cat.nome  AS categoria_nome
    FROM lancamentos l
    LEFT JOIN clientes     cli  ON cli.id  = l.cliente_id
    LEFT JOIN fornecedores forn ON forn.id = l.fornecedor_id
    LEFT JOIN categorias   cat  ON cat.id  = l.categoria_id
    WHERE l.tipo = $1 AND l.valor BETWEEN $2 AND $3
      AND l.status NOT IN ('cancelado')
      AND (
        l.data_vencimento BETWEEN '${d0}' AND '${d1}'
        OR (l.data_pagamento IS NOT NULL AND l.data_pagamento BETWEEN '${d0}' AND '${d1}')
      )
      AND l.id NOT IN (
        SELECT lancamento_id FROM extrato_bancario
        WHERE lancamento_id IS NOT NULL AND id != $4
      )
  `;
  const params = [tipoLanc, vMin, vMax, extrato.id || 0];
  if (conta_id) { sql += ` AND l.conta_id=$${params.length + 1}`; params.push(conta_id); }
  sql += ' LIMIT 20';
  return db.all(sql, params);
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROTAS
// ─────────────────────────────────────────────────────────────────────────────

/* GET / — listar extrato */
router.get('/', async (req, res) => {
  try {
    const { conta_id, inicio, fim, status, tipo, busca } = req.query;
    let sql = `
      SELECT e.*,
        cc.nome AS conta_nome, cc.banco, cc.cor AS conta_cor,
        l.descricao AS lancamento_descricao
      FROM extrato_bancario e
      LEFT JOIN contas_correntes cc ON cc.id = e.conta_id
      LEFT JOIN lancamentos      l  ON l.id  = e.lancamento_id
      WHERE 1=1
    `;
    const params = []; let idx = 1;
    if (conta_id) { sql += ` AND e.conta_id=$${idx++}`; params.push(conta_id); }
    if (inicio)   { sql += ` AND e.data>='${dStr(inicio)}'`; }
    if (fim)      { sql += ` AND e.data<='${dStr(fim)}'`; }
    if (status)   { sql += ` AND e.status=$${idx++}`; params.push(status); }
    if (tipo)     { sql += ` AND e.tipo=$${idx++}`; params.push(tipo); }
    if (busca)    { sql += ` AND (e.descricao ILIKE $${idx} OR COALESCE(e.memo,'') ILIKE $${idx})`; params.push(`%${busca}%`); idx++; }
    sql += ' ORDER BY e.data DESC, e.id DESC LIMIT 500';
    res.json(await db.all(sql, params));
  } catch (err) {
    console.error('[conciliacao GET]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* GET /resumo */
router.get('/resumo', async (req, res) => {
  try {
    const { conta_id, inicio, fim } = req.query;
    let w = 'WHERE 1=1'; const p = []; let idx = 1;
    if (conta_id) { w += ` AND conta_id=$${idx++}`; p.push(conta_id); }
    if (inicio)   { w += ` AND data>='${dStr(inicio)}'`; }
    if (fim)      { w += ` AND data<='${dStr(fim)}'`; }
    const r = await db.get(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='credito' THEN valor ELSE 0 END),0)              AS total_credito,
        COALESCE(SUM(CASE WHEN tipo='debito'  THEN valor ELSE 0 END),0)              AS total_debito,
        COUNT(*)                                                                      AS total_linhas,
        COUNT(CASE WHEN status='conciliado'                       THEN 1 END)        AS conciliados,
        COUNT(CASE WHEN status NOT IN ('conciliado','ignorado')   THEN 1 END)        AS pendentes,
        COUNT(CASE WHEN status='divergencia'                      THEN 1 END)        AS divergencias,
        COUNT(CASE WHEN status='sugestao'                         THEN 1 END)        AS com_sugestao,
        COUNT(CASE WHEN status='ignorado'                         THEN 1 END)        AS ignorados,
        COALESCE(SUM(CASE WHEN status='conciliado' AND tipo='credito' THEN valor ELSE 0 END),0) AS conciliado_credito,
        COALESCE(SUM(CASE WHEN status='conciliado' AND tipo='debito'  THEN valor ELSE 0 END),0) AS conciliado_debito
      FROM extrato_bancario ${w}
    `, p);
    res.json(r);
  } catch (err) {
    console.error('[resumo]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* GET /lancamentos-pendentes */
router.get('/lancamentos-pendentes', async (req, res) => {
  try {
    const { conta_id, inicio, fim, busca } = req.query;
    let sql = `
      SELECT l.*,
        cat.nome AS categoria_nome, cat.cor AS categoria_cor,
        cli.nome  AS cliente_nome,
        forn.nome AS fornecedor_nome
      FROM lancamentos l
      LEFT JOIN categorias   cat  ON cat.id  = l.categoria_id
      LEFT JOIN clientes     cli  ON cli.id  = l.cliente_id
      LEFT JOIN fornecedores forn ON forn.id = l.fornecedor_id
      WHERE l.status NOT IN ('cancelado','pago')
        AND l.id NOT IN (
          SELECT lancamento_id FROM extrato_bancario WHERE lancamento_id IS NOT NULL
        )
    `;
    const params = []; let idx = 1;
    if (conta_id) { sql += ` AND l.conta_id=$${idx++}`; params.push(conta_id); }
    if (inicio)   { sql += ` AND l.data_vencimento>='${dStr(inicio)}'`; }
    if (fim)      { sql += ` AND l.data_vencimento<='${dStr(fim)}'`; }
    if (busca)    {
      sql += ` AND (l.descricao ILIKE $${idx} OR COALESCE(cli.nome,'') ILIKE $${idx} OR COALESCE(forn.nome,'') ILIKE $${idx})`;
      params.push(`%${busca}%`); idx++;
    }
    sql += ' ORDER BY l.data_vencimento ASC LIMIT 200';
    res.json(await db.all(sql, params));
  } catch (err) {
    console.error('[lancamentos-pendentes]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* GET /:id/sugestoes */
router.get('/:id/sugestoes', async (req, res) => {
  try {
    const extrato = await db.get('SELECT * FROM extrato_bancario WHERE id=$1', [req.params.id]);
    if (!extrato) return res.status(404).json({ erro: 'Extrato não encontrado' });

    const candidatos = await buscarCandidatos(extrato, 30);
    const scored = candidatos
      .map(l => { const r = calcularScore(extrato, l); return r ? { ...l, ...r } : null; })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    if (scored.length > 0 && extrato.status === 'nao_analisado') {
      await db.run('UPDATE extrato_bancario SET status=$1, score_sugestao=$2 WHERE id=$3',
        ['sugestao', scored[0].score, req.params.id]);
    }

    res.json(scored);
  } catch (err) {
    console.error('[sugestoes]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* GET /historico/:id */
router.get('/historico/:id', async (req, res) => {
  try {
    const logs = await db.all(`
      SELECT cl.*, u.nome AS usuario_nome
      FROM conciliacao_log cl
      LEFT JOIN usuarios u ON u.id = cl.usuario_id
      WHERE cl.extrato_id = $1
      ORDER BY cl.criado_em DESC
    `, [req.params.id]);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/* POST / — inserir manualmente */
router.post('/', async (req, res) => {
  try {
    const { conta_id, data, descricao, valor, tipo, memo } = req.body;
    if (!conta_id || !data || !descricao || !valor || !tipo)
      return res.status(400).json({ erro: 'Campos obrigatórios: conta_id, data, descricao, valor, tipo' });
    const valorNum = Math.abs(parseFloat(valor));
    if (isNaN(valorNum) || valorNum === 0) return res.status(400).json({ erro: 'Valor inválido' });
    const id = await db.insert(
      `INSERT INTO extrato_bancario (conta_id, data, descricao, valor, tipo, memo, origem, status, conciliado)
       VALUES ($1,$2,$3,$4,$5,$6,'manual','nao_analisado',0)`,
      [conta_id, dStr(data), descricao, valorNum, tipo, memo || null]
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error('[POST /]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* POST /importar */
router.post('/importar', async (req, res) => {
  try {
    const { conta_id, formato, conteudo } = req.body;
    if (!conta_id) return res.status(400).json({ erro: 'conta_id obrigatório' });
    if (!conteudo) return res.status(400).json({ erro: 'conteudo obrigatório' });

    let itens = [];
    if (['ofx', 'ofc'].includes(formato)) {
      itens = parseOFX(conteudo);
    } else {
      itens = parseCsv(conteudo);
    }
    if (!itens.length) return res.status(400).json({ erro: 'Nenhuma linha válida encontrada' });

    const client = await db.pool.connect();
    let count = 0, pulados = 0;
    try {
      await client.query('BEGIN');
      for (const it of itens) {
        if (!it.data || it.valor <= 0) { pulados++; continue; }
        if (it.fitid) {
          const dup = await client.query(
            'SELECT id FROM extrato_bancario WHERE conta_id=$1 AND fitid=$2',
            [conta_id, it.fitid]
          );
          if (dup.rows.length > 0) { pulados++; continue; }
        }
        await client.query(
          `INSERT INTO extrato_bancario (conta_id, data, descricao, valor, tipo, fitid, origem, status, conciliado)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'nao_analisado',0)`,
          [conta_id, it.data, it.descricao, it.valor, it.tipo, it.fitid || null, formato || 'csv']
        );
        count++;
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    res.json({ importados: count, pulados, total: itens.length });
  } catch (err) {
    console.error('[importar]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* POST /auto-conciliar */
router.post('/auto-conciliar', async (req, res) => {
  try {
    const { conta_id, inicio, fim, threshold = 70 } = req.body;
    const hoje = new Date().toISOString().split('T')[0];

    let sql = `SELECT * FROM extrato_bancario WHERE status NOT IN ('conciliado','ignorado')`;
    const params = []; let idx = 1;
    if (conta_id) { sql += ` AND conta_id=$${idx++}`; params.push(conta_id); }
    if (inicio)   { sql += ` AND data>='${dStr(inicio)}'`; }
    if (fim)      { sql += ` AND data<='${dStr(fim)}'`; }
    sql += ' ORDER BY data ASC';

    const extratos = await db.all(sql, params);
    let conciliados = 0;
    const usados = new Set();

    for (const e of extratos) {
      const candidatos = await buscarCandidatos(e, 7, conta_id);
      const best = candidatos
        .map(l => { const r = calcularScore(e, l); return r ? { ...l, ...r } : null; })
        .filter(b => b && b.score >= threshold && !usados.has(b.id))
        .sort((a, b) => b.score - a.score)[0];

      if (best) {
        const diffVal = Math.abs(e.valor - best.valor);
        await db.run(
          `UPDATE extrato_bancario SET conciliado=1, lancamento_id=$1, status='conciliado',
           score_sugestao=$2, divergencia_valor=$3 WHERE id=$4`,
          [best.id, best.score, diffVal > 0.01 ? diffVal : null, e.id]
        );
        await db.run(
          `UPDATE lancamentos SET status='pago', data_pagamento='${hoje}' WHERE id=$1`, [best.id]
        );
        await db.run(
          `INSERT INTO conciliacao_log (extrato_id, lancamento_id, acao, dados_depois)
           VALUES ($1,$2,'auto-conciliar',$3)`,
          [e.id, best.id, JSON.stringify({ score: best.score, motivos: best.motivos })]
        );
        usados.add(best.id);
        conciliados++;
      }
    }

    res.json({ conciliados, total: extratos.length });
  } catch (err) {
    console.error('[auto-conciliar]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* POST /lote-conciliar */
router.post('/lote-conciliar', async (req, res) => {
  try {
    const { ids, threshold = 60 } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ erro: 'ids[] obrigatório' });
    const hoje = new Date().toISOString().split('T')[0];
    let conciliados = 0;
    const usados = new Set();

    for (const id of ids) {
      const e = await db.get('SELECT * FROM extrato_bancario WHERE id=$1', [id]);
      if (!e || e.status === 'conciliado') continue;
      const candidatos = await buscarCandidatos(e, 7);
      const best = candidatos
        .map(l => { const r = calcularScore(e, l); return r ? { ...l, ...r } : null; })
        .filter(b => b && b.score >= threshold && !usados.has(b.id))
        .sort((a, b) => b.score - a.score)[0];

      if (best) {
        const diffVal = Math.abs(e.valor - best.valor);
        await db.run(
          `UPDATE extrato_bancario SET conciliado=1, lancamento_id=$1, status='conciliado',
           score_sugestao=$2, divergencia_valor=$3 WHERE id=$4`,
          [best.id, best.score, diffVal > 0.01 ? diffVal : null, id]
        );
        await db.run(
          `UPDATE lancamentos SET status='pago', data_pagamento='${hoje}' WHERE id=$1`, [best.id]
        );
        usados.add(best.id);
        conciliados++;
      }
    }

    res.json({ conciliados, total: ids.length });
  } catch (err) {
    console.error('[lote-conciliar]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* PATCH /:id/conciliar — vincular manualmente */
router.patch('/:id/conciliar', async (req, res) => {
  try {
    const { lancamento_id } = req.body;
    if (!lancamento_id) return res.status(400).json({ erro: 'lancamento_id obrigatório' });
    const hoje = new Date().toISOString().split('T')[0];

    const extrato = await db.get('SELECT * FROM extrato_bancario WHERE id=$1', [req.params.id]);
    const lanc    = await db.get('SELECT * FROM lancamentos WHERE id=$1', [lancamento_id]);
    if (!extrato || !lanc) return res.status(404).json({ erro: 'Não encontrado' });

    const diffVal = Math.abs(extrato.valor - lanc.valor);
    const score   = calcularScore(extrato, lanc);

    await db.run(
      `UPDATE extrato_bancario SET conciliado=1, lancamento_id=$1, status='conciliado',
       score_sugestao=$2, divergencia_valor=$3 WHERE id=$4`,
      [lancamento_id, score?.score || null, diffVal > 0.01 ? diffVal : null, req.params.id]
    );
    await db.run(
      `UPDATE lancamentos SET status='pago', data_pagamento='${hoje}' WHERE id=$1`, [lancamento_id]
    );
    await db.run(
      `INSERT INTO conciliacao_log (extrato_id, lancamento_id, acao) VALUES ($1,$2,'conciliar-manual')`,
      [req.params.id, lancamento_id]
    );

    res.json({ mensagem: 'Conciliado', divergencia: diffVal > 0.01 ? diffVal : 0 });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/* PATCH /:id/status */
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, observacoes } = req.body;
    const validos = ['nao_analisado', 'ignorado', 'divergencia'];
    if (!validos.includes(status)) return res.status(400).json({ erro: 'Status inválido' });
    await db.run(
      'UPDATE extrato_bancario SET status=$1, observacoes=COALESCE($2,observacoes) WHERE id=$3',
      [status, observacoes || null, req.params.id]
    );
    res.json({ mensagem: 'Atualizado' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/* PATCH /:id/desconciliar */
router.patch('/:id/desconciliar', async (req, res) => {
  try {
    const extrato = await db.get('SELECT * FROM extrato_bancario WHERE id=$1', [req.params.id]);
    if (extrato?.lancamento_id) {
      await db.run(
        `UPDATE lancamentos SET status='pendente', data_pagamento=NULL WHERE id=$1`,
        [extrato.lancamento_id]
      );
    }
    await db.run(
      `UPDATE extrato_bancario SET conciliado=0, lancamento_id=NULL, status='nao_analisado',
       score_sugestao=NULL, divergencia_valor=NULL WHERE id=$1`,
      [req.params.id]
    );
    await db.run(
      `INSERT INTO conciliacao_log (extrato_id, lancamento_id, acao) VALUES ($1,$2,'desconciliar')`,
      [req.params.id, extrato?.lancamento_id || null]
    );
    res.json({ mensagem: 'Desconciliado' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/* POST /criar-lancamento/:id */
router.post('/criar-lancamento/:id', async (req, res) => {
  try {
    const { descricao, categoria_id, conta_id, centro_custo_id, cliente_id, fornecedor_id } = req.body;
    const extrato = await db.get('SELECT * FROM extrato_bancario WHERE id=$1', [req.params.id]);
    if (!extrato) return res.status(404).json({ erro: 'Extrato não encontrado' });

    const tipo = extrato.tipo === 'credito' ? 'receita' : 'despesa';
    const hoje = new Date().toISOString().split('T')[0];

    const lancId = await db.insert(
      `INSERT INTO lancamentos
        (tipo, descricao, valor, data_vencimento, data_pagamento, status,
         categoria_id, conta_id, centro_custo_id, cliente_id, fornecedor_id, origem)
       VALUES ($1,$2,$3,$4,$5,'pago',$6,$7,$8,$9,$10,'conciliacao')`,
      [tipo, descricao || extrato.descricao, extrato.valor, extrato.data, hoje,
       categoria_id || null, conta_id || extrato.conta_id || null,
       centro_custo_id || null, cliente_id || null, fornecedor_id || null]
    );

    await db.run(
      `UPDATE extrato_bancario SET conciliado=1, lancamento_id=$1, status='conciliado' WHERE id=$2`,
      [lancId, req.params.id]
    );
    await db.run(
      `INSERT INTO conciliacao_log (extrato_id, lancamento_id, acao) VALUES ($1,$2,'criar-lancamento')`,
      [req.params.id, lancId]
    );

    res.status(201).json({ id: lancId, mensagem: 'Lançamento criado e conciliado' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/* DELETE /:id */
router.delete('/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM extrato_bancario WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Removido' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
