/* ════════════════════════════════════════════════════════════════
   CENTRAL DE TESOURARIA — GM MÓBILE
   Todos os saldos são calculados automaticamente a partir dos
   lançamentos do ERP (Fase 1 — sem API bancária). Estrutura
   preparada para futura integração Open Finance / Banco Inter.
   ════════════════════════════════════════════════════════════════ */
const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');
const router = express.Router();
router.use(autenticar);

const n = v => parseFloat(v) || 0;
const i = v => parseInt(v)   || 0;
const pct = (a, b) => b > 0 ? +((a - b) / b * 100).toFixed(1) : null;
const hojeStr = () => new Date().toISOString().split('T')[0];
const addDias = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().split('T')[0]; };

/* ── Executa transferências agendadas vencidas (lazy, sem cron) ── */
async function executarAgendadasVencidas() {
  const vencidas = await db.all(`SELECT * FROM fin_transferencias WHERE status='agendada' AND data <= $1`, [hojeStr()]);
  for (const t of vencidas) {
    const d = String(t.data).split('T')[0];
    const desc = t.descricao ? ` — ${t.descricao}` : '';
    await db.run(`INSERT INTO lancamentos (tipo, descricao, valor, data_vencimento, data_pagamento, status, conta_id, origem)
                  VALUES ('despesa',$1,$2,$3,$3,'pago',$4,'transferencia')`,
                 [`Transferência enviada${desc}`, t.valor, d, t.conta_origem_id]);
    await db.run(`INSERT INTO lancamentos (tipo, descricao, valor, data_vencimento, data_pagamento, status, conta_id, origem)
                  VALUES ('receita',$1,$2,$3,$3,'pago',$4,'transferencia')`,
                 [`Transferência recebida${desc}`, t.valor, d, t.conta_destino_id]);
    await db.run(`UPDATE fin_transferencias SET status='concluida' WHERE id=$1`, [t.id]);
  }
  return vencidas.length;
}

/* ── Contas com saldo calculado (helper) ── */
async function getContasComSaldo() {
  const [contas, agg, resv] = await Promise.all([
    db.all(`SELECT * FROM contas_correntes WHERE ativa=1 ORDER BY nome`),
    db.all(`SELECT conta_id,
      COALESCE(SUM(CASE WHEN tipo='receita' AND status='pago' THEN valor END),0) AS rec,
      COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pago' THEN valor END),0) AS desp
      FROM lancamentos WHERE conta_id IS NOT NULL AND status<>'cancelado' GROUP BY conta_id`),
    db.all(`SELECT conta_id, COALESCE(SUM(valor),0) AS v FROM fin_reservas WHERE status='ativa' GROUP BY conta_id`),
  ]);
  const am = Object.fromEntries(agg.map(r => [r.conta_id, r]));
  const rm = Object.fromEntries(resv.map(r => [r.conta_id, n(r.v)]));
  return contas.map(c => {
    const a = am[c.id] || {};
    const saldo = n(c.saldo_inicial) + n(a.rec) - n(a.desp);
    const reservado = rm[c.id] || 0;
    return { ...c, saldo_atual: +saldo.toFixed(2), saldo_reservado: +reservado.toFixed(2), saldo_disponivel: +(saldo - reservado).toFixed(2) };
  });
}

/* ════════════════════════════════════════════════════════════════
   GET /painel — visão completa da tesouraria em uma chamada
   ════════════════════════════════════════════════════════════════ */
