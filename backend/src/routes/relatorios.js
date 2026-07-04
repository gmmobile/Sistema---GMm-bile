const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');
const router = express.Router();
router.use(autenticar);

const n  = v => parseFloat(v)  || 0;
const i  = v => parseInt(v)    || 0;
const pct = (a, b) => b > 0 ? +((a - b) / b * 100).toFixed(1) : null;
const vd  = d => (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? d : null;

// Formatter sem Intl — Node.js no Windows não tem ICU pt-BR completo
function fmtBRL(v) {
  const neg = v < 0;
  const abs = Math.round(Math.abs(v) * 100);
  const str = String(abs).padStart(3, '0');
  const dec = str.slice(-2);
  const int = str.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + 'R$ ' + int + ',' + dec;
}
const d6ago = () => new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0];
const d12ago = () => new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];

function getPeriodo(req) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const defIni = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const defFim = new Date(y, m + 1, 0).toISOString().split('T')[0];
  const ini = vd(req.query.inicio) || defIni;
  const fim = vd(req.query.fim)    || defFim;
  const ms = new Date(ini), me = new Date(fim);
  const dias = Math.max(Math.ceil((me - ms) / 86400000), 1);
  const ps = new Date(ms); ps.setDate(ps.getDate() - dias - 1);
  const pe = new Date(ms); pe.setDate(pe.getDate() - 1);
  return { ini, fim, pIni: ps.toISOString().split('T')[0], pFim: pe.toISOString().split('T')[0] };
}

