const express = require('express');
const db = require('../utils/db');
const { autenticar, autorizar } = require('../middlewares/auth');
const router = express.Router();
router.use(autenticar);

const n  = v => parseFloat(v) || 0;
const i  = v => parseInt(v)   || 0;
const pct = (a, b) => b > 0 ? +((a - b) / b * 100).toFixed(1) : null;

function fmtBRL(v) {
  v = v || 0; const neg = v < 0;
  const abs = Math.round(Math.abs(v) * 100);
  const str = String(abs).padStart(3, '0');
  const dec = str.slice(-2);
  const int = str.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + 'R$ ' + int + ',' + dec;
}

// Suporta modo simples (?mes=&ano=) e modo range (?mesI=&anoI=&mesF=&anoF=)
function getPeriodo(req) {
  const now = new Date();

  if (req.query.mesI && req.query.anoI) {
    const mesI = i(req.query.mesI); const anoI = i(req.query.anoI);
    const mesF = i(req.query.mesF) || mesI; const anoF = i(req.query.anoF) || anoI;
    const inicio = `${anoI}-${String(mesI).padStart(2,'0')}-01`;
    const fd = new Date(anoF, mesF, 1);
    const fim = `${fd.getFullYear()}-${String(fd.getMonth()+1).padStart(2,'0')}-01`;
    // w(col): condição de data para o período atual
    const w  = col => `${col} >= '${inicio}' AND ${col} < '${fim}'`;
    // pw(col): sem período anterior em modo range
    const pw = _   => `FALSE`;
    // Condição para tabela metas (sem alias e com alias m.)
    const pair = `${anoI * 12 + mesI} AND ${anoF * 12 + mesF}`;
    const metasCond  = `(ano*12+mes) BETWEEN ${pair}`;
    const metasCondM = `(m.ano*12+m.mes) BETWEEN ${pair}`;
    return { mes: mesI, ano: anoI, mesF, anoF, inicio, fim, pInicio: null, pFim: null, isRange: true, w, pw, metasCond, metasCondM };
  }

  const mes = i(req.query.mes) || (now.getMonth() + 1);
  const ano = i(req.query.ano) || now.getFullYear();
  const mesStr = String(mes).padStart(2, '0');
  const inicio = `${ano}-${mesStr}-01`;
  const fd = new Date(ano, mes, 1);
  const fim = `${fd.getFullYear()}-${String(fd.getMonth()+1).padStart(2,'0')}-01`;
  // Período anterior (mês anterior)
  const pd = new Date(ano, mes - 2, 1);
  const pMes = pd.getMonth() + 1; const pAno = pd.getFullYear();
  const pInicio = `${pAno}-${String(pMes).padStart(2,'0')}-01`;
  const pfd = new Date(pAno, pMes, 1);
  const pFim = `${pfd.getFullYear()}-${String(pfd.getMonth()+1).padStart(2,'0')}-01`;
  const w  = col => `${col} >= '${inicio}' AND ${col} < '${fim}'`;
  const pw = col => `${col} >= '${pInicio}' AND ${col} < '${pFim}'`;
  const metasCond  = `mes=${mes} AND ano=${ano}`;
  const metasCondM = `m.mes=${mes} AND m.ano=${ano}`;
  return { mes, ano, mesStr, inicio, fim, pInicio, pFim, isRange: false, w, pw, metasCond, metasCondM };
}

// Score de performance (0–1000)
function calcScore(v) {
  const meta = n(v.meta);
  const metaPct = meta > 0 ? Math.min(n(v.total_vendido) / meta * 100, 150) : 50;
  const conv    = Math.min(n(v.conversao_pct), 100);
  const pedScore= Math.min(i(v.qtd_pedidos) * 12, 100);
  const tickScore = Math.min(n(v.ticket_medio) / 500, 100);
  const score = (metaPct * 0.40) + (conv * 0.25) + (pedScore * 0.20) + (tickScore * 0.15);
  return Math.round(Math.min(score * 10, 1000));
}

function calcBadges(v, rank, all) {
  const badges = [];
  if (rank === 1 && n(v.total_vendido) > 0)              badges.push({ icon:'trophy',       label:'Campeão do Mês',   cor:'#d4af37' });
  if (n(v.meta) > 0 && n(v.total_vendido) >= n(v.meta))  badges.push({ icon:'crown',        label:'Meta Batida',      cor:'#a78bfa' });
  const maxTicket = Math.max(...all.map(x => n(x.ticket_medio)));
  if (n(v.ticket_medio) === maxTicket && maxTicket > 0)   badges.push({ icon:'gem',          label:'Maior Ticket',     cor:'#22d3ee' });
  const maxConv = Math.max(...all.map(x => n(x.conversao_pct)));
  if (n(v.conversao_pct) === maxConv && maxConv > 0)      badges.push({ icon:'rocket',       label:'Maior Conversão',  cor:'#4ade80' });
  if (n(v.qtd_pedidos) >= 5)                              badges.push({ icon:'zap',          label:'Alta Performance', cor:'#fb923c' });
  if (n(v.total_vendido) > 0 && n(v.meta) === 0)          badges.push({ icon:'alert-circle', label:'Sem Meta Definida',cor:'#64748b' });
  return badges;
}

