/* ════════════════════════════════════════════════════════════════
   PARCEIROS — Plataforma de Gestão de Relacionamento Comercial
   Cadastro + indicações + vendas + comissões + documentos + avaliações
   + histórico + dashboard + ranking + relatórios, tudo integrado ao
   restante do ERP: indicação (leads) → orçamento → pedido → comissão
   → financeiro/contas correntes, sem duplicar dados.
   ════════════════════════════════════════════════════════════════ */
const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');
const { criarUpload, deletarArquivo } = require('../utils/cloudinary');

const router = express.Router();
router.use(autenticar);

const upload = criarUpload({ folder: 'parceiros/documentos', allowedFormats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'], resourceType: 'auto' });
const uploadFoto = criarUpload({ folder: 'parceiros/fotos', allowedFormats: ['jpg', 'jpeg', 'png', 'webp'], resourceType: 'image' });

const n = v => parseFloat(v) || 0;
const i = v => parseInt(v) || 0;
const pct = (a, b) => b > 0 ? +((a - b) / b * 100).toFixed(1) : null;
const hoje = () => new Date().toISOString().split('T')[0];
const addDias = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().split('T')[0]; };
const fmtBRL = v => 'R$ ' + n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function registrarHistorico(parceiroId, tipo, descricao) {
  await db.run(`INSERT INTO parc_historico (parceiro_id, tipo, descricao) VALUES ($1,$2,$3)`, [parceiroId, tipo, descricao]);
}

/* ════════════════════════════════════════════════════════════════
   CATEGORIAS
   ════════════════════════════════════════════════════════════════ */
router.get('/categorias', async (req, res) => {
  try {
    res.json(await db.all(`SELECT * FROM parc_categorias WHERE ativo=true ORDER BY nome`));
  } catch (err) { res.status(500).json({ erro: 'Erro ao listar categorias' }); }
});

router.post('/categorias', async (req, res) => {
  try {
    const { nome, cor } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
    const id = await db.insert(`INSERT INTO parc_categorias (nome, cor) VALUES ($1,$2) ON CONFLICT (nome) DO NOTHING`, [nome, cor || '#818cf8']);
    res.status(201).json({ id });
  } catch (err) { res.status(500).json({ erro: 'Erro ao criar categoria' }); }
});

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

    const [
      totais, indicAtual, indicAnt, vendasAtual, vendasAnt, comissoes, conv,
      indicSpark, vendasSpark, comissoesSpark,
    ] = await Promise.all([
      db.get(`SELECT COUNT(*) AS total, COUNT(*) FILTER(WHERE ativo=1) AS ativos, COUNT(*) FILTER(WHERE ativo=0) AS inativos FROM parceiros`),
      db.get(`SELECT COUNT(*) AS q FROM leads WHERE parceiro_id IS NOT NULL AND criado_em>=$1`, [m0]),
      db.get(`SELECT COUNT(*) AS q FROM leads WHERE parceiro_id IS NOT NULL AND criado_em>=$1 AND criado_em<$2`, [m1, m1fim]),
      db.get(`SELECT COUNT(*) AS q, COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE parceiro_id IS NOT NULL AND criado_em>=$1`, [m0]),
      db.get(`SELECT COUNT(*) AS q, COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE parceiro_id IS NOT NULL AND criado_em>=$1 AND criado_em<$2`, [m1, m1fim]),
      db.get(`SELECT
        COALESCE(SUM(valor_comissao) FILTER(WHERE status='pendente'),0) AS pendente,
        COALESCE(SUM(valor_comissao) FILTER(WHERE status='pago' AND data_pagamento>=$1),0) AS pago
        FROM comissoes WHERE tipo='parceiro'`, [m0]),
      db.get(`SELECT COUNT(*) AS total, COUNT(*) FILTER(WHERE etapa IN ('fechado','pedido_confirmado')) AS fechados FROM leads WHERE parceiro_id IS NOT NULL`),
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS m, COUNT(*) AS v FROM leads WHERE parceiro_id IS NOT NULL AND criado_em>=$1 GROUP BY 1`, [sparkIni]),
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS m, COALESCE(SUM(valor_final),0) AS v FROM pedidos WHERE parceiro_id IS NOT NULL AND criado_em>=$1 GROUP BY 1`, [sparkIni]),
      db.all(`SELECT TO_CHAR(data_pagamento::date,'YYYY-MM') AS m, COALESCE(SUM(valor_comissao),0) AS v FROM comissoes WHERE tipo='parceiro' AND status='pago' AND data_pagamento>=$1 GROUP BY 1`, [sparkIni]),
    ]);

    const mapBy = rows => Object.fromEntries((rows || []).map(r => [r.m, r]));
    const im = mapBy(indicSpark), vm = mapBy(vendasSpark), cm = mapBy(comissoesSpark);
    const indicSparkArr = meses.map(k => n(im[k]?.v));
    const vendasSparkArr = meses.map(k => n(vm[k]?.v));
    const comissoesSparkArr = meses.map(k => n(cm[k]?.v));

    const ticketMedio = i(vendasAtual.q) > 0 ? n(vendasAtual.v) / i(vendasAtual.q) : 0;
    const conversao = i(conv.total) > 0 ? +(i(conv.fechados) / i(conv.total) * 100).toFixed(1) : null;

    res.json({
      totalParceiros: { valor: i(totais.total), sparkline: null },
      ativos: { valor: i(totais.ativos) },
      inativos: { valor: i(totais.inativos) },
      indicacoesMes: { valor: i(indicAtual.q), variacao: pct(i(indicAtual.q), i(indicAnt.q)), sparkline: indicSparkArr },
      vendasGeradas: { valor: i(vendasAtual.q), variacao: pct(i(vendasAtual.q), i(vendasAnt.q)) },
      valorVendido: { valor: n(vendasAtual.v), variacao: pct(n(vendasAtual.v), n(vendasAnt.v)), sparkline: vendasSparkArr },
      comissoesPendentes: { valor: n(comissoes.pendente) },
      comissoesPagas: { valor: n(comissoes.pago), sparkline: comissoesSparkArr },
      conversao: { valor: conversao },
      ticketMedio: { valor: +ticketMedio.toFixed(2) },
    });
  } catch (err) {
    console.error('[parceiros/kpis]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   DASHBOARD LATERAL — Top parceiros, vendas por categoria, alertas, IA
   ════════════════════════════════════════════════════════════════ */
router.get('/dashboard', async (req, res) => {
  try {
    const m0 = hoje().slice(0, 8) + '01';
    const d90 = addDias(-90);
    const d30 = addDias(30);

    const [top, porCategoria, comissoesVencidas, contratosVencendo, docsVencendo, semVendas, semIndicar, conversaoBaixa] = await Promise.all([
      db.all(`SELECT p.id, p.nome, COALESCE(SUM(ped.valor_final),0) AS total, COUNT(ped.id) AS qtd
              FROM parceiros p LEFT JOIN pedidos ped ON ped.parceiro_id=p.id AND ped.criado_em>=$1
              WHERE p.ativo=1 GROUP BY p.id, p.nome ORDER BY total DESC LIMIT 5`, [m0]),
      db.all(`SELECT COALESCE(pc.nome,'Sem categoria') AS categoria, COALESCE(pc.cor,'#64748b') AS cor, COALESCE(SUM(ped.valor_final),0) AS total
              FROM pedidos ped JOIN parceiros p ON p.id=ped.parceiro_id LEFT JOIN parc_categorias pc ON pc.id=p.categoria_id
              WHERE ped.parceiro_id IS NOT NULL AND ped.criado_em>=$1 GROUP BY pc.nome, pc.cor ORDER BY total DESC`, [m0]),
      db.get(`SELECT COUNT(*) AS v, COALESCE(SUM(valor_comissao),0) AS total FROM comissoes WHERE tipo='parceiro' AND status='pendente' AND data_geracao<$1`, [d90]),
      db.get(`SELECT COUNT(*) AS v FROM parc_documentos WHERE tipo='contrato' AND data_fim IS NOT NULL AND data_fim BETWEEN $1 AND $2`, [hoje(), d30]),
      db.get(`SELECT COUNT(*) AS v FROM parc_documentos WHERE tipo<>'contrato' AND data_fim IS NOT NULL AND data_fim BETWEEN $1 AND $2`, [hoje(), d30]),
      db.all(`SELECT p.id, p.nome FROM parceiros p WHERE p.ativo=1 AND NOT EXISTS
              (SELECT 1 FROM pedidos ped WHERE ped.parceiro_id=p.id AND ped.criado_em>=$1)`, [d90]),
      db.all(`SELECT p.id, p.nome, MAX(l.criado_em) AS ultima
              FROM parceiros p JOIN leads l ON l.parceiro_id=p.id
              WHERE p.ativo=1 GROUP BY p.id, p.nome HAVING MAX(l.criado_em) < $1`, [d90]),
      db.all(`SELECT p.id, p.nome, COUNT(l.id) AS total, COUNT(l.id) FILTER(WHERE l.etapa IN ('fechado','pedido_confirmado')) AS fechados
              FROM parceiros p JOIN leads l ON l.parceiro_id=p.id
              WHERE p.ativo=1 GROUP BY p.id, p.nome HAVING COUNT(l.id)>=5 AND COUNT(l.id) FILTER(WHERE l.etapa IN ('fechado','pedido_confirmado'))::float/COUNT(l.id) < 0.15`),
    ]);

    // ── Insights IA (regras sobre dados reais) ──
    const insights = [];
    for (const p of top.slice(0, 2)) {
      if (n(p.total) > 0) insights.push({ tipo: 'sucesso', icone: 'trending-up', msg: `${p.nome} gerou ${fmtBRL(p.total)} em vendas este mês — top performer.` });
    }
    for (const p of conversaoBaixa.slice(0, 2)) {
      const taxa = (i(p.fechados) / i(p.total) * 100).toFixed(0);
      insights.push({ tipo: 'alerta', icone: 'trending-down', msg: `${p.nome} tem conversão de apenas ${taxa}% nas indicações.` });
    }
    if (n(comissoesVencidas.total) > 0) {
      insights.push({ tipo: 'info', icone: 'dollar-sign', msg: `Você pagará ${fmtBRL(comissoesVencidas.total)} em comissões pendentes há mais de 90 dias.` });
    }
    for (const p of semIndicar.slice(0, 2)) {
      insights.push({ tipo: 'perigo', icone: 'clock', msg: `${p.nome} está sem indicar clientes há mais de 90 dias.` });
    }
    if (!insights.length) insights.push({ tipo: 'sucesso', icone: 'check-circle', msg: 'Nenhum alerta identificado no período.' });

    // ── Alertas com contador ──
    const alertas = [
      { chave: 'comissoes_vencidas', label: 'Comissões pendentes há +90d', qtd: i(comissoesVencidas.v), cor: '#f87171' },
      { chave: 'contratos_vencendo', label: 'Contratos vencendo (30d)', qtd: i(contratosVencendo.v), cor: '#fbbf24' },
      { chave: 'documentos_vencendo', label: 'Documentos vencendo (30d)', qtd: i(docsVencendo.v), cor: '#60a5fa' },
      { chave: 'sem_vendas', label: 'Sem vendas há 90 dias', qtd: semVendas.length, cor: '#94a3b8' },
      { chave: 'sem_indicar', label: 'Sem indicar há 90 dias', qtd: semIndicar.length, cor: '#fb923c' },
      { chave: 'conversao_baixa', label: 'Conversão baixa (<15%)', qtd: conversaoBaixa.length, cor: '#f87171' },
    ];

    res.json({ top, porCategoria, alertas, insights: insights.slice(0, 6) });
  } catch (err) {
    console.error('[parceiros/dashboard]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   LISTAGEM PRINCIPAL — busca + filtros + colunas calculadas
   ════════════════════════════════════════════════════════════════ */
router.get('/', async (req, res) => {
  try {
    const { busca, categoria_id, status, cidade, estado, comissao_pendente, vip, premium, homologado, ordenar } = req.query;
    const m0 = hoje().slice(0, 8) + '01';
    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;

    if (busca) {
      where += ` AND (p.nome ILIKE $${idx} OR p.empresa ILIKE $${idx} OR p.cpf_cnpj ILIKE $${idx} OR p.cidade ILIKE $${idx} OR p.telefone ILIKE $${idx} OR p.email ILIKE $${idx} OR p.responsavel ILIKE $${idx})`;
      params.push(`%${busca}%`); idx++;
    }
    if (categoria_id) { where += ` AND p.categoria_id=$${idx++}`; params.push(categoria_id); }
    if (status === 'ativo')   where += ' AND p.ativo=1';
    if (status === 'inativo') where += ' AND p.ativo=0';
    if (cidade)  { where += ` AND p.cidade ILIKE $${idx++}`; params.push(`%${cidade}%`); }
    if (estado)  { where += ` AND p.estado=$${idx++}`; params.push(estado); }
    if (vip === '1')         where += ' AND p.vip=true';
    if (premium === '1')     where += ' AND p.premium=true';
    if (homologado === '1')  where += ' AND p.homologado=true';

    const rows = await db.all(`
      SELECT p.*, pc.nome AS categoria_nome, pc.cor AS categoria_cor,
        (SELECT COUNT(*) FROM leads l WHERE l.parceiro_id=p.id) AS indicacoes_total,
        (SELECT COUNT(*) FROM leads l WHERE l.parceiro_id=p.id AND l.etapa IN ('fechado','pedido_confirmado')) AS indicacoes_convertidas,
        (SELECT COUNT(*) FROM pedidos ped WHERE ped.parceiro_id=p.id) AS vendas_total,
        COALESCE((SELECT SUM(ped.valor_final) FROM pedidos ped WHERE ped.parceiro_id=p.id),0) AS valor_gerado,
        COALESCE((SELECT SUM(c.valor_comissao) FROM comissoes c WHERE c.tipo='parceiro' AND c.pessoa_id=p.id AND c.status='pendente'),0) AS comissao_pendente,
        COALESCE((SELECT SUM(c.valor_comissao) FROM comissoes c WHERE c.tipo='parceiro' AND c.pessoa_id=p.id AND c.status='pago'),0) AS comissao_paga,
        (SELECT MAX(ped.criado_em) FROM pedidos ped WHERE ped.parceiro_id=p.id) AS ultima_venda,
        (SELECT AVG((a.nota_qualidade_indicacoes+a.nota_relacionamento+a.nota_comprometimento+a.nota_comunicacao+a.nota_volume_vendas+a.nota_pontualidade)/6.0) FROM parc_avaliacoes a WHERE a.parceiro_id=p.id) AS avaliacao_media
      FROM parceiros p
      LEFT JOIN parc_categorias pc ON pc.id=p.categoria_id
      ${where}
      ORDER BY p.nome ASC
    `, params);

    let lista = rows.map(r => {
      const indTotal = i(r.indicacoes_total), indConv = i(r.indicacoes_convertidas);
      return {
        ...r,
        indicacoes_total: indTotal, indicacoes_convertidas: indConv,
        conversao: indTotal > 0 ? +(indConv / indTotal * 100).toFixed(1) : null,
        vendas_total: i(r.vendas_total), valor_gerado: n(r.valor_gerado),
        comissao_pendente: n(r.comissao_pendente), comissao_paga: n(r.comissao_paga),
        avaliacao_media: r.avaliacao_media ? +n(r.avaliacao_media).toFixed(1) : null,
        status_calc: r.ativo === 0 ? 'inativo' : (n(r.comissao_pendente) > 0 ? 'pendente' : 'ok'),
      };
    });

    if (comissao_pendente === '1') lista = lista.filter(p => p.comissao_pendente > 0);
    if (ordenar === 'faturamento') lista.sort((a, b) => b.valor_gerado - a.valor_gerado);
    if (ordenar === 'indicacoes')  lista.sort((a, b) => b.indicacoes_total - a.indicacoes_total);
    if (ordenar === 'vendas')      lista.sort((a, b) => b.vendas_total - a.vendas_total);

    res.json(lista);
  } catch (err) {
    console.error('[parceiros GET]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   RANKING — Top 10 por diferentes critérios (registrada antes de
   /:id para não ser capturada como se "ranking" fosse um id)
   ════════════════════════════════════════════════════════════════ */
router.get('/ranking', async (req, res) => {
  try {
    const criterio = req.query.criterio || 'vendas';
    const d365 = addDias(-365);
    const rows = await db.all(`
      SELECT p.id, p.nome, p.foto_url,
        COUNT(DISTINCT ped.id) AS vendas, COALESCE(SUM(ped.valor_final),0) AS faturamento,
        (SELECT COUNT(*) FROM leads l WHERE l.parceiro_id=p.id AND l.criado_em>=$1) AS indicacoes,
        (SELECT COUNT(*) FROM leads l WHERE l.parceiro_id=p.id) AS indicacoes_total,
        (SELECT COUNT(*) FROM leads l WHERE l.parceiro_id=p.id AND l.etapa IN ('fechado','pedido_confirmado')) AS convertidas,
        COALESCE((SELECT SUM(c.valor_comissao) FROM comissoes c WHERE c.tipo='parceiro' AND c.pessoa_id=p.id),0) AS comissao_total
      FROM parceiros p
      LEFT JOIN pedidos ped ON ped.parceiro_id=p.id AND ped.criado_em>=$1
      WHERE p.ativo=1
      GROUP BY p.id, p.nome, p.foto_url
    `, [d365]);

    let lista = rows.map(r => ({
      id: r.id, nome: r.nome, foto_url: r.foto_url,
      vendas: i(r.vendas), faturamento: n(r.faturamento),
      indicacoes: i(r.indicacoes), comissao_total: n(r.comissao_total),
      ticketMedio: i(r.vendas) > 0 ? n(r.faturamento) / i(r.vendas) : 0,
      conversao: i(r.indicacoes_total) > 0 ? +(i(r.convertidas) / i(r.indicacoes_total) * 100).toFixed(1) : 0,
    }));

    const ORD = {
      vendas: (a, b) => b.vendas - a.vendas,
      indicacoes: (a, b) => b.indicacoes - a.indicacoes,
      faturamento: (a, b) => b.faturamento - a.faturamento,
      conversao: (a, b) => b.conversao - a.conversao,
      ticket: (a, b) => b.ticketMedio - a.ticketMedio,
      comissao: (a, b) => b.comissao_total - a.comissao_total,
    };
    lista.sort(ORD[criterio] || ORD.vendas);
    res.json(lista.slice(0, 10));
  } catch (err) {
    console.error('[parceiros ranking]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   DRAWER — ficha completa do parceiro
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/resumo', async (req, res) => {
  try {
    const id = req.params.id;
    const [parc, indic, vendas, comissoes, avalStats] = await Promise.all([
      db.get(`SELECT p.*, pc.nome AS categoria_nome, pc.cor AS categoria_cor FROM parceiros p LEFT JOIN parc_categorias pc ON pc.id=p.categoria_id WHERE p.id=$1`, [id]),
      db.get(`SELECT COUNT(*) AS total, COUNT(*) FILTER(WHERE etapa IN ('fechado','pedido_confirmado')) AS convertidas, COUNT(*) FILTER(WHERE etapa='perdido') AS perdidas
              FROM leads WHERE parceiro_id=$1`, [id]),
      db.get(`SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_final),0) AS total, COALESCE(AVG(valor_final),0) AS ticket,
              MAX(valor_final) AS maior, MAX(criado_em) AS ultima
              FROM pedidos WHERE parceiro_id=$1`, [id]),
      db.get(`SELECT COALESCE(SUM(valor_comissao) FILTER(WHERE status='pendente'),0) AS pendente,
              COALESCE(SUM(valor_comissao) FILTER(WHERE status='pago'),0) AS pago,
              MAX(data_pagamento) AS ultimo_pagamento
              FROM comissoes WHERE tipo='parceiro' AND pessoa_id=$1`, [id]),
      db.get(`SELECT AVG(nota_qualidade_indicacoes) AS qualidade_indicacoes, AVG(nota_relacionamento) AS relacionamento,
              AVG(nota_comprometimento) AS comprometimento, AVG(nota_comunicacao) AS comunicacao,
              AVG(nota_volume_vendas) AS volume_vendas, AVG(nota_pontualidade) AS pontualidade, COUNT(*) AS qtd
              FROM parc_avaliacoes WHERE parceiro_id=$1`, [id]),
    ]);
    if (!parc) return res.status(404).json({ erro: 'Parceiro não encontrado' });

    const mediaGeral = avalStats.qtd > 0
      ? (n(avalStats.qualidade_indicacoes) + n(avalStats.relacionamento) + n(avalStats.comprometimento) + n(avalStats.comunicacao) + n(avalStats.volume_vendas) + n(avalStats.pontualidade)) / 6
      : null;

    res.json({
      parceiro: parc,
      indicacoes: {
        total: i(indic.total), convertidas: i(indic.convertidas), perdidas: i(indic.perdidas),
        taxaConversao: i(indic.total) > 0 ? +(i(indic.convertidas) / i(indic.total) * 100).toFixed(1) : null,
      },
      vendas: {
        qtd: i(vendas.qtd), total: n(vendas.total), ticketMedio: n(vendas.ticket),
        maiorVenda: n(vendas.maior), ultimaVenda: vendas.ultima,
      },
      comissoes: { pendente: n(comissoes.pendente), pago: n(comissoes.pago), ultimoPagamento: comissoes.ultimo_pagamento },
      avaliacao: {
        media: mediaGeral ? +mediaGeral.toFixed(1) : null, qtd: i(avalStats.qtd),
        criterios: mediaGeral ? {
          qualidade_indicacoes: +n(avalStats.qualidade_indicacoes).toFixed(1), relacionamento: +n(avalStats.relacionamento).toFixed(1),
          comprometimento: +n(avalStats.comprometimento).toFixed(1), comunicacao: +n(avalStats.comunicacao).toFixed(1),
          volume_vendas: +n(avalStats.volume_vendas).toFixed(1), pontualidade: +n(avalStats.pontualidade).toFixed(1),
        } : null,
      },
    });
  } catch (err) {
    console.error('[parceiros/:id/resumo]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const p = await db.get(`SELECT p.*, pc.nome AS categoria_nome, pc.cor AS categoria_cor FROM parceiros p LEFT JOIN parc_categorias pc ON pc.id=p.categoria_id WHERE p.id=$1`, [req.params.id]);
    if (!p) return res.status(404).json({ erro: 'Parceiro não encontrado' });
    res.json(p);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar parceiro' });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      nome, empresa, tipo, cpf_cnpj, email, telefone, whatsapp, instagram, website, responsavel,
      categoria_id, percentual_comissao, banco, agencia, conta, chave_pix,
      cep, rua, numero, bairro, cidade, estado, observacoes, vip, premium, homologado,
    } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
    const id = await db.insert(`
      INSERT INTO parceiros (nome, empresa, tipo, cpf_cnpj, email, telefone, whatsapp, instagram, website, responsavel,
        categoria_id, percentual_comissao, banco, agencia, conta, chave_pix, cep, rua, numero, bairro, cidade, estado, observacoes, vip, premium, homologado)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
    `, [nome, empresa || null, tipo || 'indicador', cpf_cnpj || null, email || null, telefone || null, whatsapp || null,
        instagram || null, website || null, responsavel || null, categoria_id || null, n(percentual_comissao),
        banco || null, agencia || null, conta || null, chave_pix || null, cep || null, rua || null, numero || null,
        bairro || null, cidade || null, estado || null, observacoes || null, !!vip, !!premium, !!homologado]);
    await registrarHistorico(id, 'criado', `Parceiro cadastrado: ${nome}`);
    res.status(201).json({ id });
  } catch (err) {
    console.error('[parceiros POST]', err.message);
    res.status(500).json({ erro: 'Erro ao criar parceiro' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const {
      nome, empresa, tipo, cpf_cnpj, email, telefone, whatsapp, instagram, website, responsavel,
      categoria_id, percentual_comissao, banco, agencia, conta, chave_pix,
      cep, rua, numero, bairro, cidade, estado, observacoes, vip, premium, homologado,
    } = req.body;
    await db.run(`
      UPDATE parceiros SET nome=$1, empresa=$2, tipo=$3, cpf_cnpj=$4, email=$5, telefone=$6, whatsapp=$7,
        instagram=$8, website=$9, responsavel=$10, categoria_id=$11, percentual_comissao=$12, banco=$13, agencia=$14,
        conta=$15, chave_pix=$16, cep=$17, rua=$18, numero=$19, bairro=$20, cidade=$21, estado=$22, observacoes=$23,
        vip=$24, premium=$25, homologado=$26
      WHERE id=$27
    `, [nome, empresa || null, tipo || 'indicador', cpf_cnpj || null, email || null, telefone || null, whatsapp || null,
        instagram || null, website || null, responsavel || null, categoria_id || null, n(percentual_comissao),
        banco || null, agencia || null, conta || null, chave_pix || null, cep || null, rua || null, numero || null,
        bairro || null, cidade || null, estado || null, observacoes || null, !!vip, !!premium, !!homologado, req.params.id]);
    await registrarHistorico(req.params.id, 'alteracao', 'Dados cadastrais atualizados');
    res.json({ mensagem: 'Parceiro atualizado' });
  } catch (err) {
    console.error('[parceiros PUT]', err.message);
    res.status(500).json({ erro: 'Erro ao atualizar parceiro' });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const { ativo } = req.body;
    if (ativo === undefined) return res.status(400).json({ erro: 'Informe o status (ativo)' });
    await db.run('UPDATE parceiros SET ativo=$1 WHERE id=$2', [ativo ? 1 : 0, req.params.id]);
    await registrarHistorico(req.params.id, 'alteracao', ativo ? 'Parceiro reativado' : 'Parceiro inativado');
    res.json({ mensagem: 'Status atualizado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar status' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const [indic, vendas, docs] = await Promise.all([
      db.get('SELECT COUNT(*) AS q FROM leads WHERE parceiro_id=$1', [req.params.id]),
      db.get('SELECT COUNT(*) AS q FROM pedidos WHERE parceiro_id=$1', [req.params.id]),
      db.get('SELECT COUNT(*) AS q FROM parc_documentos WHERE parceiro_id=$1', [req.params.id]),
    ]);
    if (i(indic.q) > 0 || i(vendas.q) > 0 || i(docs.q) > 0) {
      return res.status(400).json({ erro: 'Este parceiro possui indicações, vendas ou documentos vinculados e não pode ser excluído — inative-o em vez disso.' });
    }
    await db.run('DELETE FROM parc_avaliacoes WHERE parceiro_id=$1', [req.params.id]);
    await db.run('DELETE FROM parc_historico WHERE parceiro_id=$1', [req.params.id]);
    await db.run('DELETE FROM parceiros WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Parceiro excluído' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao excluir parceiro' });
  }
});

router.post('/:id/foto', uploadFoto.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Arquivo é obrigatório' });
    await db.run(`UPDATE parceiros SET foto_url=$1 WHERE id=$2`, [req.file.path, req.params.id]);
    res.json({ foto_url: req.file.path });
  } catch (err) { res.status(500).json({ erro: 'Erro ao enviar foto' }); }
});

/* ════════════════════════════════════════════════════════════════
   INDICAÇÕES — lê direto do CRM (leads), sem duplicar dados
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/indicacoes', async (req, res) => {
  try {
    const leads = await db.all(`
      SELECT l.id, l.nome, l.empresa, l.telefone, l.email, l.etapa, l.valor_estimado, l.motivo_perda, l.criado_em,
        c.nome AS cliente_nome,
        (SELECT ped.id FROM pedidos ped JOIN orcamentos o ON o.id=ped.orcamento_id WHERE o.lead_id=l.id LIMIT 1) AS pedido_id,
        (SELECT ped.valor_final FROM pedidos ped JOIN orcamentos o ON o.id=ped.orcamento_id WHERE o.lead_id=l.id LIMIT 1) AS valor_venda
      FROM leads l
      LEFT JOIN clientes c ON c.id=l.cliente_id
      WHERE l.parceiro_id=$1 ORDER BY l.criado_em DESC LIMIT 200`, [req.params.id]);
    res.json(leads);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

/* ════════════════════════════════════════════════════════════════
   COMISSÕES — geradas automaticamente na conversão orçamento→pedido
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/comissoes', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT c.*, ped.numero AS pedido_numero, o.numero AS orcamento_numero, cli.nome AS cliente_nome
      FROM comissoes c
      LEFT JOIN pedidos ped ON ped.id=c.pedido_id
      LEFT JOIN orcamentos o ON o.id=c.orcamento_id
      LEFT JOIN clientes cli ON cli.id=ped.cliente_id
      WHERE c.tipo='parceiro' AND c.pessoa_id=$1
      ORDER BY c.data_geracao DESC LIMIT 200`, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

/* ════════════════════════════════════════════════════════════════
   VENDAS — pedidos gerados pelo parceiro
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/vendas', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT ped.id, ped.numero, ped.valor_total, ped.valor_final, ped.status, ped.criado_em, cli.nome AS cliente_nome
      FROM pedidos ped LEFT JOIN clientes cli ON cli.id=ped.cliente_id
      WHERE ped.parceiro_id=$1 ORDER BY ped.criado_em DESC LIMIT 200`, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

/* ════════════════════════════════════════════════════════════════
   DOCUMENTOS / CONTRATOS / ANEXOS (unificados por "tipo")
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/documentos', async (req, res) => {
  try {
    res.json(await db.all(`SELECT * FROM parc_documentos WHERE parceiro_id=$1 ORDER BY criado_em DESC`, [req.params.id]));
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.post('/:id/documentos', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Arquivo é obrigatório' });
    const { tipo, nome, data_inicio, data_fim, valor_contrato } = req.body;
    const id = await db.insert(`
      INSERT INTO parc_documentos (parceiro_id, tipo, nome, url, data_inicio, data_fim, valor_contrato, criado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.params.id, tipo || 'anexo', nome || req.file.originalname, req.file.path,
       data_inicio || null, data_fim || null, valor_contrato ? n(valor_contrato) : null, req.usuario?.id || null]);
    await registrarHistorico(req.params.id, 'documento', `${tipo === 'contrato' ? 'Contrato' : 'Documento'} "${nome || req.file.originalname}" enviado`);
    res.status(201).json({ id, url: req.file.path });
  } catch (err) {
    console.error('[parceiros documentos POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.delete('/documentos/:id', async (req, res) => {
  try {
    const doc = await db.get(`SELECT url FROM parc_documentos WHERE id=$1`, [req.params.id]);
    await db.run(`DELETE FROM parc_documentos WHERE id=$1`, [req.params.id]);
    if (doc) deletarArquivo(doc.url).catch(() => {});
    res.json({ mensagem: 'Documento removido' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

/* ════════════════════════════════════════════════════════════════
   AVALIAÇÕES
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/avaliacoes', async (req, res) => {
  try {
    res.json(await db.all(`
      SELECT a.*, u.nome AS usuario_nome FROM parc_avaliacoes a
      LEFT JOIN usuarios u ON u.id=a.criado_por
      WHERE a.parceiro_id=$1 ORDER BY a.criado_em DESC`, [req.params.id]));
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.post('/:id/avaliacoes', async (req, res) => {
  try {
    const { nota_qualidade_indicacoes, nota_relacionamento, nota_comprometimento, nota_comunicacao, nota_volume_vendas, nota_pontualidade, comentario } = req.body;
    const notas = [nota_qualidade_indicacoes, nota_relacionamento, nota_comprometimento, nota_comunicacao, nota_volume_vendas, nota_pontualidade];
    if (notas.some(x => !x || x < 1 || x > 5)) return res.status(400).json({ erro: 'Todas as 6 notas (1 a 5) são obrigatórias' });
    const id = await db.insert(`
      INSERT INTO parc_avaliacoes (parceiro_id, nota_qualidade_indicacoes, nota_relacionamento, nota_comprometimento, nota_comunicacao, nota_volume_vendas, nota_pontualidade, comentario, criado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.params.id, ...notas.map(i), comentario || null, req.usuario?.id || null]);
    const media = (notas.reduce((s, x) => s + i(x), 0) / 6).toFixed(1);
    await registrarHistorico(req.params.id, 'avaliacao', `Nova avaliação registrada — nota média ${media}`);
    res.status(201).json({ id });
  } catch (err) {
    console.error('[parceiros avaliacoes POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   HISTÓRICO — timeline automática
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/historico', async (req, res) => {
  try {
    res.json(await db.all(`SELECT * FROM parc_historico WHERE parceiro_id=$1 ORDER BY criado_em DESC LIMIT 100`, [req.params.id]));
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
      case 'ranking':
        dados = await db.all(`
          SELECT p.nome, COUNT(ped.id) AS vendas, COALESCE(SUM(ped.valor_final),0) AS faturamento,
            (SELECT COUNT(*) FROM leads l WHERE l.parceiro_id=p.id) AS indicacoes
          FROM parceiros p LEFT JOIN pedidos ped ON ped.parceiro_id=p.id AND ped.criado_em BETWEEN $1 AND $2
          WHERE p.ativo=1 GROUP BY p.id, p.nome ORDER BY faturamento DESC`, [dIni, dFim]);
        break;
      case 'comissoes':
        dados = await db.all(`
          SELECT p.nome, c.valor_pedido, c.percentual, c.valor_comissao, c.status, c.data_geracao, c.data_pagamento
          FROM comissoes c JOIN parceiros p ON p.id=c.pessoa_id
          WHERE c.tipo='parceiro' AND c.data_geracao BETWEEN $1 AND $2 ORDER BY c.data_geracao DESC`, [dIni, dFim]);
        break;
      case 'vendas':
        dados = await db.all(`
          SELECT p.nome AS parceiro, ped.numero, cli.nome AS cliente, ped.valor_final, ped.status, ped.criado_em
          FROM pedidos ped JOIN parceiros p ON p.id=ped.parceiro_id LEFT JOIN clientes cli ON cli.id=ped.cliente_id
          WHERE ped.parceiro_id IS NOT NULL AND ped.criado_em BETWEEN $1 AND $2 ORDER BY ped.criado_em DESC`, [dIni, dFim]);
        break;
      case 'conversao':
        dados = await db.all(`
          SELECT p.nome, COUNT(l.id) AS total, COUNT(l.id) FILTER(WHERE l.etapa IN ('fechado','pedido_confirmado')) AS convertidas,
            COUNT(l.id) FILTER(WHERE l.etapa='perdido') AS perdidas
          FROM parceiros p JOIN leads l ON l.parceiro_id=p.id
          WHERE l.criado_em BETWEEN $1 AND $2 GROUP BY p.id, p.nome ORDER BY total DESC`, [dIni, dFim]);
        break;
      case 'parceiros-ativos':
        dados = await db.all(`SELECT nome, empresa, tipo, cidade, estado, criado_em FROM parceiros WHERE ativo=1 ORDER BY nome`);
        break;
      case 'parceiros-inativos':
        dados = await db.all(`SELECT nome, empresa, tipo, cidade, estado, criado_em FROM parceiros WHERE ativo=0 ORDER BY nome`);
        break;
      case 'indicacoes':
        dados = await db.all(`
          SELECT p.nome AS parceiro, l.nome AS lead, l.etapa, l.valor_estimado, l.criado_em
          FROM leads l JOIN parceiros p ON p.id=l.parceiro_id
          WHERE l.criado_em BETWEEN $1 AND $2 ORDER BY l.criado_em DESC`, [dIni, dFim]);
        break;
      case 'faturamento':
        dados = await db.all(`
          SELECT p.nome, TO_CHAR(ped.criado_em,'YYYY-MM') AS mes, COALESCE(SUM(ped.valor_final),0) AS total
          FROM pedidos ped JOIN parceiros p ON p.id=ped.parceiro_id
          WHERE ped.parceiro_id IS NOT NULL AND ped.criado_em BETWEEN $1 AND $2
          GROUP BY p.nome, mes ORDER BY mes DESC, total DESC`, [dIni, dFim]);
        break;
      default:
        return res.status(400).json({ erro: 'Tipo de relatório inválido' });
    }
    res.json({ tipo, periodo: { inicio: dIni, fim: dFim }, dados });
  } catch (err) {
    console.error('[parceiros relatorios]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
