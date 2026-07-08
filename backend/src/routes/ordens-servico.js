/* ════════════════════════════════════════════════════════════════
   ORDENS DE SERVIÇO — Centro Operacional da GM MÓBILE
   Controla toda a execução dos pedidos: checklist, equipe, materiais,
   fotos, assinatura digital, check-in por GPS, timeline, avaliação,
   dashboard, ranking de técnicos e relatórios — tudo integrado ao
   restante do ERP (Pedidos, Estoque, Kanban, Financeiro, Cliente).
   ════════════════════════════════════════════════════════════════ */
const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');
const { criarUpload, deletarArquivo } = require('../utils/cloudinary');

const router = express.Router();
router.use(autenticar);

const uploadFoto = criarUpload({ folder: 'ordens-servico/fotos', allowedFormats: ['jpg', 'jpeg', 'png', 'webp'], resourceType: 'image' });
const uploadAssinatura = criarUpload({ folder: 'ordens-servico/assinaturas', allowedFormats: ['jpg', 'jpeg', 'png', 'webp'], resourceType: 'image' });

const n = v => parseFloat(v) || 0;
const i = v => parseInt(v) || 0;
const pct = (a, b) => b > 0 ? +((a - b) / b * 100).toFixed(1) : null;
const hoje = () => new Date().toISOString().split('T')[0];
const addDias = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().split('T')[0]; };

async function registrarHistorico(osId, tipo, descricao) {
  await db.run(`INSERT INTO os_historico (os_id, tipo, descricao) VALUES ($1,$2,$3)`, [osId, tipo, descricao]);
}

async function recalcularProgresso(osId) {
  const [tot, fei] = await Promise.all([
    db.get('SELECT COUNT(*) AS n FROM os_checklist WHERE os_id=$1', [osId]),
    db.get(`SELECT COUNT(*) AS n FROM os_checklist WHERE os_id=$1 AND status='concluido'`, [osId]),
  ]);
  const pctv = i(tot.n) > 0 ? Math.round((i(fei.n) / i(tot.n)) * 100) : 0;
  await db.run('UPDATE ordens_servico SET checklist_progresso=$1 WHERE id=$2', [pctv, osId]);
  return pctv;
}

async function gerarNumero() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query("SELECT numero FROM ordens_servico ORDER BY id DESC LIMIT 1 FOR UPDATE");
    let numero;
    if (!rows[0]) numero = 'OS-0001';
    else numero = 'OS-' + String(parseInt(rows[0].numero.replace('OS-', '')) + 1).padStart(4, '0');
    await client.query('COMMIT');
    return numero;
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

const CHECKLIST_PADRAO = [
  { categoria: 'materiais', item: 'Separação de materiais' },
  { categoria: 'materiais', item: 'Materiais conferidos' },
  { categoria: 'materiais', item: 'Projeto conferido' },
  { categoria: 'materiais', item: 'Ferragens' },
  { categoria: 'materiais', item: 'Vidros' },
  { categoria: 'execucao', item: 'Montagem' },
  { categoria: 'execucao', item: 'Instalação' },
  { categoria: 'execucao', item: 'Limpeza' },
  { categoria: 'entrega', item: 'Entrega' },
  { categoria: 'entrega', item: 'Assinatura cliente' },
  { categoria: 'entrega', item: 'Fotos finais' },
];

/* ════════════════════════════════════════════════════════════════
   KPIs — 10 indicadores automáticos com sparkline (6 meses)
   ════════════════════════════════════════════════════════════════ */