router.get('/painel', async (req, res) => {
  try {
    await executarAgendadasVencidas().catch(e => console.error('[tesouraria/agendadas]', e.message));

    const hoje = hojeStr(), ontem = addDias(-1), d7 = addDias(7), d15 = addDias(15), d30 = addDias(30);
    const d14a = addDias(-13), d30a = addDias(-30), m0 = hoje.slice(0, 8) + '01';

    const [contasBase, agg, ult, pixPend, transfAgg, transfLista, sparkRows] = await Promise.all([
      getContasComSaldo(),
      db.all(`SELECT conta_id,
        COALESCE(SUM(CASE WHEN tipo='receita' AND status='pago' AND data_pagamento=$1 THEN valor END),0) AS ent_hoje,
        COUNT(*) FILTER (WHERE tipo='receita' AND status='pago' AND data_pagamento=$1)                   AS ent_hoje_qtd,
        COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pago' AND data_pagamento=$1 THEN valor END),0) AS sai_hoje,
        COUNT(*) FILTER (WHERE tipo='despesa' AND status='pago' AND data_pagamento=$1)                   AS sai_hoje_qtd,
        COALESCE(SUM(CASE WHEN tipo='receita' AND status='pago' AND data_pagamento=$2 THEN valor END),0) AS ent_ontem,
        COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pago' AND data_pagamento=$2 THEN valor END),0) AS sai_ontem,
        COALESCE(SUM(CASE WHEN tipo='receita' AND status IN('pendente','atrasado') AND data_vencimento<=$3 THEN valor END),0) AS prev_rec7,
        COALESCE(SUM(CASE WHEN tipo='despesa' AND status IN('pendente','atrasado') AND data_vencimento<=$3 THEN valor END),0) AS prev_desp7,
        COALESCE(SUM(CASE WHEN tipo='receita' AND status IN('pendente','atrasado') AND data_vencimento<=$4 THEN valor END),0) AS prev_rec15,
        COALESCE(SUM(CASE WHEN tipo='despesa' AND status IN('pendente','atrasado') AND data_vencimento<=$4 THEN valor END),0) AS prev_desp15,
        COALESCE(SUM(CASE WHEN tipo='receita' AND status IN('pendente','atrasado') AND data_vencimento<=$5 THEN valor END),0) AS prev_rec30,
        COALESCE(SUM(CASE WHEN tipo='despesa' AND status IN('pendente','atrasado') AND data_vencimento<=$5 THEN valor END),0) AS prev_desp30,
        COUNT(*) FILTER (WHERE status='pago' AND COALESCE(conciliado,false)=false AND data_pagamento>=$6) AS pend_conc,
        MAX(CASE WHEN status='pago' THEN data_pagamento END) AS ult_data
        FROM lancamentos WHERE conta_id IS NOT NULL AND status<>'cancelado' GROUP BY conta_id`,
        [hoje, ontem, d7, d15, d30, d30a]),
      db.all(`SELECT DISTINCT ON (conta_id) conta_id, descricao, tipo, valor, forma_pagamento,
              TO_CHAR(criado_em,'HH24:MI') AS hora, COALESCE(data_pagamento, data_vencimento) AS d
              FROM lancamentos WHERE status='pago' AND conta_id IS NOT NULL ORDER BY conta_id, criado_em DESC`),
      db.get(`SELECT COUNT(*) AS q, COALESCE(SUM(valor),0) AS v FROM lancamentos
              WHERE status IN('pendente','atrasado') AND LOWER(COALESCE(forma_pagamento,''))='pix'`),
      db.get(`SELECT COUNT(*) AS q, COALESCE(SUM(valor),0) AS v FROM fin_transferencias WHERE status='agendada'`),
      db.all(`SELECT t.*, co.nome AS origem_nome, cd.nome AS destino_nome
              FROM fin_transferencias t
              LEFT JOIN contas_correntes co ON co.id=t.conta_origem_id
              LEFT JOIN contas_correntes cd ON cd.id=t.conta_destino_id
              WHERE t.status='agendada' ORDER BY t.data ASC LIMIT 6`),
      db.all(`SELECT data_pagamento AS d,
        COALESCE(SUM(CASE WHEN tipo='receita' THEN valor END),0) AS ent,
        COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor END),0) AS sai
        FROM lancamentos WHERE status='pago' AND data_pagamento>=$1 AND conta_id IS NOT NULL AND status<>'cancelado'
        GROUP BY 1 ORDER BY 1`, [d14a]),
    ]);

    const am = Object.fromEntries(agg.map(r => [r.conta_id, r]));
    const um = Object.fromEntries(ult.map(r => [r.conta_id, r]));

    const contas = contasBase.map(c => {
      const a = am[c.id] || {};
      const u = um[c.id] || null;
      const semMov = !a.ult_data || a.ult_data < d30a;
      let status = 'conciliada';
      if (c.saldo_atual < 0) status = 'negativa';
      else if (i(a.pend_conc) > 0) status = 'pendente';
      else if (semMov) status = 'sem_mov';
      let notif = 0;
      if (n(c.saldo_minimo) > 0 && c.saldo_atual < n(c.saldo_minimo)) notif++;
      if (c.saldo_atual < 0) notif++;
      if (i(a.pend_conc) > 0) notif++;
      if (semMov) notif++;
      return {
        ...c,
        entradas_hoje: n(a.ent_hoje), entradas_hoje_qtd: i(a.ent_hoje_qtd),
        saidas_hoje: n(a.sai_hoje), saidas_hoje_qtd: i(a.sai_hoje_qtd),
        saldo_previsto7:  +(c.saldo_atual + n(a.prev_rec7)  - n(a.prev_desp7)).toFixed(2),
        saldo_previsto15: +(c.saldo_atual + n(a.prev_rec15) - n(a.prev_desp15)).toFixed(2),
        saldo_previsto30: +(c.saldo_atual + n(a.prev_rec30) - n(a.prev_desp30)).toFixed(2),
        pend_conciliacao: i(a.pend_conc),
        ultima_mov: u ? { descricao: u.descricao, tipo: u.tipo, valor: n(u.valor), hora: u.hora, data: u.d, forma: u.forma_pagamento } : null,
        status, notificacoes: notif,
      };
    });

    // ── Cards globais ──
    const saldoConsolidado = contas.reduce((s, c) => s + c.saldo_atual, 0);
    const reservadoTotal   = contas.reduce((s, c) => s + c.saldo_reservado, 0);
    const prev30Global     = contas.reduce((s, c) => s + c.saldo_previsto30, 0);
    const entHoje  = contas.reduce((s, c) => s + c.entradas_hoje, 0);
    const saiHoje  = contas.reduce((s, c) => s + c.saidas_hoje, 0);
    const entOntem = agg.reduce((s, r) => s + n(r.ent_ontem), 0);
    const saiOntem = agg.reduce((s, r) => s + n(r.sai_ontem), 0);
    const conciliadas = contas.filter(c => c.pend_conciliacao === 0).length;

    // Saldo consolidado no início do mês (para comparativo)
    const netMes = await db.get(`SELECT
      COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END),0) AS v
      FROM lancamentos WHERE status='pago' AND conta_id IS NOT NULL AND data_pagamento>=$1 AND status<>'cancelado'`, [m0]);
    const saldoIniMes = saldoConsolidado - n(netMes.v);

    // ── Sparklines (14 dias) ──
    const dias = [];
    for (let k = 13; k >= 0; k--) dias.push(addDias(-k));
    const sm = Object.fromEntries(sparkRows.map(r => [String(r.d).split('T')[0], r]));
    const entSpark = dias.map(d => n(sm[d]?.ent));
    const saiSpark = dias.map(d => n(sm[d]?.sai));
    let acc = saldoConsolidado - entSpark.reduce((a, b) => a + b, 0) + saiSpark.reduce((a, b) => a + b, 0);
    const saldoSpark = dias.map((d, idx) => { acc += entSpark[idx] - saiSpark[idx]; return +acc.toFixed(2); });

    res.json({
      cards: {
        saldoConsolidado: +saldoConsolidado.toFixed(2),
        saldoConsolidadoVar: pct(saldoConsolidado, saldoIniMes),
        saldoDisponivel: +(saldoConsolidado - reservadoTotal).toFixed(2),
        saldoReservado: +reservadoTotal.toFixed(2),
        saldoPrevisto30: +prev30Global.toFixed(2),
        entradasHoje: +entHoje.toFixed(2), entradasHojeVar: pct(entHoje, entOntem),
        saidasHoje: +saiHoje.toFixed(2),   saidasHojeVar: pct(saiHoje, saiOntem),
        pixPendentes: { qtd: i(pixPend.q), total: n(pixPend.v) },
        transfPendentes: { qtd: i(transfAgg.q), total: n(transfAgg.v) },
        contasConciliadas: { qtd: conciliadas, total: contas.length },
      },
      sparks: { dias, saldo: saldoSpark, entradas: entSpark, saidas: saiSpark },
      contas,
      transferenciasAgendadas: transfLista,
      atualizadoEm: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[tesouraria/painel]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   GET /insights — Insights Financeiros (IA) + Alertas
   ════════════════════════════════════════════════════════════════ */
router.get('/insights', async (req, res) => {
  try {
    const hoje = hojeStr(), d7 = addDias(7), d30a = addDias(-30), m0 = hoje.slice(0, 8) + '01';
    const pd = new Date(); pd.setDate(1); pd.setMonth(pd.getMonth() - 1);
    const m1 = pd.toISOString().split('T')[0];

    const [contas, recSemana, pixNaoConc, recMesConta, netAtual, netAnt, pendDia, extrPend, extrPix, semMovContas, pendConcQ, transfAg] = await Promise.all([
      getContasComSaldo(),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v, COUNT(*) AS q FROM lancamentos
              WHERE tipo='receita' AND status IN('pendente','atrasado') AND data_vencimento BETWEEN $1 AND $2`, [hoje, d7]),
      db.get(`SELECT COUNT(*) AS q, COALESCE(SUM(valor),0) AS v FROM lancamentos
              WHERE status='pago' AND LOWER(COALESCE(forma_pagamento,''))='pix' AND COALESCE(conciliado,false)=false AND data_pagamento>=$1`, [d30a]),
      db.all(`SELECT cc.nome, COALESCE(SUM(l.valor),0) AS v FROM lancamentos l
              JOIN contas_correntes cc ON cc.id=l.conta_id
              WHERE l.tipo='receita' AND l.status='pago' AND l.data_pagamento>=$1
              GROUP BY cc.nome ORDER BY v DESC`, [m0]),
      db.get(`SELECT COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END),0) AS v
              FROM lancamentos WHERE status='pago' AND data_pagamento>=$1`, [m0]),
      db.get(`SELECT COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END),0) AS v
              FROM lancamentos WHERE status='pago' AND data_pagamento>=$1 AND data_pagamento<$2`, [m1, m0]),
      db.all(`SELECT data_vencimento AS d,
              COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END),0) AS v
              FROM lancamentos WHERE status IN('pendente','atrasado') AND data_vencimento BETWEEN $1 AND $2
              GROUP BY 1 ORDER BY 1`, [hoje, addDias(30)]),
      db.get(`SELECT COUNT(*) AS q FROM extrato_bancario WHERE conciliado=0`),
      db.get(`SELECT COUNT(*) AS q FROM extrato_bancario WHERE conciliado=0 AND (LOWER(descricao) LIKE '%pix%' OR LOWER(COALESCE(memo,'')) LIKE '%pix%')`),
      db.all(`SELECT c.id, c.nome FROM contas_correntes c WHERE c.ativa=1 AND NOT EXISTS
              (SELECT 1 FROM lancamentos l WHERE l.conta_id=c.id AND l.status='pago' AND l.data_pagamento>=$1)`, [d30a]),
      db.get(`SELECT COUNT(*) AS q FROM lancamentos WHERE status='pago' AND COALESCE(conciliado,false)=false AND data_pagamento>=$1 AND conta_id IS NOT NULL`, [d30a]),
      db.get(`SELECT COUNT(*) AS q FROM fin_transferencias WHERE status='agendada'`),
    ]);

    const fmt = v => 'R$ ' + (Math.abs(v) >= 1000 ? (v/1000).toFixed(1).replace('.', ',') + ' mil' : v.toFixed(2).replace('.', ','));
    const insights = [];
    const saldoTotal = contas.reduce((s, c) => s + c.saldo_atual, 0);

    // 1. Projeção de saldo negativo
    let accSaldo = saldoTotal, diaNeg = null;
    for (const r of pendDia) {
      accSaldo += n(r.v);
      if (accSaldo < 0 && !diaNeg) diaNeg = String(r.d).split('T')[0];
    }
    if (diaNeg) {
      const dias = Math.max(Math.round((new Date(diaNeg) - new Date(hoje)) / 86400000), 1);
      insights.push({ tipo: 'perigo', icon: 'trending-down', msg: `Seu saldo ficará negativo em ${dias} dia(s) se mantiver o ritmo atual de saídas.` });
    }
    // 2. Previsto na semana
    if (n(recSemana.v) > 0) insights.push({ tipo: 'sucesso', icon: 'calendar-check', msg: `Há ${fmt(n(recSemana.v))} previstos para esta semana em contas a receber (${recSemana.q} parcela(s)).` });
    // 3. PIX não conciliados
    if (i(pixNaoConc.q) > 0) insights.push({ tipo: 'info', icon: 'zap', msg: `Existem ${pixNaoConc.q} PIX no valor total de ${fmt(n(pixNaoConc.v))} ainda não conciliados.` });
    // 4. Concentração de receitas
    const totRec = recMesConta.reduce((s, r) => s + n(r.v), 0);
    if (recMesConta.length && totRec > 0) {
      const top = recMesConta[0];
      const share = Math.round(n(top.v) / totRec * 100);
      if (share >= 50) insights.push({ tipo: 'info', icon: 'pie-chart', msg: `A conta ${top.nome} concentra ${share}% das receitas da empresa este mês.` });
    }
    // 5. Fluxo vs mês anterior
    const na = n(netAtual.v), nb = n(netAnt.v);
    if (nb !== 0) {
      const g = pct(na, Math.abs(nb));
      if (g !== null && Math.abs(g) >= 5) {
        insights.push(g > 0
          ? { tipo: 'sucesso', icon: 'trending-up', msg: `O fluxo de caixa está ${g.toFixed(0)}% melhor que o mês anterior.` }
          : { tipo: 'alerta', icon: 'trending-down', msg: `O fluxo de caixa está ${Math.abs(g).toFixed(0)}% pior que o mês anterior.` });
      }
    }
    // 6. Sugestão de transferência (conta abaixo do mínimo ← conta com maior sobra)
    const abaixoMin = contas.filter(c => n(c.saldo_minimo) > 0 && c.saldo_atual < n(c.saldo_minimo));
    if (abaixoMin.length) {
      const destino = abaixoMin[0];
      const falta = n(destino.saldo_minimo) - destino.saldo_atual;
      const origem = contas.filter(c => c.id !== destino.id && c.saldo_disponivel - n(c.saldo_minimo) > falta)
                           .sort((a, b) => b.saldo_disponivel - a.saldo_disponivel)[0];
      if (origem) insights.push({ tipo: 'alerta', icon: 'arrow-right-left', msg: `Sugiro transferir ${fmt(Math.ceil(falta / 100) * 100)} de ${origem.nome} para ${destino.nome} para cobrir o saldo mínimo.` });
    }
    if (!insights.length) insights.push({ tipo: 'sucesso', icon: 'check-circle', msg: 'Todos os indicadores de tesouraria estão saudáveis.' });

    // ── Alertas ──
    const alertas = [
      { chave: 'saldo_minimo',   label: 'Saldo abaixo do mínimo',      qtd: abaixoMin.length,                       cor: '#f87171' },
      { chave: 'negativas',      label: 'Contas negativas',            qtd: contas.filter(c => c.saldo_atual < 0).length, cor: '#f87171' },
      { chave: 'conciliacoes',   label: 'Conciliações pendentes',      qtd: i(pendConcQ.q) + i(extrPend.q),          cor: '#fbbf24' },
      { chave: 'pix',            label: 'PIX não identificados',       qtd: i(extrPix.q),                            cor: '#4ade80' },
      { chave: 'transferencias', label: 'Transferências pendentes',    qtd: i(transfAg.q),                           cor: '#60a5fa' },
      { chave: 'sem_mov',        label: 'Contas sem movimentação',     qtd: semMovContas.length,                     cor: '#94a3b8' },
    ];

    res.json({ insights, alertas });
  } catch (err) {
    console.error('[tesouraria/insights]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   GET /contas/:id/detalhe — drawer completo da conta
   ════════════════════════════════════════════════════════════════ */
router.get('/contas/:id/detalhe', async (req, res) => {
  try {
    const id = i(req.params.id);
    const limite = Math.min(i(req.query.limite) || 40, 300);
    const hoje = hojeStr();

    const contas = await getContasComSaldo();
    const conta = contas.find(c => c.id === id);
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' });

    const [extrato, prev, reservas, transf, resp] = await Promise.all([
      db.all(`SELECT l.id, l.tipo, l.descricao, l.valor, l.forma_pagamento, l.origem, l.conciliado,
                     COALESCE(l.data_pagamento, l.data_vencimento) AS data,
                     TO_CHAR(l.criado_em,'HH24:MI') AS hora,
                     cat.nome AS categoria_nome, cat.cor AS categoria_cor,
                     cli.nome AS cliente_nome, forn.nome AS fornecedor_nome,
                     p.numero AS pedido_numero
              FROM lancamentos l
              LEFT JOIN categorias cat ON cat.id=l.categoria_id
              LEFT JOIN clientes cli ON cli.id=l.cliente_id
              LEFT JOIN fornecedores forn ON forn.id=l.fornecedor_id
              LEFT JOIN pedidos p ON p.id=l.pedido_id
              WHERE l.conta_id=$1 AND l.status='pago'
              ORDER BY COALESCE(l.data_pagamento,l.data_vencimento) DESC, l.criado_em DESC
              LIMIT $2`, [id, limite]),
      db.all(`SELECT data_vencimento AS d,
              COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END),0) AS v
              FROM lancamentos WHERE conta_id=$1 AND status IN('pendente','atrasado') AND data_vencimento<=$2
              GROUP BY 1 ORDER BY 1`, [id, addDias(30)]),
      db.all(`SELECT r.*, p.numero AS pedido_numero FROM fin_reservas r
              LEFT JOIN pedidos p ON p.id=r.pedido_id
              WHERE r.conta_id=$1 ORDER BY (r.status='ativa') DESC, r.criado_em DESC LIMIT 20`, [id]),
      db.all(`SELECT t.*, co.nome AS origem_nome, cd.nome AS destino_nome
              FROM fin_transferencias t
              LEFT JOIN contas_correntes co ON co.id=t.conta_origem_id
              LEFT JOIN contas_correntes cd ON cd.id=t.conta_destino_id
              WHERE t.conta_origem_id=$1 OR t.conta_destino_id=$1
              ORDER BY (t.status='agendada') DESC, t.data DESC LIMIT 8`, [id]),
      conta.responsavel_id ? db.get(`SELECT nome FROM usuarios WHERE id=$1`, [conta.responsavel_id]) : Promise.resolve(null),
    ]);

    // Saldo após cada movimentação (do mais recente para trás)
    let run = conta.saldo_atual;
    const extratoComSaldo = extrato.map(m => {
      const saldoApos = +run.toFixed(2);
      run -= (m.tipo === 'receita' ? n(m.valor) : -n(m.valor));
      return { ...m, saldo_apos: saldoApos };
    });

    // Projeção hoje / 7 / 15 / 30
    let acc = conta.saldo_atual;
    const pontos = { hoje: +acc.toFixed(2), d7: null, d15: null, d30: null };
    const marcos = [[7, 'd7'], [15, 'd15'], [30, 'd30']];
    for (const [dias, key] of marcos) {
      const lim = addDias(dias);
      let v = conta.saldo_atual;
      for (const r of prev) { if (String(r.d).split('T')[0] <= lim) v += n(r.v); }
      pontos[key] = +v.toFixed(2);
    }

    res.json({
      conta: { ...conta, responsavel_nome: resp?.nome || null },
      extrato: extratoComSaldo,
      projecao: pontos,
      reservas,
      transferencias: transf,
    });
  } catch (err) {
    console.error('[tesouraria/detalhe]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   TRANSFERÊNCIAS
   ════════════════════════════════════════════════════════════════ */
router.post('/transferencias', async (req, res) => {
  try {
    const { conta_origem_id, conta_destino_id, valor, data, descricao } = req.body;
    const v = n(valor);
    if (!conta_origem_id || !conta_destino_id || v <= 0)
      return res.status(400).json({ erro: 'Origem, destino e valor são obrigatórios' });
    if (i(conta_origem_id) === i(conta_destino_id))
      return res.status(400).json({ erro: 'Origem e destino devem ser contas diferentes' });

    const hoje = hojeStr();
    const dataStr = (data || hoje).split('T')[0];
    const agendada = dataStr > hoje;
    const userId = req.usuario?.id || null;

    const tid = await db.insert(
      `INSERT INTO fin_transferencias (conta_origem_id, conta_destino_id, valor, data, descricao, status, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [conta_origem_id, conta_destino_id, v, dataStr, descricao || null, agendada ? 'agendada' : 'concluida', userId]);

    if (!agendada) {
      const desc = descricao ? ` — ${descricao}` : '';
      await db.run(`INSERT INTO lancamentos (tipo, descricao, valor, data_vencimento, data_pagamento, status, conta_id, origem)
                    VALUES ('despesa',$1,$2,$3,$3,'pago',$4,'transferencia')`,
                   [`Transferência enviada${desc}`, v, dataStr, conta_origem_id]);
      await db.run(`INSERT INTO lancamentos (tipo, descricao, valor, data_vencimento, data_pagamento, status, conta_id, origem)
                    VALUES ('receita',$1,$2,$3,$3,'pago',$4,'transferencia')`,
                   [`Transferência recebida${desc}`, v, dataStr, conta_destino_id]);
    }
    res.status(201).json({ id: tid, status: agendada ? 'agendada' : 'concluida' });
  } catch (err) {
    console.error('[tesouraria/transferencias POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.delete('/transferencias/:id', async (req, res) => {
  try {
    const t = await db.get(`SELECT * FROM fin_transferencias WHERE id=$1`, [req.params.id]);
    if (!t) return res.status(404).json({ erro: 'Transferência não encontrada' });
    if (t.status !== 'agendada') return res.status(400).json({ erro: 'Apenas transferências agendadas podem ser canceladas' });
    await db.run(`UPDATE fin_transferencias SET status='cancelada' WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   RESERVAS FINANCEIRAS
   ════════════════════════════════════════════════════════════════ */
router.post('/reservas', async (req, res) => {
  try {
    const { conta_id, pedido_id, descricao, valor } = req.body;
    const v = n(valor);
    if (!conta_id || !descricao || v <= 0)
      return res.status(400).json({ erro: 'Conta, descrição e valor são obrigatórios' });
    const id = await db.insert(
      `INSERT INTO fin_reservas (conta_id, pedido_id, descricao, valor) VALUES ($1,$2,$3,$4)`,
      [conta_id, pedido_id || null, descricao, v]);
    res.status(201).json({ id });
  } catch (err) {
    console.error('[tesouraria/reservas POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.patch('/reservas/:id/liberar', async (req, res) => {
  try {
    await db.run(`UPDATE fin_reservas SET status='liberada', liberado_em=NOW() WHERE id=$1 AND status='ativa'`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.delete('/reservas/:id', async (req, res) => {
  try {
    await db.run(`DELETE FROM fin_reservas WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