// ── Overview ─────────────────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const p = getPeriodo(req);
    const { mes, ano, w, pw } = p;

    // Janela de 6 meses para sparklines (terminando no último mês do período)
    const endAno = p.isRange ? p.anoF : ano;
    const endMes = p.isRange ? p.mesF : mes;
    const sd = new Date(endAno, endMes - 6, 1);
    const sparkIni = `${sd.getFullYear()}-${String(sd.getMonth()+1).padStart(2,'0')}-01`;
    const monthKeys = [];
    for (let k = 5; k >= 0; k--) {
      const d = new Date(endAno, endMes - 1 - k, 1);
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    }

    const [fatAtual, fatAnt, pedidos, pedidosAnt, orcamentos, leads, metas,
           topVendedor, topProjetista, comissoes,
           spPed, spCom, spOrc, funilLeads, alertasRow, proxEntregas, followUps] = await Promise.all([
      db.get(`SELECT COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND ${w('criado_em')}`),
      db.get(`SELECT COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND ${pw('criado_em')}`),
      db.get(`SELECT COUNT(*) AS v, COALESCE(AVG(valor_final),0) AS ticket FROM pedidos WHERE status<>'cancelado' AND ${w('criado_em')}`),
      db.get(`SELECT COUNT(*) AS v FROM pedidos WHERE status<>'cancelado' AND ${pw('criado_em')}`),
      db.get(`SELECT COUNT(*) AS total, COUNT(*) FILTER(WHERE status='aprovado') AS aprovados FROM orcamentos WHERE ${w('criado_em')}`),
      db.get(`SELECT COUNT(*) AS total, COUNT(*) FILTER(WHERE etapa='fechado') AS fechados FROM leads WHERE ${w('criado_em')}`),
      db.get(`SELECT COALESCE(SUM(valor_meta),0) AS meta_total, COUNT(*) AS qtd FROM metas WHERE ${p.metasCond}`),
      db.get(`SELECT u.nome, COALESCE(SUM(p.valor_final),0) AS total FROM usuarios u LEFT JOIN pedidos p ON p.vendedor_id=u.id AND p.status<>'cancelado' AND ${w('p.criado_em')} WHERE u.ativo=1 AND u.perfil IN ('vendedor','gestor') GROUP BY u.id,u.nome ORDER BY total DESC LIMIT 1`),
      db.get(`SELECT u.nome, COUNT(o.id) AS total FROM usuarios u LEFT JOIN orcamentos o ON o.projetista_id=u.id AND o.deleted_at IS NULL AND ${w('o.criado_em')} WHERE u.ativo=1 GROUP BY u.id,u.nome ORDER BY total DESC LIMIT 1`),
      db.get(`SELECT COALESCE(SUM(valor_comissao),0) AS total, COALESCE(SUM(valor_comissao) FILTER(WHERE status='pendente'),0) AS pendente FROM comissoes WHERE ${w('data_geracao')}`),
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS m, COALESCE(SUM(valor_final),0) AS v, COUNT(*) AS q, COALESCE(AVG(valor_final),0) AS t FROM pedidos WHERE status<>'cancelado' AND criado_em >= '${sparkIni}' AND criado_em < '${p.fim}' GROUP BY 1 ORDER BY 1`),
      db.all(`SELECT TO_CHAR(data_geracao,'YYYY-MM') AS m, COALESCE(SUM(valor_comissao),0) AS v FROM comissoes WHERE data_geracao >= '${sparkIni}' AND data_geracao < '${p.fim}' GROUP BY 1`),
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS m, COUNT(*) AS total, COUNT(*) FILTER(WHERE status='aprovado') AS apr FROM orcamentos WHERE criado_em >= '${sparkIni}' AND criado_em < '${p.fim}' GROUP BY 1`),
      db.get(`SELECT COUNT(*) AS novos, COUNT(*) FILTER(WHERE etapa NOT IN ('novo','perdido')) AS contato, COUNT(*) FILTER(WHERE etapa='negociacao') AS negociacao FROM leads WHERE ${w('criado_em')}`),
      db.get(`SELECT
        (SELECT COUNT(*) FROM leads WHERE etapa NOT IN ('fechado','perdido') AND atualizado_em < NOW()-INTERVAL '7 days') AS leads_sem_contato,
        (SELECT COUNT(*) FROM orcamentos WHERE status='enviado' AND criado_em < NOW()-INTERVAL '7 days') AS orc_aguardando,
        (SELECT COUNT(*) FROM leads WHERE etapa='negociacao' AND atualizado_em < NOW()-INTERVAL '5 days') AS neg_paradas,
        (SELECT COUNT(*) FROM pedidos WHERE status NOT IN ('concluido','cancelado') AND data_prevista_entrega IS NOT NULL AND data_prevista_entrega < TO_CHAR(CURRENT_DATE,'YYYY-MM-DD')) AS ped_atrasados,
        (SELECT COUNT(*) FROM pedidos WHERE status NOT IN ('concluido','cancelado') AND data_prevista_entrega = TO_CHAR(CURRENT_DATE,'YYYY-MM-DD')) AS entregas_hoje`),
      db.all(`SELECT p.numero, c.nome AS cliente, p.data_prevista_entrega AS quando FROM pedidos p JOIN clientes c ON c.id=p.cliente_id WHERE p.status NOT IN ('concluido','cancelado') AND p.data_prevista_entrega IS NOT NULL AND p.data_prevista_entrega >= TO_CHAR(CURRENT_DATE,'YYYY-MM-DD') ORDER BY p.data_prevista_entrega ASC LIMIT 4`),
      db.all(`SELECT nome, etapa, TO_CHAR(atualizado_em,'YYYY-MM-DD') AS quando FROM leads WHERE etapa IN ('visita','proposta','negociacao') ORDER BY atualizado_em ASC LIMIT 3`),
    ]);

    const fv = n(fatAtual.v), fpv = n(fatAnt.v);
    const metaTotal = n(metas.meta_total);
    const metaPct   = metaTotal > 0 ? +((fv / metaTotal) * 100).toFixed(1) : null;
    const convOrc   = i(orcamentos.total) > 0 ? +((i(orcamentos.aprovados) / i(orcamentos.total)) * 100).toFixed(1) : 0;
    const convLead  = i(leads.total) > 0 ? +((i(leads.fechados) / i(leads.total)) * 100).toFixed(1) : 0;

    const mapBy = rows => Object.fromEntries((rows || []).map(r => [r.m, r]));
    const pm = mapBy(spPed), cm = mapBy(spCom), om = mapBy(spOrc);
    const sparks = {
      labels:      monthKeys,
      faturamento: monthKeys.map(k => n(pm[k]?.v)),
      pedidos:     monthKeys.map(k => i(pm[k]?.q)),
      ticket:      monthKeys.map(k => n(pm[k]?.t)),
      comissao:    monthKeys.map(k => n(cm[k]?.v)),
      conversao:   monthKeys.map(k => { const o = om[k]; return o && i(o.total) > 0 ? +((i(o.apr) / i(o.total)) * 100).toFixed(1) : 0; }),
    };

    const ETAPA_LABEL = { visita: 'Visita agendada', proposta: 'Proposta em aberto', negociacao: 'Em negociação' };
    const acoes = [
      ...(proxEntregas || []).map(e => ({ icon: 'truck', titulo: `Entrega — ${e.cliente}`, sub: `Pedido ${e.numero}`, quando: e.quando })),
      ...(followUps || []).map(l => ({ icon: l.etapa === 'visita' ? 'map-pin' : l.etapa === 'proposta' ? 'file-text' : 'handshake', titulo: `Follow-up — ${l.nome}`, sub: ETAPA_LABEL[l.etapa] || l.etapa, quando: l.quando })),
    ];

    res.json({
      periodo: { mes, ano, isRange: p.isRange },
      faturamento:  { val: fv, anterior: fpv, variacao: pct(fv, fpv), spark: sparks.faturamento },
      meta:         { total: metaTotal, pct: metaPct, qtdVendedores: i(metas.qtd) },
      pedidos:      { total: i(pedidos.v), anterior: i(pedidosAnt.v), ticket: n(pedidos.ticket), variacao: pct(i(pedidos.v), i(pedidosAnt.v)) },
      conversaoOrc: convOrc,
      conversaoLead: convLead,
      topVendedor:  topVendedor || null,
      topProjetista: topProjetista || null,
      comissoes:    { total: n(comissoes.total), pendente: n(comissoes.pendente) },
      sparks,
      funil: {
        novos:      i(funilLeads.novos),
        contato:    i(funilLeads.contato),
        orcamentos: i(orcamentos.total),
        negociacao: i(funilLeads.negociacao),
        pedidos:    i(pedidos.v),
      },
      alertas: {
        leadsSemContato:      i(alertasRow.leads_sem_contato),
        orcamentosAguardando: i(alertasRow.orc_aguardando),
        negociacoesParadas:   i(alertasRow.neg_paradas),
        pedidosAtrasados:     i(alertasRow.ped_atrasados),
        entregasHoje:         i(alertasRow.entregas_hoje),
      },
      acoes,
    });
  } catch (err) {
    console.error('[ranking/overview]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── Ranking Vendedores ────────────────────────────────────────────────
router.get('/vendedores', async (req, res) => {
  try {
    const p = getPeriodo(req);
    const { mes, ano, w, pw } = p;

    const vendedores = await db.all(`
      SELECT
        u.id, u.nome, u.perfil,
        COALESCE(SUM(p.valor_final),0)                                                 AS total_vendido,
        COUNT(p.id)                                                                    AS qtd_pedidos,
        COALESCE(AVG(p.valor_final),0)                                                 AS ticket_medio,
        COALESCE(m.valor_meta,0)                                                       AS meta,
        COALESCE(
          COUNT(p.id)::float /
          NULLIF((COUNT(p.id) + (SELECT COUNT(*) FROM leads l WHERE l.vendedor_id=u.id AND ${w('l.criado_em')}))::float, 0) * 100
        , 0)                                                                           AS conversao_pct,
        COALESCE((SELECT SUM(c.valor_comissao) FROM comissoes c WHERE c.pessoa_id=u.id AND c.tipo='vendedor' AND ${w('c.data_geracao')}),0) AS comissao,
        COALESCE((SELECT SUM(p2.valor_final) FROM pedidos p2 WHERE p2.vendedor_id=u.id AND p2.status<>'cancelado' AND ${pw('p2.criado_em')}),0) AS total_anterior,
        COUNT(DISTINCT p.cliente_id)                                                   AS qtd_clientes,
        (SELECT COUNT(*) FROM orcamentos o WHERE o.vendedor_id=u.id AND ${w('o.criado_em')}) AS qtd_orcamentos
      FROM usuarios u
      LEFT JOIN pedidos p ON p.vendedor_id=u.id AND p.status<>'cancelado' AND ${w('p.criado_em')}
      LEFT JOIN metas m ON m.vendedor_id=u.id AND ${p.metasCondM}
      WHERE u.ativo=1 AND u.perfil IN ('vendedor','gestor')
      GROUP BY u.id, u.nome, u.perfil, m.valor_meta
      ORDER BY total_vendido DESC
    `);

    const enriched = vendedores.map((v, idx) => {
      const score = calcScore(v);
      const badges = calcBadges(v, idx + 1, vendedores);
      const metaPct = n(v.meta) > 0 ? +((n(v.total_vendido) / n(v.meta)) * 100).toFixed(1) : null;
      const variacao = pct(n(v.total_vendido), n(v.total_anterior));
      return { ...v, score, badges, metaPct, variacao, rank: idx + 1 };
    });

    res.json(enriched);
  } catch (err) {
    console.error('[ranking/vendedores]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── Ranking Projetistas ───────────────────────────────────────────────
router.get('/projetistas', async (req, res) => {
  try {
    const p = getPeriodo(req);
    const { w, pw } = p;

    const projetistas = await db.all(`
      SELECT
        u.id, u.nome, u.perfil,
        COUNT(o.id)                                AS qtd_projetos,
        COUNT(p.id) FILTER(WHERE p.status='concluido') AS concluidos,
        COUNT(p.id) FILTER(WHERE p.status NOT IN ('concluido','cancelado')
          AND p.data_prevista_entrega IS NOT NULL
          AND p.data_prevista_entrega < TO_CHAR(CURRENT_DATE,'YYYY-MM-DD')) AS atrasados,
        COALESCE(SUM(o.valor_final),0)             AS valor_total,
        COALESCE(AVG(o.valor_final),0)             AS ticket_medio,
        COALESCE(
          COUNT(p.id) FILTER(WHERE p.status='concluido')::float / NULLIF(COUNT(o.id)::float, 0) * 100
        ,0)                                        AS taxa_conclusao,
        COALESCE((SELECT SUM(c.valor_comissao) FROM comissoes c WHERE c.pessoa_id=u.id AND ${w('c.data_geracao')}),0) AS comissao,
        COALESCE((SELECT COUNT(*) FROM orcamentos o2 WHERE o2.projetista_id=u.id AND o2.deleted_at IS NULL AND ${pw('o2.criado_em')}),0) AS projetos_anterior
      FROM usuarios u
      LEFT JOIN orcamentos o ON o.projetista_id=u.id AND o.deleted_at IS NULL AND ${w('o.criado_em')}
      LEFT JOIN pedidos p ON p.orcamento_id=o.id
      WHERE u.ativo=1
      GROUP BY u.id, u.nome, u.perfil
      HAVING COUNT(o.id) > 0
      ORDER BY valor_total DESC
    `);

    const enriched = projetistas.map((p2, idx) => ({
      ...p2,
      rank: idx + 1,
      variacao: pct(i(p2.qtd_projetos), i(p2.projetos_anterior)),
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[ranking/projetistas]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── Metas — GET ───────────────────────────────────────────────────────
router.get('/metas', async (req, res) => {
  try {
    const p = getPeriodo(req);
    const { mes, ano, w } = p;

    let metas, semMeta;

    if (p.isRange) {
      // Modo range: agrega metas por vendedor ao longo do período
      metas = await db.all(`
        SELECT
          m.vendedor_id, u.nome, u.perfil,
          COALESCE(SUM(m.valor_meta),0) AS valor_meta,
          COALESCE(SUM(p.valor_final),0) AS realizado,
          COUNT(DISTINCT p.id) AS qtd_pedidos,
          NULL::int AS id, NULL::int AS mes, NULL::int AS ano
        FROM metas m
        JOIN usuarios u ON u.id=m.vendedor_id
        LEFT JOIN pedidos p ON p.vendedor_id=m.vendedor_id AND p.status<>'cancelado' AND ${w('p.criado_em')}
        WHERE ${p.metasCondM}
        GROUP BY m.vendedor_id, u.nome, u.perfil
        ORDER BY (COALESCE(SUM(p.valor_final),0)/NULLIF(SUM(m.valor_meta),0)) DESC
      `);
      semMeta = await db.all(`
        SELECT u.id AS vendedor_id, u.nome, u.perfil,
          COALESCE(SUM(p.valor_final),0) AS realizado, COUNT(p.id) AS qtd_pedidos
        FROM usuarios u
        LEFT JOIN pedidos p ON p.vendedor_id=u.id AND p.status<>'cancelado' AND ${w('p.criado_em')}
        WHERE u.ativo=1 AND u.perfil IN ('vendedor','gestor')
          AND u.id NOT IN (SELECT DISTINCT vendedor_id FROM metas WHERE ${p.metasCond})
        GROUP BY u.id, u.nome, u.perfil
        ORDER BY realizado DESC
      `);
    } else {
      metas = await db.all(`
        SELECT
          m.id, m.vendedor_id, u.nome, u.perfil, m.valor_meta, m.mes, m.ano,
          COALESCE(SUM(p.valor_final),0) AS realizado,
          COUNT(p.id) AS qtd_pedidos
        FROM metas m
        JOIN usuarios u ON u.id=m.vendedor_id
        LEFT JOIN pedidos p ON p.vendedor_id=m.vendedor_id AND p.status<>'cancelado'
          AND ${w('p.criado_em')}
        WHERE ${p.metasCondM}
        GROUP BY m.id, m.vendedor_id, u.nome, u.perfil, m.valor_meta, m.mes, m.ano
        ORDER BY (COALESCE(SUM(p.valor_final),0)/NULLIF(m.valor_meta,0)) DESC
      `);
      semMeta = await db.all(`
        SELECT u.id AS vendedor_id, u.nome, u.perfil,
          COALESCE(SUM(p.valor_final),0) AS realizado, COUNT(p.id) AS qtd_pedidos
        FROM usuarios u
        LEFT JOIN pedidos p ON p.vendedor_id=u.id AND p.status<>'cancelado' AND ${w('p.criado_em')}
        WHERE u.ativo=1 AND u.perfil IN ('vendedor','gestor')
          AND u.id NOT IN (SELECT vendedor_id FROM metas WHERE ${p.metasCond})
        GROUP BY u.id, u.nome, u.perfil
        ORDER BY realizado DESC
      `);
    }

    res.json({
      periodo: { mes, ano, isRange: p.isRange },
      metas: metas.map(m => ({
        ...m,
        pct: n(m.valor_meta) > 0 ? +((n(m.realizado) / n(m.valor_meta)) * 100).toFixed(1) : 0,
        faltam: Math.max(n(m.valor_meta) - n(m.realizado), 0),
      })),
      semMeta,
    });
  } catch (err) {
    console.error('[ranking/metas]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── Metas — POST (criar/atualizar) ───────────────────────────────────
router.post('/metas', autorizar('metas','edicao'), async (req, res) => {
  try {
    const { vendedor_id, mes, ano, valor_meta } = req.body;
    if (!vendedor_id || !mes || !ano || !valor_meta) return res.status(400).json({ erro: 'Campos obrigatórios ausentes' });
    await db.run(`
      INSERT INTO metas (vendedor_id, mes, ano, valor_meta)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (vendedor_id, mes, ano) DO UPDATE SET valor_meta=$4
    `, [vendedor_id, mes, ano, valor_meta]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[ranking/metas POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── Metas — DELETE ────────────────────────────────────────────────────
router.delete('/metas/:id', autorizar('metas','edicao'), async (req, res) => {
  try {
    await db.run(`DELETE FROM metas WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── Conquistas ────────────────────────────────────────────────────────
router.get('/conquistas', async (req, res) => {
  try {
    const p = getPeriodo(req);
    const { mes, ano, w, pw } = p;

    const vendedores = await db.all(`
      SELECT u.id, u.nome,
        COALESCE(SUM(p.valor_final),0) AS total,
        COUNT(p.id) AS pedidos,
        COALESCE(AVG(p.valor_final),0) AS ticket,
        COALESCE(m.valor_meta,0) AS meta,
        COALESCE((SELECT SUM(p2.valor_final) FROM pedidos p2 WHERE p2.vendedor_id=u.id AND p2.status<>'cancelado' AND ${pw('p2.criado_em')}),0) AS total_ant
      FROM usuarios u
      LEFT JOIN pedidos p ON p.vendedor_id=u.id AND p.status<>'cancelado' AND ${w('p.criado_em')}
      LEFT JOIN metas m ON m.vendedor_id=u.id AND ${p.metasCondM}
      WHERE u.ativo=1 AND u.perfil IN ('vendedor','gestor')
      GROUP BY u.id, u.nome, m.valor_meta
      ORDER BY total DESC
    `);

    const conquistas = [];

    const campiao = vendedores[0];
    if (campiao && n(campiao.total) > 0) {
      conquistas.push({ tipo:'campeao', icon:'trophy', label:'Campeão do Mês', nome: campiao.nome, valor: fmtBRL(n(campiao.total)), cor:'#d4af37', descricao:'Maior faturamento do mês' });
    }

    const metaBatida = vendedores.filter(v => n(v.meta) > 0 && n(v.total) >= n(v.meta));
    metaBatida.forEach(v => {
      conquistas.push({ tipo:'meta', icon:'crown', label:'Meta Batida', nome: v.nome, valor: `${((n(v.total)/n(v.meta))*100).toFixed(0)}%`, cor:'#a78bfa', descricao:`Atingiu ${((n(v.total)/n(v.meta))*100).toFixed(0)}% da meta` });
    });

    const maxTicketV = vendedores.reduce((best, v) => n(v.ticket) > n(best.ticket) ? v : best, vendedores[0] || {});
    if (maxTicketV && n(maxTicketV.ticket) > 0) {
      conquistas.push({ tipo:'ticket', icon:'gem', label:'Maior Ticket Médio', nome: maxTicketV.nome, valor: fmtBRL(n(maxTicketV.ticket)), cor:'#22d3ee', descricao:'Maior ticket médio por pedido' });
    }

    const melhorCrescimento = vendedores
      .filter(v => n(v.total_ant) > 0 && n(v.total) > n(v.total_ant))
      .reduce((best, v) => {
        const g = (n(v.total) - n(v.total_ant)) / n(v.total_ant);
        const bg = best ? (n(best.total) - n(best.total_ant)) / n(best.total_ant) : -1;
        return g > bg ? v : best;
      }, null);
    if (melhorCrescimento) {
      const g = ((n(melhorCrescimento.total) - n(melhorCrescimento.total_ant)) / n(melhorCrescimento.total_ant) * 100).toFixed(0);
      conquistas.push({ tipo:'crescimento', icon:'trending-up', label:'Maior Crescimento', nome: melhorCrescimento.nome, valor: `+${g}%`, cor:'#4ade80', descricao:'Maior crescimento vs período anterior' });
    }

    const altaPerf = vendedores.filter(v => i(v.pedidos) >= 5);
    altaPerf.forEach(v => {
      conquistas.push({ tipo:'performance', icon:'zap', label:'Alta Performance', nome: v.nome, valor: `${v.pedidos} pedidos`, cor:'#fb923c', descricao:'5 ou mais pedidos no período' });
    });

    res.json({ conquistas, periodo: { mes, ano, isRange: p.isRange } });
  } catch (err) {
    console.error('[ranking/conquistas]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── Individual ────────────────────────────────────────────────────────
router.get('/individuo/:id', async (req, res) => {
  try {
    const p = getPeriodo(req);
    const { mes, ano, w } = p;
    const id = req.params.id;

    const [usuario, pedidosMes, ped12m, orcamentos, leads, comissoes, metas6m] = await Promise.all([
      db.get(`SELECT id, nome, perfil, email FROM usuarios WHERE id=$1`, [id]),
      db.get(`SELECT COALESCE(SUM(valor_final),0) AS total, COUNT(*) AS qtd, COALESCE(AVG(valor_final),0) AS ticket FROM pedidos WHERE vendedor_id=$1 AND status<>'cancelado' AND ${w('criado_em')}`, [id]),
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS m, COALESCE(SUM(valor_final),0) AS v, COUNT(*) AS qtd FROM pedidos WHERE vendedor_id=$1 AND status<>'cancelado' AND criado_em >= NOW()-INTERVAL '12 months' GROUP BY m ORDER BY m`, [id]),
      db.get(`SELECT COUNT(*) AS total, COUNT(*) FILTER(WHERE status='aprovado') AS aprovados FROM orcamentos WHERE vendedor_id=$1 AND ${w('criado_em')}`, [id]),
      db.get(`SELECT COUNT(*) AS total, COUNT(*) FILTER(WHERE etapa='fechado') AS fechados FROM leads WHERE vendedor_id=$1 AND ${w('criado_em')}`, [id]),
      db.all(`SELECT status, COALESCE(SUM(valor_comissao),0) AS v FROM comissoes WHERE pessoa_id=$1 GROUP BY status`, [id]),
      db.all(`SELECT m.mes, m.ano, m.valor_meta, COALESCE(SUM(p.valor_final),0) AS realizado FROM metas m LEFT JOIN pedidos p ON p.vendedor_id=m.vendedor_id AND p.status<>'cancelado' AND p.criado_em::date >= make_date(m.ano::int,m.mes::int,1) AND p.criado_em::date < make_date(m.ano::int,m.mes::int,1) + INTERVAL '1 month' WHERE m.vendedor_id=$1 AND (m.ano*100+m.mes) >= ${(ano - 1)*100+mes} ORDER BY m.ano,m.mes LIMIT 6`, [id]),
    ]);

    const meta = !p.isRange
      ? await db.get(`SELECT valor_meta FROM metas WHERE vendedor_id=$1 AND mes=${mes} AND ano=${ano}`, [id])
      : null;
    const ultimosPedidos = await db.all(`SELECT p.numero, c.nome AS cliente, p.valor_final, p.status, p.criado_em FROM pedidos p JOIN clientes c ON c.id=p.cliente_id WHERE p.vendedor_id=$1 AND p.status<>'cancelado' ORDER BY p.criado_em DESC LIMIT 10`, [id]);

    res.json({
      usuario, pedidosMes, ped12m, orcamentos, leads, comissoes, metas6m,
      meta: meta ? n(meta.valor_meta) : 0,
      ultimosPedidos,
    });
  } catch (err) {
    console.error('[ranking/individuo]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── IA Performance ────────────────────────────────────────────────────
router.get('/ia', async (req, res) => {
  try {
    const p = getPeriodo(req);
    const { mes, ano, w, pw } = p;

    const [vendedores, totFat, totFatAnt, semVenda, convBaixa, semMeta, atrasados] = await Promise.all([
      db.all(`SELECT u.nome, COALESCE(SUM(p.valor_final),0) AS total, COALESCE(m.valor_meta,0) AS meta, COUNT(p.id) AS pedidos FROM usuarios u LEFT JOIN pedidos p ON p.vendedor_id=u.id AND p.status<>'cancelado' AND ${w('p.criado_em')} LEFT JOIN metas m ON m.vendedor_id=u.id AND ${p.metasCondM} WHERE u.ativo=1 AND u.perfil IN ('vendedor','gestor') GROUP BY u.id,u.nome,m.valor_meta ORDER BY total DESC`),
      db.get(`SELECT COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND ${w('criado_em')}`),
      db.get(`SELECT COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND ${pw('criado_em')}`),
      db.all(`SELECT u.nome FROM usuarios u LEFT JOIN pedidos p ON p.vendedor_id=u.id AND ${w('p.criado_em')} WHERE u.ativo=1 AND u.perfil IN ('vendedor','gestor') GROUP BY u.id,u.nome HAVING COUNT(p.id)=0`),
      db.all(`SELECT u.nome, COALESCE(COUNT(p.id)::float/NULLIF((SELECT COUNT(*) FROM leads l WHERE l.vendedor_id=u.id AND ${w('l.criado_em')})::float+COUNT(p.id)::float,0)*100,0) AS conv FROM usuarios u LEFT JOIN pedidos p ON p.vendedor_id=u.id AND p.status<>'cancelado' AND ${w('p.criado_em')} WHERE u.ativo=1 AND u.perfil IN ('vendedor','gestor') GROUP BY u.id,u.nome HAVING COALESCE(COUNT(p.id)::float/NULLIF((SELECT COUNT(*) FROM leads l WHERE l.vendedor_id=u.id AND ${w('l.criado_em')})::float+COUNT(p.id)::float,0)*100,0)<25 AND COUNT(p.id)>0`),
      db.all(`SELECT u.nome FROM usuarios u WHERE u.ativo=1 AND u.perfil IN ('vendedor','gestor') AND u.id NOT IN (SELECT DISTINCT vendedor_id FROM metas WHERE ${p.metasCond})`),
      db.get(`SELECT COUNT(*) AS v FROM pedidos WHERE status NOT IN ('concluido','cancelado') AND data_prevista_entrega IS NOT NULL AND data_prevista_entrega < CURRENT_DATE::text`),
    ]);

    const insights = [];
    const fv = n(totFat.v), fpv = n(totFatAnt.v);

    if (fv > 0 && fpv > 0) {
      const vari = (fv - fpv) / fpv * 100;
      if (vari >= 15) insights.push({ tipo:'sucesso', icon:'trending-up',   titulo:'Equipe em Alta',      msg:`Faturamento cresceu ${vari.toFixed(0)}% vs período anterior. Equipe está performando bem — mantenha o ritmo!` });
      else if (vari <= -15) insights.push({ tipo:'perigo', icon:'trending-down', titulo:'Queda na Equipe', msg:`Faturamento caiu ${Math.abs(vari).toFixed(0)}% vs período anterior. Reveja metas, treinamentos e abordagem de vendas.` });
    }

    if (!p.isRange) {
      const now2 = new Date();
      const diasMes = new Date(ano, mes, 0).getDate();
      const diaAtual = mes === (now2.getMonth()+1) && ano === now2.getFullYear() ? now2.getDate() : diasMes;
      if (diaAtual > 0 && fv > 0) {
        const projFinal = (fv / diaAtual) * diasMes;
        insights.push({ tipo:'info', icon:'cpu', titulo:'Previsão do Mês', msg:`Com o ritmo atual, o faturamento de ${mes}/${ano} pode fechar em aproximadamente ${fmtBRL(projFinal)}.` });
      }
    }

    if (semVenda.length) {
      insights.push({ tipo:'alerta', icon:'alert-triangle', titulo:'Vendedores Sem Vendas', msg:`${semVenda.map(v=>v.nome).join(', ')} não registraram vendas no período. Verifique se precisam de suporte ou treinamento.` });
    }

    if (convBaixa.length) {
      insights.push({ tipo:'warning', icon:'percent', titulo:'Conversão Baixa', msg:`${convBaixa.map(v=>v.nome).join(', ')} com taxa de conversão abaixo de 25%. Reveja abordagem e follow-up com leads.` });
    }

    if (semMeta.length) {
      insights.push({ tipo:'alerta', icon:'target', titulo:'Metas Não Definidas', msg:`${semMeta.map(v=>v.nome).join(', ')} não possuem meta definida para o período. Defina metas para melhorar o acompanhamento.` });
    }

    if (i(atrasados.v) > 0) {
      insights.push({ tipo:'perigo', icon:'clock', titulo:'Produção com Atrasos', msg:`${atrasados.v} pedido(s) em atraso na produção. Isso pode impactar a satisfação do cliente e as comissões da equipe.` });
    }

    const melhor = vendedores[0];
    if (melhor && n(melhor.total) > 0 && n(melhor.meta) === 0) {
      insights.push({ tipo:'info', icon:'lightbulb', titulo:'Sugestão de Meta', msg:`Baseado no histórico, sugerimos definir meta de ${fmtBRL(n(melhor.total) * 1.10)} para ${melhor.nome} no próximo período (+10% sobre o atual).` });
    }

    if (!insights.length) insights.push({ tipo:'sucesso', icon:'check-circle', titulo:'Tudo em Ordem', msg:'Todos os indicadores estão saudáveis. Continue acompanhando o desempenho!' });

    res.json({ insights, periodo: { mes, ano, isRange: p.isRange } });
  } catch (err) {
    console.error('[ranking/ia]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
