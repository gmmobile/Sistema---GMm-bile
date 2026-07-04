const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

// Micro-cache de 20s: o dashboard dispara 13 requisições de agregados por
// carga; com o cache, recargas e trocas de aba respondem na hora sem
// consultar o Neon de novo. 20s de defasagem é aceitável para estes números.
const _cache = new Map();
const CACHE_TTL = 20000;
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const chave = req.originalUrl;
  const hit = _cache.get(chave);
  if (hit && Date.now() - hit.t < CACHE_TTL) return res.json(hit.d);
  const origJson = res.json.bind(res);
  res.json = d => {
    if (res.statusCode === 200) _cache.set(chave, { t: Date.now(), d });
    return origJson(d);
  };
  next();
});

const hoje = () => new Date().toISOString().split('T')[0];
const mes  = () => new Date().toISOString().slice(0, 7);
const mesAnt = () => {
  const [y, m] = mes().split('-').map(Number);
  return m === 1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2,'0')}`;
};
const pct = (atual, ant) => ant > 0 ? +((atual - ant) / ant * 100).toFixed(1) : null;
const n = v => parseFloat(v) || 0;
const i = v => parseInt(v) || 0;

// ─── KPIs principais ─────────────────────────────────────────────────────────
router.get('/kpis', async (req, res) => {
  try {
    const m = mes(), mA = mesAnt(), hj = hoje();

    const [
      fatAtual, fatAnt,
      recAtual, recAnt,
      despAtual, despAnt,
      aReceber, aPagar,
      saldoRow,
      cliAtivos, cliNovos, cliNovosAnt,
      pedProd, pedAtras, pedMes,
      leadsAbertos, leadsConv, leadsPerd,
      metaRow,
      orcRow,
      ticketRow,
    ] = await Promise.all([
      db.get(`SELECT COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND TO_CHAR(criado_em,'YYYY-MM')=$1`, [m]),
      db.get(`SELECT COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND TO_CHAR(criado_em,'YYYY-MM')=$1`, [mA]),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='receita' AND status='pago' AND LEFT(COALESCE(data_pagamento,''),7)=$1`, [m]),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='receita' AND status='pago' AND LEFT(COALESCE(data_pagamento,''),7)=$1`, [mA]),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='despesa' AND status='pago' AND LEFT(COALESCE(data_pagamento,''),7)=$1`, [m]),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='despesa' AND status='pago' AND LEFT(COALESCE(data_pagamento,''),7)=$1`, [mA]),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='receita' AND status='pendente'`),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='despesa' AND status='pendente'`),
      db.get(`
        SELECT COALESCE(SUM(cc.saldo_inicial),0)
          + COALESCE((SELECT SUM(l.valor) FROM lancamentos l WHERE l.tipo='receita' AND l.status='pago'),0)
          - COALESCE((SELECT SUM(l.valor) FROM lancamentos l WHERE l.tipo='despesa' AND l.status='pago'),0)
        AS v FROM contas_correntes cc WHERE cc.ativa=1
      `),
      db.get(`SELECT COUNT(*) AS v FROM clientes WHERE ativo=1`),
      db.get(`SELECT COUNT(*) AS v FROM clientes WHERE TO_CHAR(criado_em,'YYYY-MM')=$1`, [m]),
      db.get(`SELECT COUNT(*) AS v FROM clientes WHERE TO_CHAR(criado_em,'YYYY-MM')=$1`, [mA]),
      db.get(`SELECT COUNT(*) AS v FROM pedidos WHERE status IN ('confirmado','medicao','projeto','producao','pronto','entrega','instalacao')`),
      db.get(`SELECT COUNT(*) AS v FROM pedidos WHERE status NOT IN ('concluido','cancelado') AND data_prevista_entrega IS NOT NULL AND data_prevista_entrega < '${hj}'`),
      db.get(`SELECT COUNT(*) AS v FROM pedidos WHERE status<>'cancelado' AND TO_CHAR(criado_em,'YYYY-MM')=$1`, [m]),
      db.get(`SELECT COUNT(*) AS v FROM leads WHERE etapa NOT IN ('fechado','perdido')`),
      db.get(`SELECT COUNT(*) AS v FROM leads WHERE etapa='fechado' AND TO_CHAR(criado_em,'YYYY-MM')=$1`, [m]),
      db.get(`SELECT COUNT(*) AS v FROM leads WHERE etapa='perdido' AND TO_CHAR(criado_em,'YYYY-MM')=$1`, [m]),
      db.get(`SELECT COALESCE(SUM(valor_meta),0) AS v FROM metas WHERE mes=EXTRACT(MONTH FROM NOW()) AND ano=EXTRACT(YEAR FROM NOW())`),
      db.get(`SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_final),0) AS valor FROM orcamentos WHERE status IN ('enviado','rascunho')`),
      db.get(`SELECT COALESCE(AVG(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND TO_CHAR(criado_em,'YYYY-MM')=$1`, [m]),
    ]);

    const fat = n(fatAtual.v), fatA = n(fatAnt.v);
    const rec = n(recAtual.v), recA = n(recAnt.v);
    const desp = n(despAtual.v), despA = n(despAnt.v);
    const lucro = rec - desp, lucroA = recA - despA;
    const margem = rec > 0 ? (lucro / rec * 100) : 0;
    const metaValor = n(metaRow.v);

    res.json({
      faturamento: { mes: fat, anterior: fatA, variacao: pct(fat, fatA) },
      recebido:    { mes: rec, anterior: recA, variacao: pct(rec, recA) },
      aReceber:    { total: n(aReceber.v) },
      aPagar:      { total: n(aPagar.v) },
      despesas:    { mes: desp, anterior: despA, variacao: pct(desp, despA) },
      lucro:       { mes: lucro, anterior: lucroA, variacao: pct(lucro, lucroA), margem: +margem.toFixed(1) },
      saldo:       { total: n(saldoRow.v) },
      clientes:    { ativos: i(cliAtivos.v), novos: i(cliNovos.v), novosAnterior: i(cliNovosAnt.v) },
      pedidos:     { emProd: i(pedProd.v), atrasados: i(pedAtras.v), mes: i(pedMes.v) },
      leads:       { abertos: i(leadsAbertos.v), convertidos: i(leadsConv.v), perdidos: i(leadsPerd.v) },
      meta:        { valor: metaValor, atingido: fat, pct: metaValor > 0 ? +(fat / metaValor * 100).toFixed(1) : 0 },
      orcamentos:  { pendentes: i(orcRow.qtd), valor: n(orcRow.valor) },
      ticketMedio: +n(ticketRow.v).toFixed(2),
    });
  } catch (err) {
    console.error('[dashboard/kpis]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── Sparklines (6 meses) ────────────────────────────────────────────────────
router.get('/sparklines', async (req, res) => {
  try {
    const [faturas, receitas, despesas, pedidos, clientes] = await Promise.all([
      db.all(`
        SELECT TO_CHAR(criado_em,'YYYY-MM') AS mes, COALESCE(SUM(valor_final),0) AS v
        FROM pedidos WHERE status<>'cancelado' AND criado_em >= NOW()-INTERVAL '6 months'
        GROUP BY mes ORDER BY mes
      `),
      db.all(`
        SELECT LEFT(COALESCE(data_pagamento,''),7) AS mes, COALESCE(SUM(valor),0) AS v
        FROM lancamentos WHERE tipo='receita' AND status='pago'
          AND data_pagamento >= '${new Date(Date.now()-180*86400000).toISOString().split('T')[0]}'
        GROUP BY mes ORDER BY mes
      `),
      db.all(`
        SELECT LEFT(COALESCE(data_pagamento,''),7) AS mes, COALESCE(SUM(valor),0) AS v
        FROM lancamentos WHERE tipo='despesa' AND status='pago'
          AND data_pagamento >= '${new Date(Date.now()-180*86400000).toISOString().split('T')[0]}'
        GROUP BY mes ORDER BY mes
      `),
      db.all(`
        SELECT TO_CHAR(criado_em,'YYYY-MM') AS mes, COUNT(*) AS v
        FROM pedidos WHERE status<>'cancelado' AND criado_em >= NOW()-INTERVAL '6 months'
        GROUP BY mes ORDER BY mes
      `),
      db.all(`
        SELECT TO_CHAR(criado_em,'YYYY-MM') AS mes, COUNT(*) AS v
        FROM clientes WHERE criado_em >= NOW()-INTERVAL '6 months'
        GROUP BY mes ORDER BY mes
      `),
    ]);
    const toArr = rows => rows.map(r => +r.v || 0);
    res.json({
      faturamento: toArr(faturas),
      receitas:    toArr(receitas),
      despesas:    toArr(despesas),
      pedidos:     toArr(pedidos),
      clientes:    toArr(clientes),
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─── Financeiro — gráfico e resumo ───────────────────────────────────────────
router.get('/financeiro', async (req, res) => {
  try {
    const meses = await db.all(`
      SELECT sub.mes,
        COALESCE(SUM(CASE WHEN sub.tipo='receita' THEN sub.v ELSE 0 END),0) AS receita,
        COALESCE(SUM(CASE WHEN sub.tipo='despesa' THEN sub.v ELSE 0 END),0) AS despesa
      FROM (
        SELECT LEFT(COALESCE(data_pagamento,''),7) AS mes, tipo, SUM(valor) AS v
        FROM lancamentos WHERE status='pago' AND data_pagamento IS NOT NULL
          AND data_pagamento >= '${new Date(Date.now()-365*86400000).toISOString().split('T')[0]}'
        GROUP BY mes, tipo
      ) sub GROUP BY sub.mes ORDER BY sub.mes
    `);

    const vencHoje = await db.all(`
      SELECT tipo, descricao, valor, data_vencimento
      FROM lancamentos
      WHERE status='pendente' AND data_vencimento='${hoje()}'
      ORDER BY valor DESC LIMIT 10
    `);

    const venc7 = await db.all(`
      SELECT tipo, COUNT(*) AS qtd, COALESCE(SUM(valor),0) AS total
      FROM lancamentos
      WHERE status='pendente' AND data_vencimento BETWEEN '${hoje()}' AND '${new Date(Date.now()+7*86400000).toISOString().split('T')[0]}'
      GROUP BY tipo
    `);

    const inadim = await db.get(`
      SELECT COUNT(*) AS qtd, COALESCE(SUM(valor),0) AS total
      FROM lancamentos WHERE tipo='receita' AND status='pendente'
        AND data_vencimento < '${hoje()}'
    `);

    res.json({ meses, vencHoje, venc7, inadimplencia: inadim });
  } catch (err) {
    console.error('[dashboard/financeiro]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── Vendas — 12 meses + ticket médio + maior venda ──────────────────────────
router.get('/grafico-vendas', async (req, res) => {
  try {
    const [meses, maior, melhorVend] = await Promise.all([
      db.all(`
        SELECT TO_CHAR(criado_em,'YYYY-MM') AS mes,
               COALESCE(SUM(valor_final),0) AS total,
               COUNT(*) AS qtd,
               COALESCE(AVG(valor_final),0) AS ticket
        FROM pedidos WHERE status<>'cancelado' AND criado_em >= NOW()-INTERVAL '12 months'
        GROUP BY mes ORDER BY mes
      `),
      db.get(`
        SELECT p.numero, p.valor_final, c.nome AS cliente
        FROM pedidos p JOIN clientes c ON c.id=p.cliente_id
        WHERE p.status<>'cancelado' AND TO_CHAR(p.criado_em,'YYYY-MM')=$1
        ORDER BY p.valor_final DESC LIMIT 1
      `, [mes()]),
      db.all(`
        SELECT u.nome, COUNT(p.id) AS pedidos, COALESCE(SUM(p.valor_final),0) AS total
        FROM usuarios u
        LEFT JOIN pedidos p ON p.vendedor_id=u.id AND p.status<>'cancelado'
          AND TO_CHAR(p.criado_em,'YYYY-MM')=$1
        WHERE u.perfil IN ('vendedor','gestor') AND u.ativo=1
        GROUP BY u.id, u.nome ORDER BY total DESC LIMIT 5
      `, [mes()]),
    ]);
    res.json({ meses, maiorVenda: maior, ranking: melhorVend });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─── Produção ─────────────────────────────────────────────────────────────────
router.get('/producao', async (req, res) => {
  try {
    const [porStatus, atrasados, concluidos, osSemana] = await Promise.all([
      db.all(`
        SELECT status, COUNT(*) AS qtd, COALESCE(SUM(valor_final),0) AS valor
        FROM pedidos WHERE status NOT IN ('cancelado')
        GROUP BY status ORDER BY status
      `),
      db.all(`
        SELECT p.numero, c.nome AS cliente, p.status, p.data_prevista_entrega,
               (CURRENT_DATE - p.data_prevista_entrega::date) AS dias_atraso
        FROM pedidos p JOIN clientes c ON c.id=p.cliente_id
        WHERE p.status NOT IN ('concluido','cancelado')
          AND p.data_prevista_entrega IS NOT NULL
          AND p.data_prevista_entrega < '${hoje()}'
        ORDER BY p.data_prevista_entrega ASC LIMIT 8
      `),
      db.get(`
        SELECT COUNT(*) AS v FROM pedidos
        WHERE status='concluido' AND TO_CHAR(criado_em,'YYYY-MM')=$1
      `, [mes()]),
      db.get(`
        SELECT COUNT(*) AS v FROM ordens_servico
        WHERE status IN ('pendente','em_andamento') AND data_agendada BETWEEN '${hoje()}' AND '${new Date(Date.now()+7*86400000).toISOString().split('T')[0]}'
      `),
    ]);
    res.json({ porStatus, atrasados, concluidosMes: i(concluidos.v), osSemana: i(osSemana.v) });
  } catch (err) {
    console.error('[dashboard/producao]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── CRM ─────────────────────────────────────────────────────────────────────
router.get('/crm', async (req, res) => {
  try {
    const m = mes();
    const [funil, origem, recentes, taxaConv] = await Promise.all([
      db.all(`SELECT etapa, COUNT(*) AS qtd FROM leads GROUP BY etapa ORDER BY etapa`),
      db.all(`SELECT COALESCE(origem,'Direto') AS origem, COUNT(*) AS qtd FROM leads GROUP BY origem ORDER BY qtd DESC LIMIT 6`),
      db.all(`
        SELECT l.id, l.nome, l.etapa, l.criado_em, u.nome AS vendedor
        FROM leads l LEFT JOIN usuarios u ON u.id=l.vendedor_id
        ORDER BY l.criado_em DESC LIMIT 5
      `),
      db.get(`
        SELECT
          COUNT(*) FILTER (WHERE TO_CHAR(criado_em,'YYYY-MM')=$1) AS total_mes,
          COUNT(*) FILTER (WHERE etapa='fechado' AND TO_CHAR(criado_em,'YYYY-MM')=$1) AS fechados_mes
        FROM leads
      `, [m]),
    ]);

    const totalMes = i(taxaConv.total_mes);
    const fechados = i(taxaConv.fechados_mes);
    const conversao = totalMes > 0 ? +(fechados / totalMes * 100).toFixed(1) : 0;

    res.json({ funil, origem, recentes, conversao, totalLeadsMes: totalMes, fechadosMes: fechados });
  } catch (err) {
    console.error('[dashboard/crm]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── Clientes ─────────────────────────────────────────────────────────────────
router.get('/clientes-stats', async (req, res) => {
  try {
    const hoje7d = new Date(Date.now()+7*86400000).toISOString().split('T')[0];
    const [top, aniv] = await Promise.all([
      db.all(`
        SELECT c.id, c.nome, COUNT(p.id) AS pedidos, COALESCE(SUM(p.valor_final),0) AS total
        FROM clientes c JOIN pedidos p ON p.cliente_id=c.id AND p.status<>'cancelado'
        GROUP BY c.id, c.nome ORDER BY total DESC LIMIT 5
      `),
      db.all(`
        SELECT id, nome, data_nascimento FROM clientes
        WHERE data_nascimento IS NOT NULL AND data_nascimento<>''
          AND SUBSTRING(data_nascimento,6,5) BETWEEN TO_CHAR(NOW(),'MM-DD') AND TO_CHAR((NOW()+INTERVAL '7 days'),'MM-DD')
          AND ativo=1
        LIMIT 5
      `).catch(() => []),
    ]);
    res.json({ top, aniversariantes: aniv });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─── Estoque ─────────────────────────────────────────────────────────────────
router.get('/estoque', async (req, res) => {
  try {
    const [baixo, semEstoque, totalRow] = await Promise.all([
      db.all(`
        SELECT nome, estoque_atual, estoque_minimo, unidade
        FROM produtos WHERE ativo=1 AND estoque_minimo>0 AND estoque_atual<=estoque_minimo
        ORDER BY (estoque_atual/NULLIF(estoque_minimo,0)) ASC LIMIT 8
      `),
      db.get(`SELECT COUNT(*) AS v FROM produtos WHERE ativo=1 AND estoque_atual<=0`),
      db.get(`SELECT COALESCE(SUM(estoque_atual*valor_custo),0) AS v FROM produtos WHERE ativo=1`),
    ]);
    res.json({
      baixoEstoque: baixo,
      qtdSemEstoque: i(semEstoque.v),
      valorTotalEstoque: n(totalRow.v),
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─── Alertas inteligentes ─────────────────────────────────────────────────────
router.get('/alertas', async (req, res) => {
  try {
    const hj = hoje();
    const alertas = [];

    const [
      atras, semanaVenc, inad, estBaixo,
      pedSemMed, nfRej, saldoNeg,
    ] = await Promise.all([
      db.all(`
        SELECT p.numero, c.nome AS cliente,
          (CURRENT_DATE - p.data_prevista_entrega::date) AS dias
        FROM pedidos p JOIN clientes c ON c.id=p.cliente_id
        WHERE p.status NOT IN ('concluido','cancelado') AND p.data_prevista_entrega IS NOT NULL
          AND p.data_prevista_entrega < '${hj}'
        ORDER BY dias DESC LIMIT 5
      `),
      db.all(`
        SELECT descricao, valor, tipo, data_vencimento FROM lancamentos
        WHERE status='pendente' AND data_vencimento='${hj}'
        ORDER BY valor DESC LIMIT 5
      `),
      db.get(`
        SELECT COUNT(*) AS qtd, COALESCE(SUM(valor),0) AS total
        FROM lancamentos WHERE tipo='receita' AND status='pendente' AND data_vencimento<'${hj}'
      `),
      db.get(`SELECT COUNT(*) AS v FROM produtos WHERE ativo=1 AND estoque_minimo>0 AND estoque_atual<=estoque_minimo`),
      db.get(`SELECT COUNT(*) AS v FROM pedidos WHERE status='confirmado' AND criado_em < NOW()-INTERVAL '3 days'`),
      db.get(`SELECT COUNT(*) AS v FROM notas_fiscais WHERE status='rejeitada'`).catch(() => ({v:0})),
      db.get(`
        SELECT COALESCE(SUM(cc.saldo_inicial),0)
          + COALESCE((SELECT SUM(l.valor) FROM lancamentos l WHERE l.tipo='receita' AND l.status='pago'),0)
          - COALESCE((SELECT SUM(l.valor) FROM lancamentos l WHERE l.tipo='despesa' AND l.status='pago'),0)
        AS v FROM contas_correntes cc WHERE ativa=1
      `),
    ]);

    atras.forEach(p => alertas.push({
      tipo: 'perigo', icone: 'alert-triangle', prioridade: 1,
      titulo: `Pedido #${p.numero} atrasado`,
      msg: `${p.cliente} — ${p.dias} dia(s) em atraso`,
      link: 'pedidos.html',
    }));

    semanaVenc.forEach(l => alertas.push({
      tipo: 'warning', icone: 'clock', prioridade: 2,
      titulo: `Vence hoje: ${l.descricao}`,
      msg: `${moedaBE(l.valor)} — ${l.tipo}`,
      link: 'financeiro.html',
    }));

    if (i(inad.qtd) > 0) alertas.push({
      tipo: 'perigo', icone: 'user-x', prioridade: 1,
      titulo: `${inad.qtd} recebimento(s) em atraso`,
      msg: `Total: ${moedaBE(n(inad.total))}`,
      link: 'financeiro.html',
    });

    if (i(estBaixo.v) > 0) alertas.push({
      tipo: 'warning', icone: 'package', prioridade: 3,
      titulo: `${estBaixo.v} produto(s) com estoque baixo`,
      msg: 'Verifique e solicite reposição',
      link: 'estoque.html',
    });

    if (i(pedSemMed.v) > 0) alertas.push({
      tipo: 'info', icone: 'ruler', prioridade: 4,
      titulo: `${pedSemMed.v} pedido(s) sem medição agendada`,
      msg: 'Confirmados há mais de 3 dias',
      link: 'pedidos.html',
    });

    if (i(nfRej.v) > 0) alertas.push({
      tipo: 'perigo', icone: 'file-x', prioridade: 1,
      titulo: `${nfRej.v} nota(s) fiscal(is) rejeitada(s)`,
      msg: 'Requer ação imediata',
      link: 'notas-fiscais.html',
    });

    if (n(saldoNeg.v) < 0) alertas.push({
      tipo: 'perigo', icone: 'trending-down', prioridade: 1,
      titulo: 'Saldo disponível negativo',
      msg: `Saldo: ${moedaBE(n(saldoNeg.v))}`,
      link: 'financeiro.html',
    });

    alertas.sort((a, b) => a.prioridade - b.prioridade);
    res.json(alertas);
  } catch (err) {
    console.error('[dashboard/alertas]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── Agenda de hoje ───────────────────────────────────────────────────────────
router.get('/agenda', async (req, res) => {
  try {
    const hj = hoje();
    const [os, entregas] = await Promise.all([
      db.all(`
        SELECT os.id, os.numero, os.tipo, os.data_agendada, os.status,
               c.nome AS cliente, u.nome AS tecnico
        FROM ordens_servico os
        LEFT JOIN clientes c ON c.id=os.cliente_id
        LEFT JOIN usuarios u ON u.id=os.tecnico_id
        WHERE os.data_agendada='${hj}' AND os.status NOT IN ('concluido','cancelado')
        ORDER BY os.tipo
      `),
      db.all(`
        SELECT p.numero, p.data_prevista_entrega, p.status, c.nome AS cliente
        FROM pedidos p JOIN clientes c ON c.id=p.cliente_id
        WHERE p.data_prevista_entrega='${hj}' AND p.status NOT IN ('concluido','cancelado')
        LIMIT 5
      `),
    ]);
    res.json({ os, entregas, data: hj });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─── Radar de prazos ─────────────────────────────────────────────────────────
router.get('/radar', async (req, res) => {
  try {
    const [atrasados, aVencer] = await Promise.all([
      db.all(`
        SELECT p.id, p.numero, c.nome AS cliente, p.status, p.data_prevista_entrega,
               (CURRENT_DATE - p.data_prevista_entrega::date) AS dias_atraso
        FROM pedidos p JOIN clientes c ON c.id=p.cliente_id
        WHERE p.status NOT IN ('concluido','cancelado')
          AND p.data_prevista_entrega IS NOT NULL
          AND p.data_prevista_entrega < '${hoje()}'
        ORDER BY p.data_prevista_entrega ASC LIMIT 5
      `),
      db.all(`
        SELECT p.id, p.numero, c.nome AS cliente, p.status, p.data_prevista_entrega,
               (p.data_prevista_entrega::date - CURRENT_DATE) AS dias_restantes
        FROM pedidos p JOIN clientes c ON c.id=p.cliente_id
        WHERE p.status NOT IN ('concluido','cancelado')
          AND p.data_prevista_entrega IS NOT NULL
          AND p.data_prevista_entrega::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 days')
        ORDER BY p.data_prevista_entrega ASC LIMIT 5
      `),
    ]);
    res.json({ atrasados, aVencer });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─── Ranking vendedores + top clientes ───────────────────────────────────────
router.get('/ranking', async (req, res) => {
  try {
    const m = mes();
    const [vendedores, clientes] = await Promise.all([
      db.all(`
        SELECT u.id, u.nome, u.foto,
               COUNT(p.id) AS pedidos,
               COALESCE(SUM(p.valor_final),0) AS total
        FROM usuarios u
        LEFT JOIN pedidos p ON p.vendedor_id=u.id
          AND p.status<>'cancelado' AND TO_CHAR(p.criado_em,'YYYY-MM')=$1
        WHERE u.perfil IN ('vendedor','gestor') AND u.ativo=1
        GROUP BY u.id, u.nome, u.foto ORDER BY total DESC LIMIT 5
      `, [m]),
      db.all(`
        SELECT c.id, c.nome,
               COUNT(p.id) AS pedidos,
               COALESCE(SUM(p.valor_final),0) AS total
        FROM clientes c JOIN pedidos p ON p.cliente_id=c.id
        WHERE p.status<>'cancelado' AND TO_CHAR(p.criado_em,'YYYY-MM')=$1
        GROUP BY c.id, c.nome ORDER BY total DESC LIMIT 5
      `, [m]),
    ]);
    res.json({ vendedores, clientes });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─── Timeline de atividades ───────────────────────────────────────────────────
router.get('/atividades', async (req, res) => {
  try {
    const [clis, peds, leads, lancs, ords] = await Promise.all([
      db.all(`SELECT 'cliente' AS tipo, nome AS desc, criado_em FROM clientes ORDER BY criado_em DESC LIMIT 3`),
      db.all(`SELECT 'pedido'  AS tipo, 'Pedido #'||numero AS desc, criado_em FROM pedidos ORDER BY criado_em DESC LIMIT 4`),
      db.all(`SELECT 'lead'    AS tipo, nome AS desc, criado_em FROM leads ORDER BY criado_em DESC LIMIT 3`),
      db.all(`SELECT 'financeiro' AS tipo, descricao AS desc, criado_em FROM lancamentos ORDER BY criado_em DESC LIMIT 3`),
      db.all(`SELECT 'os'      AS tipo, 'OS #'||numero AS desc, criado_em FROM ordens_servico ORDER BY criado_em DESC LIMIT 2`),
    ]);
    const todos = [...clis, ...peds, ...leads, ...lancs, ...ords]
      .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
      .slice(0, 12);
    res.json(todos);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─── Insights IA (rule-based) ─────────────────────────────────────────────────
router.get('/ia-insights', async (req, res) => {
  try {
    const m = mes(), mA = mesAnt(), hj = hoje();
    const [fatAtual, fatAnt, recAtual, despAtual, leads3m, clientes3m] = await Promise.all([
      db.get(`SELECT COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND TO_CHAR(criado_em,'YYYY-MM')=$1`,[m]),
      db.get(`SELECT COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND TO_CHAR(criado_em,'YYYY-MM')=$1`,[mA]),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='receita' AND status='pago' AND LEFT(COALESCE(data_pagamento,''),7)=$1`,[m]),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='despesa' AND status='pago' AND LEFT(COALESCE(data_pagamento,''),7)=$1`,[m]),
      db.all(`
        SELECT TO_CHAR(criado_em,'YYYY-MM') AS mes, COUNT(*) AS v
        FROM leads WHERE criado_em >= NOW()-INTERVAL '3 months' GROUP BY mes ORDER BY mes
      `),
      db.all(`
        SELECT TO_CHAR(criado_em,'YYYY-MM') AS mes, COUNT(*) AS v
        FROM clientes WHERE criado_em >= NOW()-INTERVAL '3 months' GROUP BY mes ORDER BY mes
      `),
    ]);

    const fat = n(fatAtual.v), fatA = n(fatAnt.v);
    const rec = n(recAtual.v), desp = n(despAtual.v);
    const margem = rec > 0 ? (rec - desp) / rec * 100 : 0;
    const insights = [];

    if (fat > 0 && fatA > 0) {
      const var_fat = (fat - fatA) / fatA * 100;
      if (var_fat >= 15) insights.push({ tipo: 'sucesso', icone: 'trending-up', msg: `Faturamento cresceu ${var_fat.toFixed(0)}% vs mês anterior. Excelente ritmo!` });
      else if (var_fat <= -15) insights.push({ tipo: 'alerta', icone: 'trending-down', msg: `Faturamento caiu ${Math.abs(var_fat).toFixed(0)}% vs mês anterior. Atenção às vendas.` });
    }

    if (margem < 20 && rec > 0) insights.push({ tipo: 'alerta', icone: 'percent', msg: `Margem de lucro em ${margem.toFixed(1)}%. Abaixo do ideal (20%). Revise custos.` });
    else if (margem >= 35) insights.push({ tipo: 'sucesso', icone: 'award', msg: `Margem saudável: ${margem.toFixed(1)}%. Continue controlando os custos.` });

    if (leads3m.length >= 2) {
      const [ant, atu] = leads3m.slice(-2);
      if (n(atu?.v) < n(ant?.v) * 0.8) insights.push({ tipo: 'alerta', icone: 'users', msg: `Entrada de leads caiu. Verifique campanhas de marketing.` });
    }

    // Previsão simples: média dos últimos 3 meses × 1.05
    if (leads3m.length >= 3) {
      const media = leads3m.slice(-3).reduce((s, r) => s + n(r.v), 0) / 3;
      const previsao = fat * 1.05;
      insights.push({ tipo: 'info', icone: 'cpu', msg: `Previsão: faturamento de ${moedaBE(previsao)} no próximo mês baseado na tendência atual.` });
    }

    if (!insights.length) insights.push({ tipo: 'info', icone: 'check-circle', msg: 'Indicadores dentro do esperado. Continue monitorando!' });

    res.json(insights);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function moedaBE(v) {
  return 'R$ ' + n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = router;