router.get('/kpis', async (req, res) => {
  try {
    const m0 = hoje().slice(0, 8) + '01';
    const pd = new Date(); pd.setDate(1); pd.setMonth(pd.getMonth() - 1);
    const m1 = pd.toISOString().split('T')[0];
    const m1fim = m0;
    const sd = new Date(); sd.setMonth(sd.getMonth() - 5); sd.setDate(1);
    const sparkIni = sd.toISOString().split('T')[0];
    const meses = [];
    for (let k = 5; k >= 0; k--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }

    const [totais, agendadas, andamento, concluidas, atrasadas, canceladas, tempoMedio, mesAtual, hojeRow, mesSpark] = await Promise.all([
      db.get(`SELECT COUNT(*) AS v FROM ordens_servico WHERE status<>'cancelado'`),
      db.get(`SELECT COUNT(*) AS v FROM ordens_servico WHERE status='pendente'`),
      db.get(`SELECT COUNT(*) AS v FROM ordens_servico WHERE status='em_andamento'`),
      db.get(`SELECT COUNT(*) AS v FROM ordens_servico WHERE status='concluido'`),
      db.get(`SELECT COUNT(*) AS v FROM ordens_servico WHERE status NOT IN('concluido','cancelado') AND NULLIF(data_agendada,'') IS NOT NULL AND data_agendada::date < $1`, [hoje()]),
      db.get(`SELECT COUNT(*) AS v FROM ordens_servico WHERE status='cancelado'`),
      db.get(`SELECT AVG(EXTRACT(EPOCH FROM (concluido_em - criado_em))/3600) AS v FROM ordens_servico WHERE status='concluido' AND concluido_em IS NOT NULL AND criado_em>=$1`, [sparkIni]),
      db.get(`SELECT COUNT(*) AS v FROM ordens_servico WHERE criado_em>=$1`, [m0]),
      db.get(`SELECT COUNT(*) AS v FROM ordens_servico WHERE NULLIF(data_agendada,'') IS NOT NULL AND data_agendada::date=$1`, [hoje()]),
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS m, COUNT(*) AS v FROM ordens_servico WHERE criado_em>=$1 GROUP BY 1`, [sparkIni]),
    ]);

    const mapBy = rows => Object.fromEntries((rows || []).map(r => [r.m, r]));
    const mm = mapBy(mesSpark);
    const mesSparkArr = meses.map(k => n(mm[k]?.v));

    const taxaConclusao = i(totais.v) > 0 ? +(i(concluidas.v) / i(totais.v) * 100).toFixed(1) : null;

    res.json({
      total: { valor: i(totais.v), sparkline: mesSparkArr },
      agendadas: { valor: i(agendadas.v) },
      emAndamento: { valor: i(andamento.v) },
      concluidas: { valor: i(concluidas.v) },
      atrasadas: { valor: i(atrasadas.v) },
      canceladas: { valor: i(canceladas.v) },
      tempoMedioHoras: { valor: tempoMedio.v ? +n(tempoMedio.v).toFixed(1) : null },
      taxaConclusao: { valor: taxaConclusao },
      osMes: { valor: i(mesAtual.v) },
      osHoje: { valor: i(hojeRow.v) },
    });
  } catch (err) {
    console.error('[os/kpis]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   DASHBOARD LATERAL — Próximas OS, top técnicos, alertas, IA
   ════════════════════════════════════════════════════════════════ */
router.get('/dashboard', async (req, res) => {
  try {
    const amanha = addDias(1);
    const fimSemana = addDias(7);
    const d30 = addDias(30);

    const [proximas, porStatus, topTecnicos, materiaisPendentes, semTecnico, prazoVencendo, garantiaProxima] = await Promise.all([
      db.all(`
        SELECT os.id, os.numero, os.tipo, os.status, os.data_agendada, os.prioridade,
          c.nome AS cliente_nome, CONCAT_WS(', ', NULLIF(c.rua,''), NULLIF(c.numero,''), NULLIF(c.bairro,'')) AS endereco,
          t.nome AS tecnico_nome
        FROM ordens_servico os
        LEFT JOIN clientes c ON c.id=os.cliente_id
        LEFT JOIN usuarios t ON t.id=os.tecnico_id
        WHERE os.status NOT IN('concluido','cancelado') AND NULLIF(os.data_agendada,'') IS NOT NULL AND os.data_agendada::date BETWEEN $1 AND $2
        ORDER BY os.data_agendada ASC LIMIT 8`, [hoje(), fimSemana]),
      db.all(`SELECT status, COUNT(*) AS total FROM ordens_servico WHERE status<>'cancelado' GROUP BY status`),
      db.all(`
        SELECT t.id, t.nome, COUNT(os.id) AS concluidas,
          AVG(EXTRACT(EPOCH FROM (os.concluido_em - os.criado_em))/3600) AS tempo_medio,
          AVG(os.avaliacao_nota) AS avaliacao_media
        FROM ordens_servico os JOIN usuarios t ON t.id=os.tecnico_id
        WHERE os.status='concluido' GROUP BY t.id, t.nome ORDER BY concluidas DESC LIMIT 5`),
      db.all(`
        SELECT os.numero, om.nome, om.quantidade, p.estoque_atual
        FROM os_materiais om JOIN ordens_servico os ON os.id=om.os_id LEFT JOIN produtos p ON p.id=om.produto_id
        WHERE om.status IN('pendente','reservado') AND p.id IS NOT NULL AND p.estoque_atual < om.quantidade
        AND os.status NOT IN('concluido','cancelado') LIMIT 5`),
      db.get(`SELECT COUNT(*) AS v FROM ordens_servico WHERE tecnico_id IS NULL AND status NOT IN('concluido','cancelado')`),
      db.get(`SELECT COUNT(*) AS v FROM ordens_servico WHERE status NOT IN('concluido','cancelado') AND NULLIF(data_agendada,'') IS NOT NULL AND data_agendada::date BETWEEN $1 AND $2`, [hoje(), amanha]),
      db.get(`SELECT COUNT(*) AS v FROM pedidos WHERE data_entrega_real IS NOT NULL AND (data_entrega_real::date + (prazo_garantia_meses||' months')::interval) BETWEEN NOW() AND NOW() + INTERVAL '30 days'`),
    ]);

    // ── Insights IA (regras sobre dados reais) ──
    const insights = [];
    const atrasadasCount = await db.get(`SELECT COUNT(*) AS v FROM ordens_servico WHERE status NOT IN('concluido','cancelado') AND NULLIF(data_agendada,'') IS NOT NULL AND data_agendada::date < $1`, [hoje()]);
    if (i(atrasadasCount.v) > 0) insights.push({ tipo: 'perigo', icone: 'clock', msg: `Existem ${atrasadasCount.v} OS atrasadas.` });
    if (topTecnicos[0] && topTecnicos.length > 1) {
      const media = topTecnicos.reduce((s, t) => s + n(t.tempo_medio), 0) / topTecnicos.length;
      const melhor = topTecnicos.reduce((a, b) => n(a.tempo_medio) < n(b.tempo_medio) && n(a.tempo_medio) > 0 ? a : b);
      if (n(melhor.tempo_medio) > 0 && media > 0) {
        const dif = Math.round((1 - n(melhor.tempo_medio) / media) * 100);
        if (dif > 5) insights.push({ tipo: 'sucesso', icone: 'trending-up', msg: `Equipe ${melhor.nome} conclui ${dif}% mais rápido que a média.` });
      }
    }
    const noPrazoRow = await db.get(`SELECT COUNT(*) FILTER(WHERE concluido_em::date <= data_agendada::date) AS ok, COUNT(*) AS total FROM ordens_servico WHERE status='concluido' AND NULLIF(data_agendada,'') IS NOT NULL`);
    if (i(noPrazoRow.total) > 3) {
      const taxa = Math.round(i(noPrazoRow.ok) / i(noPrazoRow.total) * 100);
      insights.push({ tipo: 'info', icone: 'check-circle', msg: `${taxa}% das OS concluídas ocorreram dentro do prazo.` });
    }
    if (materiaisPendentes.length > 0) insights.push({ tipo: 'alerta', icone: 'package', msg: `Há materiais insuficientes para ${materiaisPendentes.length} OS.` });
    const semanaProxima = await db.get(`SELECT COUNT(*) AS v FROM ordens_servico WHERE NULLIF(data_agendada,'') IS NOT NULL AND data_agendada::date BETWEEN $1 AND $2`, [addDias(7), addDias(14)]);
    const semanaAtual = await db.get(`SELECT COUNT(*) AS v FROM ordens_servico WHERE NULLIF(data_agendada,'') IS NOT NULL AND data_agendada::date BETWEEN $1 AND $2`, [hoje(), addDias(7)]);
    if (i(semanaProxima.v) > i(semanaAtual.v) && i(semanaProxima.v) > 0) insights.push({ tipo: 'info', icone: 'calendar', msg: 'A próxima semana terá alta demanda de OS.' });
    if (!insights.length) insights.push({ tipo: 'sucesso', icone: 'check-circle', msg: 'Nenhum alerta operacional no momento.' });

    const alertas = [
      { chave: 'atrasadas', label: 'OS atrasadas', qtd: i(atrasadasCount.v), cor: '#f87171' },
      { chave: 'materiais', label: 'Materiais faltando', qtd: materiaisPendentes.length, cor: '#fb923c' },
      { chave: 'sem_tecnico', label: 'Equipe sem técnico', qtd: i(semTecnico.v), cor: '#fbbf24' },
      { chave: 'prazo_vencendo', label: 'Prazo vencendo (24h)', qtd: i(prazoVencendo.v), cor: '#60a5fa' },
      { chave: 'garantia_proxima', label: 'Garantia próxima (30d)', qtd: i(garantiaProxima.v), cor: '#94a3b8' },
    ];

    res.json({ proximas, porStatus, topTecnicos, alertas, insights: insights.slice(0, 6) });
  } catch (err) {
    console.error('[os/dashboard]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   GRÁFICOS — OS por mês/técnico/status, tempo médio, tipos
   ════════════════════════════════════════════════════════════════ */
router.get('/graficos', async (req, res) => {
  try {
    const d365 = addDias(-365);
    const [porMes, porTecnico, porStatus, porTipo] = await Promise.all([
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS m, COUNT(*) AS v FROM ordens_servico WHERE criado_em>=$1 GROUP BY 1 ORDER BY 1`, [d365]),
      db.all(`SELECT t.nome, COUNT(*) AS v FROM ordens_servico os JOIN usuarios t ON t.id=os.tecnico_id WHERE os.criado_em>=$1 GROUP BY t.nome ORDER BY v DESC LIMIT 8`, [d365]),
      db.all(`SELECT status, COUNT(*) AS v FROM ordens_servico WHERE criado_em>=$1 GROUP BY status`, [d365]),
      db.all(`SELECT tipo, COUNT(*) AS v FROM ordens_servico WHERE criado_em>=$1 GROUP BY tipo`, [d365]),
    ]);
    res.json({ porMes, porTecnico, porStatus, porTipo });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

/* ════════════════════════════════════════════════════════════════
   RANKING — Top técnicos por diferentes critérios
   ════════════════════════════════════════════════════════════════ */
router.get('/ranking', async (req, res) => {
  try {
    const criterio = req.query.criterio || 'concluidas';
    const d180 = addDias(-180);
    const rows = await db.all(`
      SELECT t.id, t.nome,
        COUNT(os.id) FILTER(WHERE os.status='concluido') AS concluidas,
        AVG(EXTRACT(EPOCH FROM (os.concluido_em - os.criado_em))/3600) FILTER(WHERE os.status='concluido') AS tempo_medio,
        AVG(os.avaliacao_nota) AS avaliacao_media,
        COUNT(os.id) FILTER(WHERE os.status='concluido' AND os.concluido_em::date <= os.data_agendada::date) AS pontuais,
        COUNT(os.id) FILTER(WHERE os.status='concluido' AND NULLIF(os.data_agendada,'') IS NOT NULL) AS total_com_prazo
      FROM usuarios t JOIN ordens_servico os ON os.tecnico_id=t.id
      WHERE os.criado_em>=$1
      GROUP BY t.id, t.nome
    `, [d180]);

    let lista = rows.map(r => ({
      id: r.id, nome: r.nome, concluidas: i(r.concluidas),
      tempoMedio: r.tempo_medio ? +n(r.tempo_medio).toFixed(1) : null,
      avaliacaoMedia: r.avaliacao_media ? +n(r.avaliacao_media).toFixed(1) : null,
      pontualidade: i(r.total_com_prazo) > 0 ? +(i(r.pontuais) / i(r.total_com_prazo) * 100).toFixed(1) : null,
      produtividade: i(r.concluidas),
    }));

    const ORD = {
      concluidas: (a, b) => b.concluidas - a.concluidas,
      tempo: (a, b) => (a.tempoMedio ?? Infinity) - (b.tempoMedio ?? Infinity),
      avaliacao: (a, b) => (b.avaliacaoMedia ?? 0) - (a.avaliacaoMedia ?? 0),
      produtividade: (a, b) => b.produtividade - a.produtividade,
      pontualidade: (a, b) => (b.pontualidade ?? 0) - (a.pontualidade ?? 0),
    };
    lista.sort(ORD[criterio] || ORD.concluidas);
    res.json(lista.slice(0, 10));
  } catch (err) {
    console.error('[os/ranking]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   LISTAGEM PRINCIPAL — busca + filtros + colunas calculadas
   ════════════════════════════════════════════════════════════════ */
router.get('/', async (req, res) => {
  try {
    const { busca, status, tipo, tecnico_id, cidade, prioridade, equipe, atrasadas, materiais_pendentes, periodo_ini, periodo_fim } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;

    if (busca) {
      where += ` AND (os.numero ILIKE $${idx} OR c.nome ILIKE $${idx} OR c.telefone ILIKE $${idx} OR p.numero ILIKE $${idx} OR os.tipo ILIKE $${idx} OR t.nome ILIKE $${idx} OR c.cidade ILIKE $${idx} OR c.bairro ILIKE $${idx})`;
      params.push(`%${busca}%`); idx++;
    }
    if (status)      { where += ` AND os.status=$${idx++}`;      params.push(status); }
    if (tipo)        { where += ` AND os.tipo=$${idx++}`;        params.push(tipo); }
    if (tecnico_id)  { where += ` AND os.tecnico_id=$${idx++}`;  params.push(tecnico_id); }
    if (cidade)      { where += ` AND c.cidade ILIKE $${idx++}`; params.push(`%${cidade}%`); }
    if (prioridade)  { where += ` AND os.prioridade=$${idx++}`;  params.push(prioridade); }
    if (periodo_ini) { where += ` AND NULLIF(os.data_agendada,'') IS NOT NULL AND os.data_agendada::date>=$${idx++}`; params.push(periodo_ini); }
    if (periodo_fim) { where += ` AND NULLIF(os.data_agendada,'') IS NOT NULL AND os.data_agendada::date<=$${idx++}`; params.push(periodo_fim); }
    if (atrasadas === '1') where += ` AND os.status NOT IN('concluido','cancelado') AND NULLIF(os.data_agendada,'') IS NOT NULL AND os.data_agendada::date < CURRENT_DATE`;

    const rows = await db.all(`
      SELECT os.*, c.nome AS cliente_nome, c.telefone AS cliente_tel, c.cidade AS cliente_cidade,
        t.nome AS tecnico_nome, p.numero AS pedido_numero, p.valor_final,
        (SELECT COUNT(*) FROM os_equipe oe WHERE oe.os_id=os.id) AS equipe_qtd,
        (SELECT COUNT(*) FROM os_materiais om WHERE om.os_id=os.id AND om.status IN('pendente','reservado')
          AND om.produto_id IS NOT NULL AND EXISTS(SELECT 1 FROM produtos pr WHERE pr.id=om.produto_id AND pr.estoque_atual<om.quantidade)) AS materiais_faltando
      FROM ordens_servico os
      LEFT JOIN clientes c ON c.id=os.cliente_id
      LEFT JOIN usuarios t ON t.id=os.tecnico_id
      LEFT JOIN pedidos p ON p.id=os.pedido_id
      ${where}
      ORDER BY os.data_agendada ASC NULLS LAST, os.criado_em DESC
    `, params);

    let lista = rows.map(r => ({
      ...r,
      atrasada: r.status !== 'concluido' && r.status !== 'cancelado' && r.data_agendada && new Date(r.data_agendada) < new Date(hoje()),
      materiais_faltando: i(r.materiais_faltando),
      equipe_qtd: i(r.equipe_qtd),
    }));

    if (materiais_pendentes === '1') lista = lista.filter(o => o.materiais_faltando > 0);
    if (equipe === '0') lista = lista.filter(o => o.equipe_qtd === 0);

    res.json(lista);
  } catch (err) {
    console.error('[os GET]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   DRAWER — ficha completa da OS
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/resumo', async (req, res) => {
  try {
    const id = req.params.id;
    const [os, checklistStats, equipeQtd, fotosQtd] = await Promise.all([
      db.get(`
        SELECT os.*, c.nome AS cliente_nome, c.telefone AS cliente_tel, c.whatsapp AS cliente_whatsapp, c.email AS cliente_email,
          CONCAT_WS(', ', NULLIF(c.rua,''), NULLIF(c.numero,''), NULLIF(c.bairro,'')) AS cliente_endereco,
          c.cidade AS cliente_cidade, c.estado AS cliente_estado,
          t.nome AS tecnico_nome, p.numero AS pedido_numero, p.valor_final, o.tipo_projeto,
          o.numero AS orcamento_numero
        FROM ordens_servico os
        LEFT JOIN clientes c ON c.id=os.cliente_id
        LEFT JOIN usuarios t ON t.id=os.tecnico_id
        LEFT JOIN pedidos p ON p.id=os.pedido_id
        LEFT JOIN orcamentos o ON o.id=p.orcamento_id
        WHERE os.id=$1`, [id]),
      db.get(`SELECT COUNT(*) AS tot, COUNT(*) FILTER(WHERE status='concluido') AS feito FROM os_checklist WHERE os_id=$1`, [id]),
      db.get(`SELECT COUNT(*) AS v FROM os_equipe WHERE os_id=$1`, [id]),
      db.get(`SELECT COUNT(*) AS v FROM os_fotos WHERE os_id=$1`, [id]),
    ]);
    if (!os) return res.status(404).json({ erro: 'OS não encontrada' });

    res.json({
      os,
      checklist: { total: i(checklistStats.tot), feito: i(checklistStats.feito), pct: os.checklist_progresso },
      equipeQtd: i(equipeQtd.v),
      fotosQtd: i(fotosQtd.v),
    });
  } catch (err) {
    console.error('[os/:id/resumo]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const os = await db.get(`
      SELECT os.*, c.nome AS cliente_nome, c.telefone AS cliente_tel, c.whatsapp AS cliente_whatsapp,
        c.rua, c.numero AS end_numero, c.bairro, c.cidade, c.estado,
        t.nome AS tecnico_nome, p.numero AS pedido_numero
      FROM ordens_servico os
      LEFT JOIN clientes c ON c.id=os.cliente_id
      LEFT JOIN usuarios t ON t.id=os.tecnico_id
      LEFT JOIN pedidos p ON p.id=os.pedido_id
      WHERE os.id=$1`, [req.params.id]);
    if (!os) return res.status(404).json({ erro: 'OS não encontrada' });
    res.json(os);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar OS' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { cliente_id, pedido_id, tecnico_id, tipo, data_agendada, descricao, itens_instalados, prioridade, tempo_previsto_min } = req.body;
    if (!cliente_id) return res.status(400).json({ erro: 'Cliente é obrigatório' });
    const numero = await gerarNumero();
    const id = await db.insert(`
      INSERT INTO ordens_servico (numero, cliente_id, pedido_id, tecnico_id, tipo, data_agendada, descricao, itens_instalados, prioridade, tempo_previsto_min)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [numero, cliente_id, pedido_id||null, tecnico_id||null, tipo||'instalacao',
        data_agendada||null, descricao||null, itens_instalados||null, prioridade||'normal', i(tempo_previsto_min)||null]);

    for (let k = 0; k < CHECKLIST_PADRAO.length; k++) {
      await db.run(`INSERT INTO os_checklist (os_id, categoria, item, ordem) VALUES ($1,$2,$3,$4)`,
        [id, CHECKLIST_PADRAO[k].categoria, CHECKLIST_PADRAO[k].item, k]);
    }
    await registrarHistorico(id, 'criada', `OS ${numero} criada`);
    res.status(201).json({ id, numero });
  } catch (err) {
    console.error('[os POST]', err.message);
    res.status(500).json({ erro: 'Erro ao criar OS' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { tecnico_id, tipo, data_agendada, descricao, itens_instalados, observacoes_tecnico, prioridade, tempo_previsto_min } = req.body;
    const antes = await db.get('SELECT tecnico_id FROM ordens_servico WHERE id=$1', [req.params.id]);
    await db.run(`
      UPDATE ordens_servico SET tecnico_id=$1, tipo=$2, data_agendada=$3, descricao=$4,
        itens_instalados=$5, observacoes_tecnico=$6, prioridade=$7, tempo_previsto_min=$8 WHERE id=$9
    `, [tecnico_id||null, tipo, data_agendada||null, descricao||null, itens_instalados||null,
        observacoes_tecnico||null, prioridade||'normal', i(tempo_previsto_min)||null, req.params.id]);
    if (tecnico_id && String(antes?.tecnico_id) !== String(tecnico_id)) {
      const t = await db.get('SELECT nome FROM usuarios WHERE id=$1', [tecnico_id]);
      await registrarHistorico(req.params.id, 'equipe', `Técnico responsável definido: ${t?.nome || '—'}`);
    }
    res.json({ mensagem: 'OS atualizada' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar OS' });
  }
});

/* Mapeamento OS → etapa do Kanban (v2, 12 etapas reais) para propagar a
   conclusão da execução de volta ao pedido, sem retroceder estágio. */
const ETAPAS_KANBAN = ['novo_pedido','aguardando_medicao','projeto_3d','aguardando_aprovacao','compra_materiais','producao','montagem','qualidade','entrega_agendada','entregue','assistencia','concluido'];
async function avancarKanban(pedidoId, novaEtapa) {
  const pedido = await db.get('SELECT id, etapa_producao, status FROM pedidos WHERE id=$1', [pedidoId]);
  if (!pedido || pedido.status === 'cancelado') return;
  const idxAtual = ETAPAS_KANBAN.indexOf(pedido.etapa_producao);
  const idxNova = ETAPAS_KANBAN.indexOf(novaEtapa);
  if (idxNova <= idxAtual) return;
  const progresso = Math.round((idxNova / (ETAPAS_KANBAN.length - 1)) * 100);
  await db.run('UPDATE pedidos SET etapa_producao=$1, etapa_atualizada_em=NOW(), progresso=$2 WHERE id=$3', [novaEtapa, progresso, pedidoId]);
  if (novaEtapa === 'concluido') await db.run(`UPDATE pedidos SET status='concluido' WHERE id=$1`, [pedidoId]);
  await db.run('INSERT INTO kanban_timeline (pedido_id, tipo, descricao) VALUES ($1,$2,$3)', [pedidoId, 'etapa', `Movido para "${novaEtapa}" via conclusão de OS`]);
}
const OS_TIPO_ETAPA_CONCLUSAO = { visita: 'projeto_3d', instalacao: 'concluido', entrega: 'entregue', manutencao: null };

router.patch('/:id/status', async (req, res) => {
  try {
    const { status, observacoes_tecnico } = req.body;
    const validos = ['pendente','agendada','separando_materiais','em_producao','pronta_instalacao','em_deslocamento','em_andamento','pausada','aguardando_cliente','aguardando_material','concluido','cancelado'];
    if (!validos.includes(status)) return res.status(400).json({ erro: 'Status inválido' });

    const os = await db.get('SELECT * FROM ordens_servico WHERE id=$1', [req.params.id]);
    if (!os) return res.status(404).json({ erro: 'OS não encontrada' });

    await db.run(`
      UPDATE ordens_servico SET status=$1, observacoes_tecnico=COALESCE($2,observacoes_tecnico),
        concluido_em=CASE WHEN $1='concluido' THEN NOW() ELSE concluido_em END
      WHERE id=$3
    `, [status, observacoes_tecnico||null, req.params.id]);

    const STATUS_LBL = { pendente:'Nova', agendada:'Agendada', separando_materiais:'Separando materiais', em_producao:'Em produção',
      pronta_instalacao:'Pronta para instalação', em_deslocamento:'Em deslocamento', em_andamento:'Em execução', pausada:'Pausada',
      aguardando_cliente:'Aguardando cliente', aguardando_material:'Aguardando material', concluido:'Concluída', cancelado:'Cancelada' };
    await registrarHistorico(req.params.id, 'status', `Status alterado para "${STATUS_LBL[status]||status}"`);

    if (status === 'concluido' && os.pedido_id) {
      const etapaAlvo = OS_TIPO_ETAPA_CONCLUSAO[os.tipo];
      if (etapaAlvo) await avancarKanban(os.pedido_id, etapaAlvo).catch(e => console.error('[os avancarKanban]', e.message));
    }

    res.json({ mensagem: 'Status atualizado' });
  } catch (err) {
    console.error('[os status PATCH]', err.message);
    res.status(500).json({ erro: 'Erro ao atualizar status' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.run("UPDATE ordens_servico SET status='cancelado' WHERE id=$1", [req.params.id]);
    await registrarHistorico(req.params.id, 'status', 'OS cancelada');
    res.json({ mensagem: 'OS cancelada' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao cancelar OS' });
  }
});

/* ════════════════════════════════════════════════════════════════
   CHECKLIST
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/checklist', async (req, res) => {
  try {
    res.json(await db.all(`SELECT * FROM os_checklist WHERE os_id=$1 ORDER BY categoria, ordem, id`, [req.params.id]));
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.post('/:id/checklist', async (req, res) => {
  try {
    const { categoria, item } = req.body;
    if (!item) return res.status(400).json({ erro: 'Item é obrigatório' });
    const max = await db.get(`SELECT COALESCE(MAX(ordem),0) AS m FROM os_checklist WHERE os_id=$1`, [req.params.id]);
    const id = await db.insert(`INSERT INTO os_checklist (os_id, categoria, item, ordem) VALUES ($1,$2,$3,$4)`,
      [req.params.id, categoria||'geral', item, i(max.m)+1]);
    await recalcularProgresso(req.params.id);
    res.status(201).json({ id });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.patch('/checklist/:itemId', async (req, res) => {
  try {
    const { status } = req.body;
    const validos = ['pendente','em_andamento','concluido'];
    if (!validos.includes(status)) return res.status(400).json({ erro: 'Status inválido' });
    const item = await db.get('SELECT * FROM os_checklist WHERE id=$1', [req.params.itemId]);
    if (!item) return res.status(404).json({ erro: 'Item não encontrado' });
    await db.run(`UPDATE os_checklist SET status=$1, concluido_por=$2, concluido_em=CASE WHEN $1='concluido' THEN NOW() ELSE NULL END WHERE id=$3`,
      [status, status==='concluido' ? req.usuario?.id : null, req.params.itemId]);
    const pctv = await recalcularProgresso(item.os_id);
    if (status === 'concluido') await registrarHistorico(item.os_id, 'checklist', `Item "${item.item}" concluído`);
    res.json({ mensagem: 'Item atualizado', progresso: pctv });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.delete('/checklist/:itemId', async (req, res) => {
  try {
    const item = await db.get('SELECT os_id FROM os_checklist WHERE id=$1', [req.params.itemId]);
    if (!item) return res.status(404).json({ erro: 'Item não encontrado' });
    await db.run('DELETE FROM os_checklist WHERE id=$1', [req.params.itemId]);
    await recalcularProgresso(item.os_id);
    res.json({ mensagem: 'Item removido' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

/* ════════════════════════════════════════════════════════════════
   EQUIPE
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/equipe', async (req, res) => {
  try {
    res.json(await db.all(`SELECT * FROM os_equipe WHERE os_id=$1 ORDER BY id`, [req.params.id]));
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.post('/:id/equipe', async (req, res) => {
  try {
    const { usuario_id, nome, funcao, telefone } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
    const id = await db.insert(`INSERT INTO os_equipe (os_id, usuario_id, nome, funcao, telefone) VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, usuario_id||null, nome, funcao||'montador', telefone||null]);
    await registrarHistorico(req.params.id, 'equipe', `${nome} adicionado à equipe (${funcao||'montador'})`);
    res.status(201).json({ id });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.patch('/equipe/:membroId', async (req, res) => {
  try {
    const { status } = req.body;
    await db.run(`UPDATE os_equipe SET status=$1 WHERE id=$2`, [status, req.params.membroId]);
    res.json({ mensagem: 'Atualizado' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.delete('/equipe/:membroId', async (req, res) => {
  try {
    await db.run('DELETE FROM os_equipe WHERE id=$1', [req.params.membroId]);
    res.json({ mensagem: 'Removido' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

/* ════════════════════════════════════════════════════════════════
   MATERIAIS — integra com Estoque real na separação
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/materiais', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT om.*, p.estoque_atual, p.unidade
      FROM os_materiais om LEFT JOIN produtos p ON p.id=om.produto_id
      WHERE om.os_id=$1 ORDER BY om.id`, [req.params.id]);
    res.json(rows.map(r => ({ ...r, falta: r.produto_id && n(r.estoque_atual) < n(r.quantidade) })));
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.post('/:id/materiais', async (req, res) => {
  try {
    const { produto_id, nome, quantidade } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
    const id = await db.insert(`INSERT INTO os_materiais (os_id, produto_id, nome, quantidade) VALUES ($1,$2,$3,$4)`,
      [req.params.id, produto_id||null, nome, n(quantidade)||1]);
    res.status(201).json({ id });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.patch('/materiais/:materialId/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validos = ['pendente','reservado','separado','utilizado'];
    if (!validos.includes(status)) return res.status(400).json({ erro: 'Status inválido' });
    const mat = await db.get('SELECT * FROM os_materiais WHERE id=$1', [req.params.materialId]);
    if (!mat) return res.status(404).json({ erro: 'Material não encontrado' });

    // Ao separar fisicamente, gera uma saída real de estoque (best-effort)
    if (status === 'separado' && mat.status !== 'separado' && mat.status !== 'utilizado' && mat.produto_id) {
      const produto = await db.get('SELECT * FROM produtos WHERE id=$1', [mat.produto_id]);
      if (produto && n(produto.estoque_atual) >= n(mat.quantidade)) {
        const os = await db.get('SELECT pedido_id, numero FROM ordens_servico WHERE id=$1', [mat.os_id]);
        const client = await db.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, observacao, pedido_id, usuario_id) VALUES ($1,'saida',$2,$3,$4,$5)`,
            [mat.produto_id, n(mat.quantidade), `Separado para OS ${os?.numero||''}`, os?.pedido_id||null, req.usuario?.id||null]);
          await client.query('UPDATE produtos SET estoque_atual=estoque_atual-$1 WHERE id=$2', [n(mat.quantidade), mat.produto_id]);
          await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      }
    }

    await db.run(`UPDATE os_materiais SET status=$1, atualizado_em=NOW() WHERE id=$2`, [status, req.params.materialId]);
    await registrarHistorico(mat.os_id, 'material', `Material "${mat.nome}" marcado como ${status}`);
    res.json({ mensagem: 'Material atualizado' });
  } catch (err) {
    console.error('[os materiais status]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.delete('/materiais/:materialId', async (req, res) => {
  try {
    await db.run('DELETE FROM os_materiais WHERE id=$1', [req.params.materialId]);
    res.json({ mensagem: 'Removido' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

/* ════════════════════════════════════════════════════════════════
   FOTOS
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/fotos', async (req, res) => {
  try {
    res.json(await db.all(`SELECT * FROM os_fotos WHERE os_id=$1 ORDER BY criado_em DESC`, [req.params.id]));
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.post('/:id/fotos', uploadFoto.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Arquivo é obrigatório' });
    const { categoria } = req.body;
    const id = await db.insert(`INSERT INTO os_fotos (os_id, categoria, url, criado_por) VALUES ($1,$2,$3,$4)`,
      [req.params.id, categoria||'durante', req.file.path, req.usuario?.id||null]);
    await registrarHistorico(req.params.id, 'foto', `Foto (${categoria||'durante'}) adicionada`);
    res.status(201).json({ id, url: req.file.path });
  } catch (err) {
    console.error('[os fotos POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.delete('/fotos/:fotoId', async (req, res) => {
  try {
    const f = await db.get('SELECT url FROM os_fotos WHERE id=$1', [req.params.fotoId]);
    await db.run('DELETE FROM os_fotos WHERE id=$1', [req.params.fotoId]);
    if (f) deletarArquivo(f.url).catch(() => {});
    res.json({ mensagem: 'Foto removida' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

/* ════════════════════════════════════════════════════════════════
   ASSINATURA DIGITAL — registro visual de confirmação (sem validade
   jurídica formal), capturada em canvas no momento da entrega
   ════════════════════════════════════════════════════════════════ */
router.post('/:id/assinatura', uploadAssinatura.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Arquivo é obrigatório' });
    const { tipo } = req.body; // 'cliente' | 'tecnico'
    const coluna = tipo === 'tecnico' ? 'assinatura_tecnico_url' : 'assinatura_cliente_url';
    await db.run(`UPDATE ordens_servico SET ${coluna}=$1 WHERE id=$2`, [req.file.path, req.params.id]);
    await registrarHistorico(req.params.id, 'assinatura', `Assinatura do ${tipo === 'tecnico' ? 'técnico' : 'cliente'} registrada`);
    res.status(201).json({ url: req.file.path });
  } catch (err) {
    console.error('[os assinatura POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   CHECK-IN / CHECK-OUT POR GPS
   ════════════════════════════════════════════════════════════════ */
router.post('/:id/checkin', async (req, res) => {
  try {
    const { tipo, latitude, longitude } = req.body; // tipo: 'chegada' | 'saida'
    if (latitude === undefined || longitude === undefined) return res.status(400).json({ erro: 'Localização é obrigatória' });
    if (tipo === 'saida') {
      await db.run(`UPDATE ordens_servico SET hora_saida=NOW(), latitude_saida=$1, longitude_saida=$2 WHERE id=$3`, [latitude, longitude, req.params.id]);
      await registrarHistorico(req.params.id, 'checkin', 'Saída registrada (check-out por GPS)');
    } else {
      await db.run(`UPDATE ordens_servico SET hora_chegada=NOW(), latitude_chegada=$1, longitude_chegada=$2 WHERE id=$3`, [latitude, longitude, req.params.id]);
      await registrarHistorico(req.params.id, 'checkin', 'Chegada registrada (check-in por GPS)');
    }
    res.json({ mensagem: 'Localização registrada' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

/* ════════════════════════════════════════════════════════════════
   AVALIAÇÃO DO CLIENTE
   ════════════════════════════════════════════════════════════════ */
router.patch('/:id/avaliacao', async (req, res) => {
  try {
    const { nota, comentario } = req.body;
    if (!nota || nota < 1 || nota > 5) return res.status(400).json({ erro: 'Nota (1 a 5) é obrigatória' });
    await db.run(`UPDATE ordens_servico SET avaliacao_nota=$1, avaliacao_comentario=$2 WHERE id=$3`, [i(nota), comentario||null, req.params.id]);
    await registrarHistorico(req.params.id, 'avaliacao', `Cliente avaliou o serviço com nota ${nota}`);
    res.json({ mensagem: 'Avaliação registrada' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

/* ════════════════════════════════════════════════════════════════
   HISTÓRICO — timeline automática
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/historico', async (req, res) => {
  try {
    res.json(await db.all(`SELECT * FROM os_historico WHERE os_id=$1 ORDER BY criado_em DESC LIMIT 100`, [req.params.id]));
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

/* ════════════════════════════════════════════════════════════════
   RELATÓRIOS
   ════════════════════════════════════════════════════════════════ */
router.get('/relatorios/:tipo', async (req, res) => {
  try {
    const { tipo } = req.params;
    const { inicio, fim } = req.query;
    const dIni = inicio || addDias(-365);
    const dFim = fim || hoje();

    let dados;
    switch (tipo) {
      case 'concluidas':
        dados = await db.all(`
          SELECT os.numero, c.nome AS cliente, t.nome AS tecnico, os.tipo, os.data_agendada, os.concluido_em
          FROM ordens_servico os LEFT JOIN clientes c ON c.id=os.cliente_id LEFT JOIN usuarios t ON t.id=os.tecnico_id
          WHERE os.status='concluido' AND os.concluido_em::date BETWEEN $1::date AND $2::date ORDER BY os.concluido_em DESC`, [dIni, dFim]);
        break;
      case 'atrasadas':
        dados = await db.all(`
          SELECT os.numero, c.nome AS cliente, t.nome AS tecnico, os.tipo, os.status, os.data_agendada
          FROM ordens_servico os LEFT JOIN clientes c ON c.id=os.cliente_id LEFT JOIN usuarios t ON t.id=os.tecnico_id
          WHERE os.status NOT IN('concluido','cancelado') AND NULLIF(os.data_agendada,'') IS NOT NULL AND os.data_agendada::date < CURRENT_DATE
          ORDER BY os.data_agendada ASC`);
        break;
      case 'tempo-medio':
        dados = await db.all(`
          SELECT t.nome AS tecnico, COUNT(os.id) AS qtd, AVG(EXTRACT(EPOCH FROM (os.concluido_em - os.criado_em))/3600) AS tempo_medio_horas
          FROM ordens_servico os LEFT JOIN usuarios t ON t.id=os.tecnico_id
          WHERE os.status='concluido' AND os.concluido_em::date BETWEEN $1::date AND $2::date GROUP BY t.nome ORDER BY tempo_medio_horas ASC`, [dIni, dFim]);
        break;
      case 'produtividade':
        dados = await db.all(`
          SELECT t.nome AS tecnico, COUNT(*) AS concluidas
          FROM ordens_servico os JOIN usuarios t ON t.id=os.tecnico_id
          WHERE os.status='concluido' AND os.concluido_em::date BETWEEN $1::date AND $2::date GROUP BY t.nome ORDER BY concluidas DESC`, [dIni, dFim]);
        break;
      case 'materiais':
        dados = await db.all(`
          SELECT os.numero, om.nome, om.quantidade, om.status, p.estoque_atual
          FROM os_materiais om JOIN ordens_servico os ON os.id=om.os_id LEFT JOIN produtos p ON p.id=om.produto_id
          WHERE os.criado_em BETWEEN $1 AND $2 ORDER BY os.numero`, [dIni, dFim]);
        break;
      case 'equipe':
        dados = await db.all(`
          SELECT os.numero, oe.nome, oe.funcao, oe.status, oe.telefone
          FROM os_equipe oe JOIN ordens_servico os ON os.id=oe.os_id
          WHERE os.criado_em BETWEEN $1 AND $2 ORDER BY os.numero`, [dIni, dFim]);
        break;
      case 'garantias':
        dados = await db.all(`
          SELECT p.numero, c.nome AS cliente, p.data_entrega_real, p.prazo_garantia_meses,
            (p.data_entrega_real::date + (p.prazo_garantia_meses||' months')::interval) AS vencimento
          FROM pedidos p LEFT JOIN clientes c ON c.id=p.cliente_id
          WHERE p.data_entrega_real IS NOT NULL ORDER BY vencimento ASC`);
        break;
      default:
        return res.status(400).json({ erro: 'Tipo de relatório inválido' });
    }
    res.json({ tipo, periodo: { inicio: dIni, fim: dFim }, dados });
  } catch (err) {
    console.error('[os relatorios]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