// ── Overview ─────────────────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const { ini, fim, pIni, pFim } = getPeriodo(req);
    const d6 = d6ago();

    const [fat, fatP, rec, recP, desp, despP,
           peds, cliN, cliNP, cliA, est, inad,
           fat6, rec6, desp6, ped6] = await Promise.all([
      db.get(`SELECT COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND criado_em::date BETWEEN '${ini}' AND '${fim}'`),
      db.get(`SELECT COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND criado_em::date BETWEEN '${pIni}' AND '${pFim}'`),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='receita' AND status='pago' AND data_pagamento BETWEEN '${ini}' AND '${fim}'`),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='receita' AND status='pago' AND data_pagamento BETWEEN '${pIni}' AND '${pFim}'`),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='despesa' AND status='pago' AND data_pagamento BETWEEN '${ini}' AND '${fim}'`),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='despesa' AND status='pago' AND data_pagamento BETWEEN '${pIni}' AND '${pFim}'`),
      db.get(`SELECT COUNT(*) AS total, SUM(CASE WHEN status NOT IN ('concluido','cancelado') THEN 1 ELSE 0 END) AS aberto, SUM(CASE WHEN status NOT IN ('concluido','cancelado') AND data_prevista_entrega IS NOT NULL AND data_prevista_entrega < CURRENT_DATE::text THEN 1 ELSE 0 END) AS atras FROM pedidos WHERE criado_em::date BETWEEN '${ini}' AND '${fim}'`),
      db.get(`SELECT COUNT(*) AS v FROM clientes WHERE criado_em::date BETWEEN '${ini}' AND '${fim}'`),
      db.get(`SELECT COUNT(*) AS v FROM clientes WHERE criado_em::date BETWEEN '${pIni}' AND '${pFim}'`),
      db.get(`SELECT COUNT(*) AS v FROM clientes WHERE ativo=1`),
      db.get(`SELECT COALESCE(SUM(estoque_atual*valor_custo),0) AS v, COUNT(*) FILTER(WHERE estoque_minimo>0 AND estoque_atual<=estoque_minimo) AS baixo FROM produtos WHERE ativo=1`),
      db.get(`SELECT COUNT(*) AS qtd, COALESCE(SUM(valor),0) AS total FROM lancamentos WHERE tipo='receita' AND status='pendente' AND data_vencimento < CURRENT_DATE::text`),
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS m, COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND criado_em >= '${d6}' GROUP BY m ORDER BY m`),
      db.all(`SELECT LEFT(data_pagamento,7) AS m, COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='receita' AND status='pago' AND data_pagamento>='${d6}' GROUP BY m ORDER BY m`),
      db.all(`SELECT LEFT(data_pagamento,7) AS m, COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='despesa' AND status='pago' AND data_pagamento>='${d6}' GROUP BY m ORDER BY m`),
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS m, COUNT(*) AS v FROM pedidos WHERE status<>'cancelado' AND criado_em >= '${d6}' GROUP BY m ORDER BY m`),
    ]);

    const fv = n(fat.v), fpv = n(fatP.v), rv = n(rec.v), rpv = n(recP.v), dv = n(desp.v), dpv = n(despP.v);
    res.json({
      periodo: { ini, fim },
      faturamento:   { val: fv, variacao: pct(fv, fpv), spark: fat6.map(r => n(r.v)) },
      receita:       { val: rv, variacao: pct(rv, rpv), spark: rec6.map(r => n(r.v)) },
      despesa:       { val: dv, variacao: pct(dv, dpv), spark: desp6.map(r => n(r.v)) },
      lucro:         { val: rv - dv, variacao: pct(rv - dv, rpv - dpv), margem: rv > 0 ? +((rv - dv) / rv * 100).toFixed(1) : 0 },
      pedidos:       { total: i(peds.total), aberto: i(peds.aberto), atrasados: i(peds.atras), spark: ped6.map(r => n(r.v)) },
      clientes:      { ativos: i(cliA.v), novos: i(cliN.v), variacao: pct(i(cliN.v), i(cliNP.v)) },
      estoque:       { valorTotal: n(est.v), baixo: i(est.baixo) },
      inadimplencia: { qtd: i(inad.qtd), total: n(inad.total) },
    });
  } catch (err) {
    console.error('[bi/overview]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── Comercial ─────────────────────────────────────────────────────────
router.get('/comercial', async (req, res) => {
  try {
    const { ini, fim } = getPeriodo(req);

    const [fat12m, orc12m, vendedores, ticket12m, origens, leads, totOrc, totPed] = await Promise.all([
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS mes, COALESCE(SUM(valor_final),0) AS faturamento, COUNT(*) AS pedidos FROM pedidos WHERE status<>'cancelado' AND criado_em >= NOW()-INTERVAL '12 months' GROUP BY mes ORDER BY mes`),
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS mes, COUNT(*) AS total, COUNT(*) FILTER(WHERE status='aprovado') AS aprovados FROM orcamentos WHERE criado_em >= NOW()-INTERVAL '12 months' GROUP BY mes ORDER BY mes`),
      db.all(`
        SELECT u.nome, COUNT(p.id) AS pedidos, COALESCE(SUM(p.valor_final),0) AS total, COALESCE(AVG(p.valor_final),0) AS ticket
        FROM usuarios u
        LEFT JOIN pedidos p ON p.vendedor_id=u.id AND p.status<>'cancelado' AND p.criado_em::date BETWEEN '${ini}' AND '${fim}'
        WHERE u.perfil='vendedor' AND u.ativo=1
        GROUP BY u.id, u.nome ORDER BY total DESC LIMIT 10
      `),
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS mes, COALESCE(AVG(valor_final),0) AS ticket FROM pedidos WHERE status<>'cancelado' AND criado_em >= NOW()-INTERVAL '12 months' GROUP BY mes ORDER BY mes`),
      db.all(`SELECT COALESCE(origem,'Direto') AS origem, COUNT(*) AS qtd FROM clientes WHERE criado_em::date BETWEEN '${ini}' AND '${fim}' GROUP BY origem ORDER BY qtd DESC LIMIT 8`),
      db.all(`SELECT etapa, COUNT(*) AS qtd, COALESCE(SUM(valor_estimado),0) AS valor FROM leads WHERE criado_em::date BETWEEN '${ini}' AND '${fim}' GROUP BY etapa`),
      db.get(`SELECT COUNT(*) AS v FROM orcamentos WHERE criado_em::date BETWEEN '${ini}' AND '${fim}'`),
      db.get(`SELECT COUNT(*) AS v FROM pedidos WHERE status<>'cancelado' AND criado_em::date BETWEEN '${ini}' AND '${fim}'`),
    ]);

    const totFat = fat12m.reduce((s, r) => s + n(r.faturamento), 0);
    const totPeds = fat12m.reduce((s, r) => s + i(r.pedidos), 0);
    const conversao = i(totOrc.v) > 0 ? +((i(totPed.v) / i(totOrc.v)) * 100).toFixed(1) : 0;
    const ticketMedio = totPeds > 0 ? +(totFat / totPeds).toFixed(2) : 0;

    res.json({ fat12m, orc12m, vendedores, ticket12m, origens, leads, conversao, ticketMedio, totOrcamentos: i(totOrc.v), totPedidos: i(totPed.v) });
  } catch (err) {
    console.error('[bi/comercial]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── Financeiro ────────────────────────────────────────────────────────
router.get('/financeiro', async (req, res) => {
  try {
    const { ini, fim } = getPeriodo(req);
    const d12 = d12ago();

    const [rec12m, desp12m, catDesp, catRec, inadim, venc30, fluxo6m, saldoRow] = await Promise.all([
      db.all(`SELECT LEFT(data_pagamento,7) AS mes, COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='receita' AND status='pago' AND data_pagamento>='${d12}' GROUP BY mes ORDER BY mes`),
      db.all(`SELECT LEFT(data_pagamento,7) AS mes, COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='despesa' AND status='pago' AND data_pagamento>='${d12}' GROUP BY mes ORDER BY mes`),
      db.all(`SELECT COALESCE(cat.nome,'Sem Categoria') AS categoria, COALESCE(cat.cor,'#6366f1') AS cor, COALESCE(SUM(l.valor),0) AS total FROM lancamentos l LEFT JOIN categorias cat ON cat.id=l.categoria_id WHERE l.tipo='despesa' AND l.status='pago' AND l.data_pagamento BETWEEN '${ini}' AND '${fim}' GROUP BY cat.nome,cat.cor ORDER BY total DESC LIMIT 10`),
      db.all(`SELECT COALESCE(cat.nome,'Sem Categoria') AS categoria, COALESCE(cat.cor,'#22c55e') AS cor, COALESCE(SUM(l.valor),0) AS total FROM lancamentos l LEFT JOIN categorias cat ON cat.id=l.categoria_id WHERE l.tipo='receita' AND l.status='pago' AND l.data_pagamento BETWEEN '${ini}' AND '${fim}' GROUP BY cat.nome,cat.cor ORDER BY total DESC LIMIT 10`),
      db.all(`SELECT LEFT(data_vencimento,7) AS mes, COUNT(*) AS qtd, COALESCE(SUM(valor),0) AS total FROM lancamentos WHERE tipo='receita' AND status='pendente' AND data_vencimento < CURRENT_DATE::text GROUP BY mes ORDER BY mes DESC LIMIT 6`),
      db.all(`SELECT data_vencimento, tipo, descricao, valor FROM lancamentos WHERE status='pendente' AND data_vencimento BETWEEN CURRENT_DATE::text AND (CURRENT_DATE+INTERVAL '30 days')::text ORDER BY data_vencimento ASC LIMIT 20`),
      db.all(`
        SELECT sub.mes, COALESCE(SUM(CASE WHEN sub.tipo='receita' THEN sub.v ELSE 0 END),0) AS receita, COALESCE(SUM(CASE WHEN sub.tipo='despesa' THEN sub.v ELSE 0 END),0) AS despesa
        FROM (SELECT LEFT(data_pagamento,7) AS mes, tipo, SUM(valor) AS v FROM lancamentos WHERE status='pago' AND data_pagamento IS NOT NULL AND data_pagamento>='${d6ago()}' GROUP BY mes,tipo) sub
        GROUP BY sub.mes ORDER BY sub.mes
      `),
      db.get(`SELECT COALESCE(SUM(cc.saldo_inicial),0) + COALESCE((SELECT SUM(l.valor) FROM lancamentos l WHERE l.tipo='receita' AND l.status='pago'),0) - COALESCE((SELECT SUM(l.valor) FROM lancamentos l WHERE l.tipo='despesa' AND l.status='pago'),0) AS v FROM contas_correntes cc WHERE ativa=1`),
    ]);

    res.json({ rec12m, desp12m, catDesp, catRec, inadim, venc30, fluxo6m, saldo: n(saldoRow.v) });
  } catch (err) {
    console.error('[bi/financeiro]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── DRE ──────────────────────────────────────────────────────────────
router.get('/dre', async (req, res) => {
  try {
    const { ini, fim } = getPeriodo(req);

    const [recBruta, recPago, catsDespesas, impostosNF, comissoesVal, recMeses] = await Promise.all([
      db.get(`SELECT COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE status NOT IN ('cancelado') AND criado_em::date BETWEEN '${ini}' AND '${fim}'`),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='receita' AND status='pago' AND data_pagamento BETWEEN '${ini}' AND '${fim}'`),
      db.all(`
        SELECT COALESCE(cat.nome,'Sem Categoria') AS categoria, COALESCE(SUM(l.valor),0) AS total
        FROM lancamentos l LEFT JOIN categorias cat ON cat.id=l.categoria_id
        WHERE l.tipo='despesa' AND l.status='pago' AND l.data_pagamento BETWEEN '${ini}' AND '${fim}'
        GROUP BY cat.nome ORDER BY total DESC
      `),
      db.get(`SELECT COALESCE(SUM(valor_icms+valor_ipi+valor_pis+valor_cofins+valor_iss),0) AS v FROM notas_fiscais WHERE status='autorizada' AND data_emissao BETWEEN '${ini}' AND '${fim}'`).catch(() => ({ v: 0 })),
      db.get(`SELECT COALESCE(SUM(valor_comissao),0) AS v FROM comissoes WHERE status IN ('pendente','pago') AND data_geracao::date BETWEEN '${ini}' AND '${fim}'`),
      db.all(`SELECT LEFT(data_pagamento,7) AS mes, COALESCE(SUM(valor),0) AS receita FROM lancamentos WHERE tipo='receita' AND status='pago' AND data_pagamento BETWEEN '${ini}' AND '${fim}' GROUP BY mes ORDER BY mes`),
    ]);

    const receita_bruta   = n(recBruta.v);
    const receita_paga    = n(recPago.v);
    const impostos        = n(impostosNF?.v);
    const receita_liquida = receita_bruta - impostos;
    const total_despesas  = catsDespesas.reduce((s, c) => s + n(c.total), 0);
    const comissoes       = n(comissoesVal.v);
    const lucro_bruto     = receita_paga - (total_despesas * 0.4);
    const lucro_op        = receita_paga - total_despesas;
    const margem          = receita_paga > 0 ? +((lucro_op / receita_paga) * 100).toFixed(1) : 0;

    res.json({ receita_bruta, receita_paga, impostos, receita_liquida, despesas_por_categoria: catsDespesas, total_despesas, comissoes, lucro_bruto, lucro_operacional: lucro_op, margem, recMeses });
  } catch (err) {
    console.error('[bi/dre]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── Produção ──────────────────────────────────────────────────────────
router.get('/producao', async (req, res) => {
  try {
    const { ini, fim } = getPeriodo(req);

    const [porStatus, atrasados, concluidosMes, osPorTipo, tecnicoRank, prod12m] = await Promise.all([
      db.all(`SELECT status, COUNT(*) AS qtd, COALESCE(SUM(valor_final),0) AS valor FROM pedidos WHERE status<>'cancelado' AND criado_em::date BETWEEN '${ini}' AND '${fim}' GROUP BY status ORDER BY status`),
      db.all(`
        SELECT p.numero, c.nome AS cliente, p.status, p.data_prevista_entrega,
          (CURRENT_DATE - p.data_prevista_entrega::date) AS dias_atraso, p.valor_final
        FROM pedidos p JOIN clientes c ON c.id=p.cliente_id
        WHERE p.status NOT IN ('concluido','cancelado') AND p.data_prevista_entrega IS NOT NULL AND p.data_prevista_entrega < CURRENT_DATE::text
        ORDER BY p.data_prevista_entrega ASC LIMIT 15
      `),
      db.get(`SELECT COUNT(*) AS v FROM pedidos WHERE status='concluido' AND criado_em::date BETWEEN '${ini}' AND '${fim}'`),
      db.all(`SELECT tipo, COUNT(*) AS qtd, COUNT(*) FILTER(WHERE status='concluido') AS concluidos FROM ordens_servico WHERE criado_em::date BETWEEN '${ini}' AND '${fim}' GROUP BY tipo`),
      db.all(`SELECT u.nome AS tecnico, COUNT(os.id) AS total, COUNT(os.id) FILTER(WHERE os.status='concluido') AS concluidos FROM usuarios u LEFT JOIN ordens_servico os ON os.tecnico_id=u.id AND os.criado_em::date BETWEEN '${ini}' AND '${fim}' WHERE u.perfil='tecnico' AND u.ativo=1 GROUP BY u.id,u.nome ORDER BY total DESC LIMIT 8`),
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS mes, COUNT(*) AS total, COUNT(*) FILTER(WHERE status='concluido') AS concluidos FROM pedidos WHERE criado_em >= NOW()-INTERVAL '12 months' AND status<>'cancelado' GROUP BY mes ORDER BY mes`),
    ]);

    res.json({ porStatus, atrasados, concluidosMes: i(concluidosMes.v), osPorTipo, tecnicoRank, prod12m });
  } catch (err) {
    console.error('[bi/producao]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── Estoque ───────────────────────────────────────────────────────────
router.get('/estoque', async (req, res) => {
  try {
    const { ini, fim } = getPeriodo(req);

    const [posicao, baixo, semEst, movimentos, topConsumo, entradas, saidas] = await Promise.all([
      db.get(`SELECT COUNT(*) AS total, COALESCE(SUM(estoque_atual*valor_custo),0) AS valor FROM produtos WHERE ativo=1`),
      db.all(`SELECT nome, estoque_atual, estoque_minimo, unidade, valor_custo FROM produtos WHERE ativo=1 AND estoque_minimo>0 AND estoque_atual<=estoque_minimo ORDER BY (estoque_atual/NULLIF(estoque_minimo,0)) ASC LIMIT 10`),
      db.get(`SELECT COUNT(*) AS v FROM produtos WHERE ativo=1 AND estoque_atual<=0`),
      db.all(`SELECT TO_CHAR(m.criado_em,'YYYY-MM') AS mes, COALESCE(SUM(CASE WHEN m.tipo='entrada' THEN m.quantidade ELSE 0 END),0) AS entradas, COALESCE(SUM(CASE WHEN m.tipo='saida' THEN m.quantidade ELSE 0 END),0) AS saidas FROM movimentos_estoque m WHERE m.criado_em >= NOW()-INTERVAL '6 months' GROUP BY mes ORDER BY mes`),
      db.all(`SELECT p.nome, COALESCE(SUM(m.quantidade),0) AS consumo FROM movimentos_estoque m JOIN produtos p ON p.id=m.produto_id WHERE m.tipo='saida' AND m.criado_em::date BETWEEN '${ini}' AND '${fim}' GROUP BY p.id,p.nome ORDER BY consumo DESC LIMIT 10`),
      db.get(`SELECT COUNT(*) AS qtd, COALESCE(SUM(m.quantidade*COALESCE(m.valor_unitario,0)),0) AS valor FROM movimentos_estoque m WHERE m.tipo='entrada' AND m.criado_em::date BETWEEN '${ini}' AND '${fim}'`),
      db.get(`SELECT COUNT(*) AS qtd, COALESCE(SUM(m.quantidade),0) AS qtd_total FROM movimentos_estoque m WHERE m.tipo='saida' AND m.criado_em::date BETWEEN '${ini}' AND '${fim}'`),
    ]);

    res.json({ posicao, baixo, semEstoque: i(semEst.v), movimentos, topConsumo, entradas, saidas });
  } catch (err) {
    console.error('[bi/estoque]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── Clientes ──────────────────────────────────────────────────────────
router.get('/clientes', async (req, res) => {
  try {
    const { ini, fim } = getPeriodo(req);

    const [ranking, cidades, origens, novosMes, recorrentes] = await Promise.all([
      db.all(`
        SELECT c.id, c.nome, c.cidade, c.estado, COALESCE(c.origem,'Direto') AS origem,
          COUNT(p.id) AS pedidos, COALESCE(SUM(p.valor_final),0) AS total, MAX(p.criado_em) AS ultima_compra
        FROM clientes c LEFT JOIN pedidos p ON p.cliente_id=c.id AND p.status<>'cancelado'
        WHERE c.ativo=1 GROUP BY c.id,c.nome,c.cidade,c.estado,c.origem ORDER BY total DESC LIMIT 20
      `),
      db.all(`SELECT COALESCE(c.cidade,'Não informada') AS cidade, COUNT(DISTINCT c.id) AS clientes, COALESCE(SUM(p.valor_final),0) AS faturamento FROM clientes c LEFT JOIN pedidos p ON p.cliente_id=c.id AND p.status<>'cancelado' AND p.criado_em::date BETWEEN '${ini}' AND '${fim}' WHERE c.ativo=1 GROUP BY c.cidade ORDER BY faturamento DESC LIMIT 10`),
      db.all(`SELECT COALESCE(origem,'Direto') AS origem, COUNT(*) AS qtd FROM clientes WHERE ativo=1 GROUP BY origem ORDER BY qtd DESC LIMIT 8`),
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS mes, COUNT(*) AS novos FROM clientes WHERE criado_em >= NOW()-INTERVAL '12 months' GROUP BY mes ORDER BY mes`),
      db.get(`SELECT COUNT(DISTINCT p.cliente_id) AS v FROM pedidos p WHERE p.status<>'cancelado' AND p.criado_em::date BETWEEN '${ini}' AND '${fim}' AND (SELECT COUNT(*) FROM pedidos p2 WHERE p2.cliente_id=p.cliente_id AND p2.status<>'cancelado' AND p2.criado_em < '${ini}') > 0`),
    ]);

    res.json({ ranking, cidades, origens, novosMes, recorrentes: i(recorrentes.v) });
  } catch (err) {
    console.error('[bi/clientes]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── Fiscal ────────────────────────────────────────────────────────────
router.get('/fiscal', async (req, res) => {
  try {
    const { ini, fim } = getPeriodo(req);
    const [porStatus, impostosMes, cfop] = await Promise.all([
      db.all(`SELECT status, COUNT(*) AS qtd, COALESCE(SUM(valor_total),0) AS total FROM notas_fiscais WHERE data_emissao BETWEEN '${ini}' AND '${fim}' GROUP BY status`).catch(() => []),
      db.all(`SELECT LEFT(data_emissao,7) AS mes, COALESCE(SUM(valor_icms),0) AS icms, COALESCE(SUM(valor_pis),0) AS pis, COALESCE(SUM(valor_cofins),0) AS cofins, COALESCE(SUM(valor_iss),0) AS iss, COALESCE(SUM(valor_total),0) AS total FROM notas_fiscais WHERE status='autorizada' AND data_emissao BETWEEN '${ini}' AND '${fim}' GROUP BY LEFT(data_emissao,7) ORDER BY mes`).catch(() => []),
      db.all(`SELECT cfop, COUNT(*) AS qtd, COALESCE(SUM(valor_total),0) AS total FROM notas_fiscais WHERE status='autorizada' AND data_emissao BETWEEN '${ini}' AND '${fim}' GROUP BY cfop ORDER BY total DESC LIMIT 10`).catch(() => []),
    ]);
    res.json({ porStatus, impostosMes, cfop });
  } catch (err) {
    console.error('[bi/fiscal]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── IA Insights ───────────────────────────────────────────────────────
router.get('/ia', async (req, res) => {
  try {
    const { ini, fim, pIni, pFim } = getPeriodo(req);

    const [fat, fatP, rec, desp, leads3, inad, estBaixo, tick, tickP, conv] = await Promise.all([
      db.get(`SELECT COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND criado_em::date BETWEEN '${ini}' AND '${fim}'`),
      db.get(`SELECT COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND criado_em::date BETWEEN '${pIni}' AND '${pFim}'`),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='receita' AND status='pago' AND data_pagamento BETWEEN '${ini}' AND '${fim}'`),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE tipo='despesa' AND status='pago' AND data_pagamento BETWEEN '${ini}' AND '${fim}'`),
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS mes, COUNT(*) AS v FROM leads WHERE criado_em >= NOW()-INTERVAL '3 months' GROUP BY mes ORDER BY mes`),
      db.get(`SELECT COUNT(*) AS qtd, COALESCE(SUM(valor),0) AS total FROM lancamentos WHERE tipo='receita' AND status='pendente' AND data_vencimento < CURRENT_DATE::text`),
      db.get(`SELECT COUNT(*) AS v FROM produtos WHERE ativo=1 AND estoque_minimo>0 AND estoque_atual<=estoque_minimo`),
      db.get(`SELECT COALESCE(AVG(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND criado_em::date BETWEEN '${ini}' AND '${fim}'`),
      db.get(`SELECT COALESCE(AVG(valor_final),0) AS v FROM pedidos WHERE status<>'cancelado' AND criado_em::date BETWEEN '${pIni}' AND '${pFim}'`),
      db.get(`SELECT COUNT(*) AS orc, COUNT(*) FILTER(WHERE status='aprovado') AS aprov FROM orcamentos WHERE criado_em::date BETWEEN '${ini}' AND '${fim}'`),
    ]);

    const insights = [];
    const fv = n(fat.v), fpv = n(fatP.v), rv = n(rec.v), dv = n(desp.v);
    const margem = rv > 0 ? (rv - dv) / rv * 100 : 0;

    if (fv > 0 && fpv > 0) {
      const vf = (fv - fpv) / fpv * 100;
      if (vf >= 20)       insights.push({ tipo:'sucesso', icone:'trending-up',    titulo:'Crescimento Acelerado', msg:`Faturamento cresceu ${vf.toFixed(0)}% vs período anterior. Ritmo excelente — mantenha o momentum!` });
      else if (vf <= -15) insights.push({ tipo:'perigo',  icone:'trending-down',  titulo:'Queda no Faturamento', msg:`Faturamento caiu ${Math.abs(vf).toFixed(0)}% vs período anterior. Reveja estratégia comercial urgentemente.` });
      else if (vf > 0)    insights.push({ tipo:'info',    icone:'bar-chart-2',    titulo:'Crescimento Estável',  msg:`Faturamento cresceu ${vf.toFixed(0)}% no período. Tendência positiva e consistente.` });
    }

    if (margem < 15 && rv > 0) insights.push({ tipo:'alerta', icone:'percent', titulo:'Margem Comprimida', msg:`Margem de ${margem.toFixed(1)}% está abaixo do ideal (>25%). Revise custos e precificação.` });
    else if (margem >= 35)     insights.push({ tipo:'sucesso', icone:'award',   titulo:'Margem Saudável',    msg:`Margem em ${margem.toFixed(1)}%. Ótimo controle de custos — continue assim.` });

    if (leads3.length >= 2) {
      const [ant, atu] = leads3.slice(-2);
      const vl = n(ant?.v) > 0 ? (n(atu?.v) - n(ant?.v)) / n(ant?.v) * 100 : 0;
      if (vl <= -25) insights.push({ tipo:'alerta', icone:'users',    titulo:'Captação em Queda',    msg:'Entrada de leads caiu 25%+. Reveja campanhas de marketing e prospecção ativa.' });
      else if (vl >= 30) insights.push({ tipo:'sucesso', icone:'user-plus', titulo:'Captação Acelerada', msg:'Leads crescendo acima de 30%. Certifique-se de ter equipe para atendimento ágil.' });
    }

    if (i(inad.qtd) > 3 || n(inad.total) > 5000) {
      insights.push({ tipo:'perigo', icone:'alert-triangle', titulo:'Inadimplência Elevada', msg:`${inad.qtd} recebimentos em atraso totalizando ${fmtBRL(n(inad.total))}. Acione a régua de cobrança.` });
    }

    if (i(estBaixo.v) >= 3) insights.push({ tipo:'warning', icone:'package', titulo:'Estoque Crítico', msg:`${estBaixo.v} produto(s) abaixo do mínimo. Faça reposição antes de comprometer a produção.` });

    const convPct = i(conv.orc) > 0 ? i(conv.aprov) / i(conv.orc) * 100 : 0;
    if (i(conv.orc) > 0 && convPct < 25) insights.push({ tipo:'alerta', icone:'percent', titulo:'Conversão Baixa', msg:`Taxa de aprovação de orçamentos em ${convPct.toFixed(0)}%. Reveja proposta de valor e follow-up pós-envio.` });

    const tickV = n(tick.v), tickPV = n(tickP.v);
    if (tickV > 0 && tickPV > 0 && (tickV - tickPV) / tickPV * 100 >= 15) {
      insights.push({ tipo:'sucesso', icone:'arrow-up', titulo:'Ticket Médio Subindo', msg:`Ticket médio aumentou ${((tickV-tickPV)/tickPV*100).toFixed(0)}%. Clientes estão comprando projetos maiores.` });
    }

    if (fv > 0) {
      const previsao = fv * (fv > fpv ? 1.08 : 0.97);
      insights.push({ tipo:'info', icone:'cpu', titulo:'Previsão IA', msg:`Baseado na tendência atual, estimativa para o próximo período: ~${fmtBRL(previsao)}.` });
    }

    if (!insights.length) insights.push({ tipo:'sucesso', icone:'check-circle', titulo:'Indicadores Estáveis', msg:'Todos os indicadores estão dentro do esperado. Continue monitorando!' });

    res.json(insights);
  } catch (err) {
    console.error('[bi/ia]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
