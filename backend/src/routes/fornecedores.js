/* ════════════════════════════════════════════════════════════════
   FORNECEDORES — Central de Relacionamento com Fornecedores
   Cadastro + produtos + compras + financeiro + documentos + contratos
   + avaliações + histórico + dashboard + relatórios, tudo integrado
   aos lançamentos financeiros já existentes no ERP (sem duplicar
   dados: uma compra gera lançamentos de despesa reais).
   ════════════════════════════════════════════════════════════════ */
const express = require('express');
const crypto = require('crypto');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');
const { criarUpload, deletarArquivo } = require('../utils/cloudinary');

const router = express.Router();
router.use(autenticar);

const upload = criarUpload({ folder: 'fornecedores/documentos', allowedFormats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'], resourceType: 'auto' });
const uploadLogo = criarUpload({ folder: 'fornecedores/logos', allowedFormats: ['jpg', 'jpeg', 'png', 'webp'], resourceType: 'image' });

const n = v => parseFloat(v) || 0;
const i = v => parseInt(v) || 0;
const pct = (a, b) => b > 0 ? +((a - b) / b * 100).toFixed(1) : null;
const hoje = () => new Date().toISOString().split('T')[0];
const addDias = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().split('T')[0]; };
const fmtBRL = v => 'R$ ' + n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function registrarHistorico(fornecedorId, tipo, descricao) {
  await db.run(`INSERT INTO forn_historico (fornecedor_id, tipo, descricao) VALUES ($1,$2,$3)`, [fornecedorId, tipo, descricao]);
}

/* ════════════════════════════════════════════════════════════════
   CATEGORIAS
   ════════════════════════════════════════════════════════════════ */
router.get('/categorias', async (req, res) => {
  try {
    res.json(await db.all(`SELECT * FROM forn_categorias WHERE ativo=true ORDER BY nome`));
  } catch (err) { res.status(500).json({ erro: 'Erro ao listar categorias' }); }
});

router.post('/categorias', async (req, res) => {
  try {
    const { nome, cor } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
    const id = await db.insert(`INSERT INTO forn_categorias (nome, cor) VALUES ($1,$2) ON CONFLICT (nome) DO NOTHING`, [nome, cor || '#818cf8']);
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
      totais, comprasAtual, comprasAnt, financeiro, avalRow, prazoRow, atrasadosRow,
      comprasSpark, avalSpark, economiaItens,
    ] = await Promise.all([
      db.get(`SELECT COUNT(*) AS total, COUNT(*) FILTER(WHERE ativo=1) AS ativos, COUNT(*) FILTER(WHERE ativo=0) AS inativos FROM fornecedores`),
      db.get(`SELECT COALESCE(SUM(valor_total),0) AS v, COUNT(*) AS q FROM forn_compras WHERE data_pedido>=$1`, [m0]),
      db.get(`SELECT COALESCE(SUM(valor_total),0) AS v FROM forn_compras WHERE data_pedido>=$1 AND data_pedido<$2`, [m1, m1fim]),
      db.get(`SELECT
        COALESCE(SUM(valor) FILTER(WHERE status IN('pendente','atrasado')),0) AS aberto,
        COALESCE(SUM(valor) FILTER(WHERE status='pago' AND data_pagamento>=$1),0) AS pago
        FROM lancamentos WHERE tipo='despesa' AND fornecedor_id IS NOT NULL AND status<>'cancelado'`, [m0]),
      db.get(`SELECT AVG((nota_preco+nota_qualidade+nota_prazo+nota_atendimento+nota_pontualidade+nota_confiabilidade)/6.0) AS media FROM forn_avaliacoes`),
      db.get(`SELECT AVG(data_entrega_real::date - data_pedido::date) AS media FROM forn_compras WHERE status='entregue' AND data_entrega_real IS NOT NULL AND data_pedido>=$1`, [sparkIni]),
      db.get(`SELECT COUNT(*) AS v FROM forn_compras WHERE status NOT IN('entregue','cancelado') AND data_entrega_prevista IS NOT NULL AND data_entrega_prevista<$1`, [hoje()]),
      db.all(`SELECT TO_CHAR(data_pedido,'YYYY-MM') AS m, COALESCE(SUM(valor_total),0) AS v FROM forn_compras WHERE data_pedido>=$1 GROUP BY 1`, [sparkIni]),
      db.all(`SELECT TO_CHAR(criado_em,'YYYY-MM') AS m, AVG((nota_preco+nota_qualidade+nota_prazo+nota_atendimento+nota_pontualidade+nota_confiabilidade)/6.0) AS v FROM forn_avaliacoes WHERE criado_em>=$1 GROUP BY 1`, [sparkIni]),
      db.all(`SELECT itens FROM forn_compras WHERE data_pedido>=$1`, [m0]),
    ]);

    // Economia: soma, para cada item comprado este mês, a diferença entre o
    // preço anterior do produto e o preço praticado na compra (quando houve
    // queda de preço) — reflete negociações que baixaram custo real.
    let economia = 0;
    for (const row of economiaItens) {
      const itens = Array.isArray(row.itens) ? row.itens : (row.itens ? JSON.parse(row.itens) : []);
      for (const it of itens) {
        const qtd = n(it.qtd), preco = n(it.preco_unit), precoAnt = n(it.preco_anterior);
        if (precoAnt > preco && qtd > 0) economia += (precoAnt - preco) * qtd;
      }
    }

    const mapBy = rows => Object.fromEntries((rows || []).map(r => [r.m, r]));
    const cm = mapBy(comprasSpark), am = mapBy(avalSpark);
    const comprasSparkArr = meses.map(k => n(cm[k]?.v));
    const avalSparkArr = meses.map(k => +n(am[k]?.v).toFixed(2));

    res.json({
      totalFornecedores: { valor: i(totais.total), sparkline: null },
      ativos: { valor: i(totais.ativos) },
      inativos: { valor: i(totais.inativos) },
      comprasMes: { valor: n(comprasAtual.v), qtd: i(comprasAtual.q), variacao: pct(n(comprasAtual.v), n(comprasAnt.v)), sparkline: comprasSparkArr },
      valorAberto: { valor: n(financeiro.aberto) },
      valorPago: { valor: n(financeiro.pago) },
      economiaMes: { valor: +economia.toFixed(2) },
      avaliacaoMedia: { valor: avalRow.media ? +n(avalRow.media).toFixed(1) : null, sparkline: avalSparkArr },
      prazoMedioEntrega: { valor: prazoRow.media ? Math.round(n(prazoRow.media)) : null },
      pedidosAtrasados: { valor: i(atrasadosRow.v) },
    });
  } catch (err) {
    console.error('[fornecedores/kpis]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   DASHBOARD LATERAL — Top fornecedores, compras por categoria, alertas, IA
   ════════════════════════════════════════════════════════════════ */
router.get('/dashboard', async (req, res) => {
  try {
    const m0 = hoje().slice(0, 8) + '01';
    const d180 = addDias(-180);
    const d30 = addDias(30);

    const [top, porCategoria, docsVencendo, contratosVencendo, pagtosVencidos, pedidosAtrasados, semCompra, atrasoRecorrente, precosSubindo] = await Promise.all([
      db.all(`SELECT f.id, f.nome, COALESCE(SUM(c.valor_total),0) AS total, COUNT(c.id) AS qtd
              FROM fornecedores f LEFT JOIN forn_compras c ON c.fornecedor_id=f.id AND c.data_pedido>=$1
              WHERE f.ativo=1 GROUP BY f.id, f.nome ORDER BY total DESC LIMIT 5`, [m0]),
      db.all(`SELECT COALESCE(fc.nome,'Sem categoria') AS categoria, COALESCE(fc.cor,'#64748b') AS cor, COALESCE(SUM(c.valor_total),0) AS total
              FROM forn_compras c JOIN fornecedores f ON f.id=c.fornecedor_id LEFT JOIN forn_categorias fc ON fc.id=f.categoria_id
              WHERE c.data_pedido>=$1 GROUP BY fc.nome, fc.cor ORDER BY total DESC`, [m0]),
      db.get(`SELECT COUNT(*) AS v FROM forn_documentos WHERE tipo<>'contrato' AND data_fim IS NOT NULL AND data_fim BETWEEN $1 AND $2`, [hoje(), d30]),
      db.get(`SELECT COUNT(*) AS v FROM forn_documentos WHERE tipo='contrato' AND data_fim IS NOT NULL AND data_fim BETWEEN $1 AND $2`, [hoje(), d30]),
      db.get(`SELECT COUNT(*) AS v, COALESCE(SUM(valor),0) AS total FROM lancamentos WHERE tipo='despesa' AND fornecedor_id IS NOT NULL AND status IN('pendente','atrasado') AND data_vencimento<$1`, [hoje()]),
      db.get(`SELECT COUNT(*) AS v FROM forn_compras WHERE status NOT IN('entregue','cancelado') AND data_entrega_prevista IS NOT NULL AND data_entrega_prevista<$1`, [hoje()]),
      db.all(`SELECT f.id, f.nome FROM fornecedores f WHERE f.ativo=1 AND NOT EXISTS
              (SELECT 1 FROM forn_compras c WHERE c.fornecedor_id=f.id AND c.data_pedido>=$1)`, [d180]),
      db.all(`SELECT f.nome, COUNT(*) AS qtd_atraso
              FROM forn_compras c JOIN fornecedores f ON f.id=c.fornecedor_id
              WHERE c.data_entrega_real IS NOT NULL AND c.data_entrega_prevista IS NOT NULL AND c.data_entrega_real::date > c.data_entrega_prevista::date
              GROUP BY f.nome HAVING COUNT(*) >= 2 ORDER BY qtd_atraso DESC LIMIT 3`),
      db.all(`SELECT f.nome, p.nome AS produto, p.preco_anterior, p.preco_atual
              FROM forn_produtos p JOIN fornecedores f ON f.id=p.fornecedor_id
              WHERE p.preco_anterior IS NOT NULL AND p.preco_anterior > 0 AND p.preco_atual > p.preco_anterior * 1.05
              ORDER BY (p.preco_atual - p.preco_anterior) / p.preco_anterior DESC LIMIT 3`),
    ]);

    // ── Insights IA (regras sobre dados reais) ──
    const insights = [];
    for (const p of precosSubindo) {
      const variacao = ((n(p.preco_atual) - n(p.preco_anterior)) / n(p.preco_anterior) * 100).toFixed(0);
      insights.push({ tipo: 'alerta', icone: 'trending-up', msg: `${p.nome} aumentou o preço de "${p.produto}" em ${variacao}%.` });
    }
    for (const f of atrasoRecorrente) {
      insights.push({ tipo: 'perigo', icone: 'clock', msg: `${f.nome} possui ${f.qtd_atraso} entregas atrasadas — maior índice de atraso do período.` });
    }
    // Fornecedor mais barato por produto (quando há 2+ fornecedores para o "mesmo" produto por nome)
    const maisBaratos = await db.all(`
      SELECT nome, COUNT(DISTINCT fornecedor_id) AS qtd_forn, MIN(preco_atual) AS menor, MAX(preco_atual) AS maior
      FROM forn_produtos WHERE ativo=true AND preco_atual > 0
      GROUP BY LOWER(nome) , nome HAVING COUNT(DISTINCT fornecedor_id) > 1 AND MAX(preco_atual) > MIN(preco_atual) * 1.1
      LIMIT 2`);
    for (const p of maisBaratos) {
      insights.push({ tipo: 'info', icone: 'lightbulb', msg: `Existe um fornecedor até ${(((n(p.maior) - n(p.menor)) / n(p.maior)) * 100).toFixed(0)}% mais barato para "${p.nome}".` });
    }
    if (!insights.length) insights.push({ tipo: 'sucesso', icone: 'check-circle', msg: 'Nenhum alerta de preço ou atraso identificado no período.' });

    // ── Alertas com contador ──
    const alertas = [
      { chave: 'contas_vencidas', label: 'Contas vencidas', qtd: i(pagtosVencidos.v), cor: '#f87171' },
      { chave: 'pedidos_atrasados', label: 'Pedidos atrasados', qtd: i(pedidosAtrasados.v), cor: '#fb923c' },
      { chave: 'contratos_vencendo', label: 'Contratos vencendo (30d)', qtd: i(contratosVencendo.v), cor: '#fbbf24' },
      { chave: 'documentos_vencendo', label: 'Documentos vencendo (30d)', qtd: i(docsVencendo.v), cor: '#60a5fa' },
      { chave: 'sem_compra', label: 'Sem compra há 180 dias', qtd: semCompra.length, cor: '#94a3b8' },
    ];

    res.json({ top, porCategoria, alertas, insights: insights.slice(0, 6) });
  } catch (err) {
    console.error('[fornecedores/dashboard]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   LISTAGEM PRINCIPAL — busca + filtros + colunas calculadas
   ════════════════════════════════════════════════════════════════ */
router.get('/', async (req, res) => {
  try {
    const { busca, categoria_id, status, cidade, estado, homologado, favorito, pendentes, tipo, avaliacao_min } = req.query;
    const m0 = hoje().slice(0, 8) + '01';
    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;

    if (busca) {
      where += ` AND (f.nome ILIKE $${idx} OR f.cnpj ILIKE $${idx} OR f.cidade ILIKE $${idx} OR f.estado ILIKE $${idx} OR f.responsavel ILIKE $${idx} OR f.telefone ILIKE $${idx} OR f.email ILIKE $${idx} OR EXISTS(SELECT 1 FROM forn_produtos fp WHERE fp.fornecedor_id=f.id AND fp.nome ILIKE $${idx}))`;
      params.push(`%${busca}%`); idx++;
    }
    if (categoria_id) { where += ` AND f.categoria_id=$${idx++}`; params.push(categoria_id); }
    if (status === 'ativo')   where += ' AND f.ativo=1';
    if (status === 'inativo') where += ' AND f.ativo=0';
    if (cidade)  { where += ` AND f.cidade ILIKE $${idx++}`; params.push(`%${cidade}%`); }
    if (estado)  { where += ` AND f.estado=$${idx++}`; params.push(estado); }
    if (homologado === '1') where += ' AND f.homologado=true';
    if (favorito === '1')   where += ' AND f.favorito=true';
    if (tipo) { where += ` AND f.tipo=$${idx++}`; params.push(tipo); }

    const rows = await db.all(`
      SELECT f.*, fc.nome AS categoria_nome, fc.cor AS categoria_cor,
        COALESCE((SELECT SUM(c.valor_total) FROM forn_compras c WHERE c.fornecedor_id=f.id AND c.data_pedido>=$${idx}),0) AS compras_mes,
        COALESCE((SELECT SUM(l.valor) FROM lancamentos l WHERE l.fornecedor_id=f.id AND l.tipo='despesa' AND l.status IN('pendente','atrasado')),0) AS valor_aberto,
        (SELECT MAX(c.data_pedido) FROM forn_compras c WHERE c.fornecedor_id=f.id) AS ultima_compra,
        (SELECT AVG(c.data_entrega_real::date - c.data_pedido::date) FROM forn_compras c WHERE c.fornecedor_id=f.id AND c.status='entregue' AND c.data_entrega_real IS NOT NULL) AS prazo_medio,
        (SELECT AVG((a.nota_preco+a.nota_qualidade+a.nota_prazo+a.nota_atendimento+a.nota_pontualidade+a.nota_confiabilidade)/6.0) FROM forn_avaliacoes a WHERE a.fornecedor_id=f.id) AS avaliacao_media,
        (SELECT COUNT(*) FROM forn_compras c WHERE c.fornecedor_id=f.id AND c.status NOT IN('entregue','cancelado') AND c.data_entrega_prevista IS NOT NULL AND c.data_entrega_prevista<$${idx+1}) AS pedidos_atrasados,
        EXISTS(SELECT 1 FROM forn_documentos d WHERE d.fornecedor_id=f.id AND d.tipo='contrato') AS tem_contrato,
        EXISTS(SELECT 1 FROM lancamentos l WHERE l.fornecedor_id=f.id AND l.tipo='despesa' AND l.status IN('pendente','atrasado')) AS tem_pendencia
      FROM fornecedores f
      LEFT JOIN forn_categorias fc ON fc.id=f.categoria_id
      ${where}
      ORDER BY f.nome ASC
    `, [...params, m0, hoje()]);

    let lista = rows.map(r => ({
      ...r,
      compras_mes: n(r.compras_mes), valor_aberto: n(r.valor_aberto),
      prazo_medio: r.prazo_medio ? Math.round(n(r.prazo_medio)) : null,
      avaliacao_media: r.avaliacao_media ? +n(r.avaliacao_media).toFixed(1) : null,
      pedidos_atrasados: i(r.pedidos_atrasados),
      status_calc: r.ativo === 0 ? 'inativo' : (i(r.pedidos_atrasados) > 0 ? 'atrasado' : (n(r.valor_aberto) > 0 ? 'pendente' : 'ok')),
    }));

    if (pendentes === '1') lista = lista.filter(f => f.valor_aberto > 0);
    if (avaliacao_min) lista = lista.filter(f => (f.avaliacao_media || 0) >= n(avaliacao_min));

    res.json(lista);
  } catch (err) {
    console.error('[fornecedores GET]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   DRAWER — ficha completa do fornecedor
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/resumo', async (req, res) => {
  try {
    const id = req.params.id;
    const [forn, comprasStats, financeiro, avalStats] = await Promise.all([
      db.get(`SELECT f.*, fc.nome AS categoria_nome, fc.cor AS categoria_cor FROM fornecedores f LEFT JOIN forn_categorias fc ON fc.id=f.categoria_id WHERE f.id=$1`, [id]),
      db.get(`SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_total),0) AS total, COALESCE(AVG(valor_total),0) AS ticket,
              MAX(valor_total) AS maior, MAX(data_pedido) AS ultima,
              COUNT(*) FILTER(WHERE status='aberto') AS abertos,
              COUNT(*) FILTER(WHERE status='entregue') AS entregues,
              COUNT(*) FILTER(WHERE status='cancelado') AS cancelados,
              AVG(data_entrega_real::date - data_pedido::date) FILTER(WHERE status='entregue' AND data_entrega_real IS NOT NULL) AS prazo_medio
              FROM forn_compras WHERE fornecedor_id=$1`, [id]),
      db.get(`SELECT COALESCE(SUM(valor) FILTER(WHERE status IN('pendente','atrasado')),0) AS aberto,
              COALESCE(SUM(valor) FILTER(WHERE status='pago'),0) AS pago
              FROM lancamentos WHERE fornecedor_id=$1 AND tipo='despesa' AND status<>'cancelado'`, [id]),
      db.get(`SELECT AVG(nota_preco) AS preco, AVG(nota_qualidade) AS qualidade, AVG(nota_prazo) AS prazo,
              AVG(nota_atendimento) AS atendimento, AVG(nota_pontualidade) AS pontualidade, AVG(nota_confiabilidade) AS confiabilidade,
              COUNT(*) AS qtd
              FROM forn_avaliacoes WHERE fornecedor_id=$1`, [id]),
    ]);
    if (!forn) return res.status(404).json({ erro: 'Fornecedor não encontrado' });

    const mediaGeral = avalStats.qtd > 0
      ? (n(avalStats.preco) + n(avalStats.qualidade) + n(avalStats.prazo) + n(avalStats.atendimento) + n(avalStats.pontualidade) + n(avalStats.confiabilidade)) / 6
      : null;

    res.json({
      fornecedor: forn,
      compras: {
        qtd: i(comprasStats.qtd), total: n(comprasStats.total), ticketMedio: n(comprasStats.ticket),
        maiorCompra: n(comprasStats.maior), ultimaCompra: comprasStats.ultima,
        abertos: i(comprasStats.abertos), entregues: i(comprasStats.entregues), cancelados: i(comprasStats.cancelados),
        prazoMedio: comprasStats.prazo_medio ? Math.round(n(comprasStats.prazo_medio)) : null,
      },
      financeiro: { aberto: n(financeiro.aberto), pago: n(financeiro.pago) },
      avaliacao: {
        media: mediaGeral ? +mediaGeral.toFixed(1) : null, qtd: i(avalStats.qtd),
        criterios: mediaGeral ? {
          preco: +n(avalStats.preco).toFixed(1), qualidade: +n(avalStats.qualidade).toFixed(1),
          prazo: +n(avalStats.prazo).toFixed(1), atendimento: +n(avalStats.atendimento).toFixed(1),
          pontualidade: +n(avalStats.pontualidade).toFixed(1), confiabilidade: +n(avalStats.confiabilidade).toFixed(1),
        } : null,
      },
    });
  } catch (err) {
    console.error('[fornecedores/:id/resumo]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const f = await db.get(`SELECT f.*, fc.nome AS categoria_nome, fc.cor AS categoria_cor FROM fornecedores f LEFT JOIN forn_categorias fc ON fc.id=f.categoria_id WHERE f.id=$1`, [req.params.id]);
    if (!f) return res.status(404).json({ erro: 'Fornecedor não encontrado' });
    res.json(f);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar fornecedor' });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      nome, razao_social, nome_fantasia, cnpj, ie, email, telefone, whatsapp, website, responsavel,
      categoria_id, tipo, prazo_pagamento, banco, agencia, conta, chave_pix,
      cep, rua, numero, bairro, cidade, estado, observacoes, favorito, homologado,
    } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
    const id = await db.insert(`
      INSERT INTO fornecedores (nome, razao_social, nome_fantasia, cnpj, ie, email, telefone, whatsapp, website, responsavel,
        categoria_id, tipo, prazo_pagamento, banco, agencia, conta, chave_pix, cep, rua, numero, bairro, cidade, estado, observacoes, favorito, homologado)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
    `, [nome, razao_social || null, nome_fantasia || null, cnpj || null, ie || null, email || null, telefone || null, whatsapp || null,
        website || null, responsavel || null, categoria_id || null, tipo || 'materiais', parseInt(prazo_pagamento) || 30,
        banco || null, agencia || null, conta || null, chave_pix || null, cep || null, rua || null, numero || null,
        bairro || null, cidade || null, estado || null, observacoes || null, !!favorito, !!homologado]);
    await registrarHistorico(id, 'criado', `Fornecedor cadastrado: ${nome}`);
    res.status(201).json({ id });
  } catch (err) {
    console.error('[fornecedores POST]', err.message);
    res.status(500).json({ erro: 'Erro ao criar fornecedor' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const {
      nome, razao_social, nome_fantasia, cnpj, ie, email, telefone, whatsapp, website, responsavel,
      categoria_id, tipo, prazo_pagamento, banco, agencia, conta, chave_pix,
      cep, rua, numero, bairro, cidade, estado, observacoes, favorito, homologado,
    } = req.body;
    await db.run(`
      UPDATE fornecedores SET nome=$1, razao_social=$2, nome_fantasia=$3, cnpj=$4, ie=$5, email=$6, telefone=$7, whatsapp=$8,
        website=$9, responsavel=$10, categoria_id=$11, tipo=$12, prazo_pagamento=$13, banco=$14, agencia=$15, conta=$16,
        chave_pix=$17, cep=$18, rua=$19, numero=$20, bairro=$21, cidade=$22, estado=$23, observacoes=$24, favorito=$25, homologado=$26
      WHERE id=$27
    `, [nome, razao_social || null, nome_fantasia || null, cnpj || null, ie || null, email || null, telefone || null, whatsapp || null,
        website || null, responsavel || null, categoria_id || null, tipo || 'materiais', parseInt(prazo_pagamento) || 30,
        banco || null, agencia || null, conta || null, chave_pix || null, cep || null, rua || null, numero || null,
        bairro || null, cidade || null, estado || null, observacoes || null, !!favorito, !!homologado, req.params.id]);
    await registrarHistorico(req.params.id, 'alteracao', 'Dados cadastrais atualizados');
    res.json({ mensagem: 'Fornecedor atualizado' });
  } catch (err) {
    console.error('[fornecedores PUT]', err.message);
    res.status(500).json({ erro: 'Erro ao atualizar fornecedor' });
  }
});

router.patch('/:id/favorito', async (req, res) => {
  try {
    await db.run(`UPDATE fornecedores SET favorito=NOT favorito WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.run('UPDATE fornecedores SET ativo=0 WHERE id=$1', [req.params.id]);
    await registrarHistorico(req.params.id, 'alteracao', 'Fornecedor inativado');
    res.json({ mensagem: 'Fornecedor removido' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover fornecedor' });
  }
});

router.post('/:id/logo', uploadLogo.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Arquivo é obrigatório' });
    await db.run(`UPDATE fornecedores SET logo_url=$1 WHERE id=$2`, [req.file.path, req.params.id]);
    res.json({ logo_url: req.file.path });
  } catch (err) { res.status(500).json({ erro: 'Erro ao enviar logo' }); }
});

/* ════════════════════════════════════════════════════════════════
   PRODUTOS FORNECIDOS
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/produtos', async (req, res) => {
  try {
    res.json(await db.all(`SELECT * FROM forn_produtos WHERE fornecedor_id=$1 AND ativo=true ORDER BY nome`, [req.params.id]));
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.post('/:id/produtos', async (req, res) => {
  try {
    const { nome, unidade, preco_atual, prazo_entrega_dias, principal } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome do produto é obrigatório' });
    if (principal) await db.run(`UPDATE forn_produtos SET principal=false WHERE fornecedor_id=$1`, [req.params.id]);
    const id = await db.insert(`
      INSERT INTO forn_produtos (fornecedor_id, nome, unidade, preco_atual, prazo_entrega_dias, principal)
      VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.params.id, nome, unidade || 'un', n(preco_atual), i(prazo_entrega_dias) || null, !!principal]);
    res.status(201).json({ id });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.put('/produtos/:id', async (req, res) => {
  try {
    const { nome, unidade, preco_atual, prazo_entrega_dias, principal } = req.body;
    const atual = await db.get(`SELECT * FROM forn_produtos WHERE id=$1`, [req.params.id]);
    if (!atual) return res.status(404).json({ erro: 'Produto não encontrado' });
    const novoPreco = n(preco_atual);
    const precoMudou = novoPreco !== n(atual.preco_atual);
    if (principal) await db.run(`UPDATE forn_produtos SET principal=false WHERE fornecedor_id=$1`, [atual.fornecedor_id]);
    await db.run(`
      UPDATE forn_produtos SET nome=$1, unidade=$2,
        preco_anterior=CASE WHEN $3 THEN preco_atual ELSE preco_anterior END,
        preco_atual=$4, prazo_entrega_dias=$5, principal=$6, atualizado_em=NOW()
      WHERE id=$7`,
      [nome, unidade || 'un', precoMudou, novoPreco, i(prazo_entrega_dias) || null, !!principal, req.params.id]);
    res.json({ mensagem: 'Produto atualizado' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.delete('/produtos/:id', async (req, res) => {
  try {
    await db.run(`UPDATE forn_produtos SET ativo=false WHERE id=$1`, [req.params.id]);
    res.json({ mensagem: 'Produto removido' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

/* ════════════════════════════════════════════════════════════════
   COMPRAS — gera lançamentos financeiros reais (parcelas)
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/compras', async (req, res) => {
  try {
    res.json(await db.all(`SELECT * FROM forn_compras WHERE fornecedor_id=$1 ORDER BY data_pedido DESC LIMIT 100`, [req.params.id]));
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.post('/:id/compras', async (req, res) => {
  try {
    const fornecedorId = req.params.id;
    const { itens, data_pedido, data_entrega_prevista, forma_pagamento, num_parcelas, categoria_id, conta_id, observacoes } = req.body;
    if (!Array.isArray(itens) || !itens.length) return res.status(400).json({ erro: 'Informe ao menos um item' });

    const forn = await db.get(`SELECT nome FROM fornecedores WHERE id=$1`, [fornecedorId]);
    if (!forn) return res.status(404).json({ erro: 'Fornecedor não encontrado' });

    // Anexa o preço anterior de cada produto (para cálculo de economia) e
    // atualiza o catálogo de produtos do fornecedor.
    const itensProcessados = [];
    for (const it of itens) {
      const qtd = n(it.qtd), precoUnit = n(it.preco_unit);
      let precoAnterior = null;
      if (it.produto_id) {
        const prod = await db.get(`SELECT preco_atual FROM forn_produtos WHERE id=$1`, [it.produto_id]);
        precoAnterior = prod ? n(prod.preco_atual) : null;
        await db.run(`UPDATE forn_produtos SET preco_anterior=preco_atual, preco_atual=$1, atualizado_em=NOW() WHERE id=$2`, [precoUnit, it.produto_id]);
      }
      itensProcessados.push({ produto_id: it.produto_id || null, nome: it.nome, qtd, preco_unit: precoUnit, preco_anterior: precoAnterior });
    }
    const valorTotal = itensProcessados.reduce((s, it) => s + it.qtd * it.preco_unit, 0);
    const numero = `COMP-${Date.now().toString().slice(-8)}`;
    const dataPed = data_pedido || hoje();
    const nParcelas = i(num_parcelas) || 1;
    const grupoId = crypto.randomUUID();

    const compraId = await db.insert(`
      INSERT INTO forn_compras (fornecedor_id, numero, data_pedido, data_entrega_prevista, valor_total, itens, forma_pagamento, num_parcelas, grupo_parcela_id, observacoes, criado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [fornecedorId, numero, dataPed, data_entrega_prevista || null, valorTotal, JSON.stringify(itensProcessados),
       forma_pagamento || null, nParcelas, grupoId, observacoes || null, req.usuario?.id || null]);

    // Gera lançamentos de despesa reais (parcelas), integrando ao Financeiro/Contas a Pagar
    const valorParcela = +(valorTotal / nParcelas).toFixed(2);
    for (let p = 0; p < nParcelas; p++) {
      const venc = new Date(dataPed); venc.setMonth(venc.getMonth() + p);
      const vencStr = venc.toISOString().split('T')[0];
      const desc = nParcelas > 1 ? `${forn.nome} — Compra ${numero} (${p + 1}/${nParcelas})` : `${forn.nome} — Compra ${numero}`;
      await db.run(`
        INSERT INTO lancamentos (tipo, descricao, valor, data_vencimento, status, forma_pagamento, conta_id, categoria_id,
          fornecedor_id, origem, parcela_num, parcela_total, grupo_parcela_id)
        VALUES ('despesa',$1,$2,$3,'pendente',$4,$5,$6,$7,'compra_fornecedor',$8,$9,$10)`,
        [desc, valorParcela, vencStr, forma_pagamento || null, conta_id || null, categoria_id || null,
         fornecedorId, p + 1, nParcelas, grupoId]);
    }

    await registrarHistorico(fornecedorId, 'compra', `Compra ${numero} registrada — ${fmtBRL(valorTotal)} (${itensProcessados.length} item(ns))`);
    res.status(201).json({ id: compraId, numero });
  } catch (err) {
    console.error('[fornecedores compras POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.patch('/compras/:id', async (req, res) => {
  try {
    const { status, data_entrega_real } = req.body;
    const compra = await db.get(`SELECT * FROM forn_compras WHERE id=$1`, [req.params.id]);
    if (!compra) return res.status(404).json({ erro: 'Compra não encontrada' });
    await db.run(`UPDATE forn_compras SET status=COALESCE($1,status), data_entrega_real=COALESCE($2,data_entrega_real) WHERE id=$3`,
      [status || null, data_entrega_real || null, req.params.id]);
    if (status === 'entregue') await registrarHistorico(compra.fornecedor_id, 'compra', `Compra ${compra.numero} marcada como entregue`);
    if (status === 'cancelado') await registrarHistorico(compra.fornecedor_id, 'compra', `Compra ${compra.numero} cancelada`);
    res.json({ mensagem: 'Compra atualizada' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// Uma compra só pode ter os itens/valores editados ou ser excluída enquanto
// nenhuma parcela dela já tiver sido paga — isso evita corromper o histórico
// financeiro (Contas a Pagar/Conta Corrente já refletiram o pagamento real).
async function verificarParcelasPagas(grupoId) {
  if (!grupoId) return false;
  const r = await db.get(`SELECT COUNT(*) AS q FROM lancamentos WHERE grupo_parcela_id=$1 AND status='pago'`, [grupoId]);
  return i(r.q) > 0;
}

router.put('/compras/:id', async (req, res) => {
  try {
    const compra = await db.get(`SELECT * FROM forn_compras WHERE id=$1`, [req.params.id]);
    if (!compra) return res.status(404).json({ erro: 'Compra não encontrada' });
    if (await verificarParcelasPagas(compra.grupo_parcela_id)) {
      return res.status(400).json({ erro: 'Não é possível editar uma compra com parcelas já pagas' });
    }
    const { itens, data_entrega_prevista, forma_pagamento, num_parcelas, categoria_id, conta_id, observacoes } = req.body;
    if (!Array.isArray(itens) || !itens.length) return res.status(400).json({ erro: 'Informe ao menos um item' });

    const forn = await db.get(`SELECT nome FROM fornecedores WHERE id=$1`, [compra.fornecedor_id]);

    const itensProcessados = [];
    for (const it of itens) {
      const qtd = n(it.qtd), precoUnit = n(it.preco_unit);
      let precoAnterior = it.preco_anterior ?? null;
      if (it.produto_id && precoAnterior === null) {
        const prod = await db.get(`SELECT preco_atual FROM forn_produtos WHERE id=$1`, [it.produto_id]);
        precoAnterior = prod ? n(prod.preco_atual) : null;
      }
      itensProcessados.push({ produto_id: it.produto_id || null, nome: it.nome, qtd, preco_unit: precoUnit, preco_anterior: precoAnterior });
    }
    const valorTotal = itensProcessados.reduce((s, it) => s + it.qtd * it.preco_unit, 0);
    const nParcelas = i(num_parcelas) || 1;

    // Regenera as parcelas do zero (nenhuma estava paga — já validado acima)
    await db.run(`DELETE FROM lancamentos WHERE grupo_parcela_id=$1`, [compra.grupo_parcela_id]);
    const valorParcela = +(valorTotal / nParcelas).toFixed(2);
    for (let p = 0; p < nParcelas; p++) {
      const venc = new Date(compra.data_pedido); venc.setMonth(venc.getMonth() + p);
      const vencStr = venc.toISOString().split('T')[0];
      const desc = nParcelas > 1 ? `${forn.nome} — Compra ${compra.numero} (${p + 1}/${nParcelas})` : `${forn.nome} — Compra ${compra.numero}`;
      await db.run(`
        INSERT INTO lancamentos (tipo, descricao, valor, data_vencimento, status, forma_pagamento, conta_id, categoria_id,
          fornecedor_id, origem, parcela_num, parcela_total, grupo_parcela_id)
        VALUES ('despesa',$1,$2,$3,'pendente',$4,$5,$6,$7,'compra_fornecedor',$8,$9,$10)`,
        [desc, valorParcela, vencStr, forma_pagamento || null, conta_id || null, categoria_id || null,
         compra.fornecedor_id, p + 1, nParcelas, compra.grupo_parcela_id]);
    }

    await db.run(`
      UPDATE forn_compras SET data_entrega_prevista=$1, valor_total=$2, itens=$3, forma_pagamento=$4, num_parcelas=$5, observacoes=$6
      WHERE id=$7`,
      [data_entrega_prevista || null, valorTotal, JSON.stringify(itensProcessados), forma_pagamento || null, nParcelas, observacoes || null, req.params.id]);

    await registrarHistorico(compra.fornecedor_id, 'compra', `Compra ${compra.numero} editada — novo total ${fmtBRL(valorTotal)}`);
    res.json({ mensagem: 'Compra atualizada' });
  } catch (err) {
    console.error('[fornecedores compras PUT]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.delete('/compras/:id', async (req, res) => {
  try {
    const compra = await db.get(`SELECT * FROM forn_compras WHERE id=$1`, [req.params.id]);
    if (!compra) return res.status(404).json({ erro: 'Compra não encontrada' });
    if (await verificarParcelasPagas(compra.grupo_parcela_id)) {
      return res.status(400).json({ erro: 'Não é possível excluir uma compra com parcelas já pagas' });
    }
    await db.run(`DELETE FROM lancamentos WHERE grupo_parcela_id=$1`, [compra.grupo_parcela_id]);
    await db.run(`DELETE FROM forn_compras WHERE id=$1`, [req.params.id]);
    await registrarHistorico(compra.fornecedor_id, 'compra', `Compra ${compra.numero} excluída`);
    res.json({ mensagem: 'Compra excluída' });
  } catch (err) {
    console.error('[fornecedores compras DELETE]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   FINANCEIRO DO FORNECEDOR — lê direto dos lançamentos (sem duplicar)
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/financeiro', async (req, res) => {
  try {
    const lancs = await db.all(`
      SELECT l.*, c.nome AS conta_nome, cat.nome AS categoria_nome
      FROM lancamentos l
      LEFT JOIN contas_correntes cc ON cc.id=l.conta_id
      LEFT JOIN contas_correntes c ON c.id=l.conta_id
      LEFT JOIN categorias cat ON cat.id=l.categoria_id
      WHERE l.fornecedor_id=$1 AND l.tipo='despesa' AND l.status<>'cancelado'
      ORDER BY l.data_vencimento DESC LIMIT 100`, [req.params.id]);
    res.json(lancs);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

/* ════════════════════════════════════════════════════════════════
   DOCUMENTOS / CONTRATOS / ANEXOS (unificados por "tipo")
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/documentos', async (req, res) => {
  try {
    res.json(await db.all(`SELECT * FROM forn_documentos WHERE fornecedor_id=$1 ORDER BY criado_em DESC`, [req.params.id]));
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.post('/:id/documentos', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Arquivo é obrigatório' });
    const { tipo, nome, data_inicio, data_fim, valor_contrato } = req.body;
    const id = await db.insert(`
      INSERT INTO forn_documentos (fornecedor_id, tipo, nome, url, data_inicio, data_fim, valor_contrato, criado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.params.id, tipo || 'anexo', nome || req.file.originalname, req.file.path,
       data_inicio || null, data_fim || null, valor_contrato ? n(valor_contrato) : null, req.usuario?.id || null]);
    await registrarHistorico(req.params.id, 'documento', `${tipo === 'contrato' ? 'Contrato' : 'Documento'} "${nome || req.file.originalname}" enviado`);
    res.status(201).json({ id, url: req.file.path });
  } catch (err) {
    console.error('[fornecedores documentos POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.delete('/documentos/:id', async (req, res) => {
  try {
    const doc = await db.get(`SELECT url FROM forn_documentos WHERE id=$1`, [req.params.id]);
    await db.run(`DELETE FROM forn_documentos WHERE id=$1`, [req.params.id]);
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
      SELECT a.*, u.nome AS usuario_nome FROM forn_avaliacoes a
      LEFT JOIN usuarios u ON u.id=a.criado_por
      WHERE a.fornecedor_id=$1 ORDER BY a.criado_em DESC`, [req.params.id]));
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.post('/:id/avaliacoes', async (req, res) => {
  try {
    const { nota_preco, nota_qualidade, nota_prazo, nota_atendimento, nota_pontualidade, nota_confiabilidade, comentario } = req.body;
    const notas = [nota_preco, nota_qualidade, nota_prazo, nota_atendimento, nota_pontualidade, nota_confiabilidade];
    if (notas.some(x => !x || x < 1 || x > 5)) return res.status(400).json({ erro: 'Todas as 6 notas (1 a 5) são obrigatórias' });
    const id = await db.insert(`
      INSERT INTO forn_avaliacoes (fornecedor_id, nota_preco, nota_qualidade, nota_prazo, nota_atendimento, nota_pontualidade, nota_confiabilidade, comentario, criado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.params.id, ...notas.map(i), comentario || null, req.usuario?.id || null]);
    const media = (notas.reduce((s, x) => s + i(x), 0) / 6).toFixed(1);
    await registrarHistorico(req.params.id, 'avaliacao', `Nova avaliação registrada — nota média ${media}`);
    res.status(201).json({ id });
  } catch (err) {
    console.error('[fornecedores avaliacoes POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   HISTÓRICO — timeline automática
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/historico', async (req, res) => {
  try {
    res.json(await db.all(`SELECT * FROM forn_historico WHERE fornecedor_id=$1 ORDER BY criado_em DESC LIMIT 100`, [req.params.id]));
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
      case 'compras-por-fornecedor':
        dados = await db.all(`
          SELECT f.nome, COUNT(c.id) AS qtd, COALESCE(SUM(c.valor_total),0) AS total
          FROM fornecedores f LEFT JOIN forn_compras c ON c.fornecedor_id=f.id AND c.data_pedido BETWEEN $1 AND $2
          WHERE f.ativo=1 GROUP BY f.nome ORDER BY total DESC`, [dIni, dFim]);
        break;
      case 'compras-por-categoria':
        dados = await db.all(`
          SELECT COALESCE(fc.nome,'Sem categoria') AS categoria, COALESCE(SUM(c.valor_total),0) AS total
          FROM forn_compras c JOIN fornecedores f ON f.id=c.fornecedor_id LEFT JOIN forn_categorias fc ON fc.id=f.categoria_id
          WHERE c.data_pedido BETWEEN $1 AND $2 GROUP BY fc.nome ORDER BY total DESC`, [dIni, dFim]);
        break;
      case 'ranking':
        dados = await db.all(`
          SELECT f.nome, COUNT(c.id) AS qtd_compras, COALESCE(SUM(c.valor_total),0) AS total,
            (SELECT AVG((a.nota_preco+a.nota_qualidade+a.nota_prazo+a.nota_atendimento+a.nota_pontualidade+a.nota_confiabilidade)/6.0) FROM forn_avaliacoes a WHERE a.fornecedor_id=f.id) AS avaliacao
          FROM fornecedores f LEFT JOIN forn_compras c ON c.fornecedor_id=f.id AND c.data_pedido BETWEEN $1 AND $2
          WHERE f.ativo=1 GROUP BY f.id, f.nome ORDER BY total DESC`, [dIni, dFim]);
        break;
      case 'historico-precos':
        dados = await db.all(`
          SELECT f.nome AS fornecedor, p.nome AS produto, p.preco_anterior, p.preco_atual, p.atualizado_em
          FROM forn_produtos p JOIN fornecedores f ON f.id=p.fornecedor_id
          WHERE p.preco_anterior IS NOT NULL ORDER BY p.atualizado_em DESC LIMIT 200`);
        break;
      case 'avaliacoes':
        dados = await db.all(`
          SELECT f.nome, a.nota_preco, a.nota_qualidade, a.nota_prazo, a.nota_atendimento, a.nota_pontualidade, a.nota_confiabilidade, a.comentario, a.criado_em
          FROM forn_avaliacoes a JOIN fornecedores f ON f.id=a.fornecedor_id
          WHERE a.criado_em BETWEEN $1 AND $2 ORDER BY a.criado_em DESC`, [dIni, dFim]);
        break;
      case 'pagamentos':
        dados = await db.all(`
          SELECT f.nome, l.descricao, l.valor, l.data_vencimento, l.data_pagamento, l.status
          FROM lancamentos l JOIN fornecedores f ON f.id=l.fornecedor_id
          WHERE l.tipo='despesa' AND l.data_vencimento BETWEEN $1 AND $2 ORDER BY l.data_vencimento DESC`, [dIni, dFim]);
        break;
      case 'entregas':
        dados = await db.all(`
          SELECT f.nome, c.numero, c.data_pedido, c.data_entrega_prevista, c.data_entrega_real, c.status,
            (c.data_entrega_real::date - c.data_entrega_prevista::date) AS dias_atraso
          FROM forn_compras c JOIN fornecedores f ON f.id=c.fornecedor_id
          WHERE c.data_pedido BETWEEN $1 AND $2 ORDER BY c.data_pedido DESC`, [dIni, dFim]);
        break;
      case 'economia': {
        const compras = await db.all(`
          SELECT c.itens, c.data_pedido, c.numero, f.nome AS fornecedor
          FROM forn_compras c JOIN fornecedores f ON f.id=c.fornecedor_id
          WHERE c.data_pedido BETWEEN $1 AND $2`, [dIni, dFim]);
        dados = [];
        for (const c of compras) {
          const itens = Array.isArray(c.itens) ? c.itens : JSON.parse(c.itens || '[]');
          for (const it of itens) {
            const precoAnt = n(it.preco_anterior), preco = n(it.preco_unit), qtd = n(it.qtd);
            if (precoAnt > preco && qtd > 0) {
              dados.push({
                fornecedor: c.fornecedor, compra: c.numero, produto: it.nome, data_pedido: c.data_pedido,
                preco_anterior: precoAnt, preco_atual: preco, qtd, economia: +((precoAnt - preco) * qtd).toFixed(2),
              });
            }
          }
        }
        dados.sort((a, b) => b.economia - a.economia);
        break;
      }
      default:
        return res.status(400).json({ erro: 'Tipo de relatório inválido' });
    }
    res.json({ tipo, periodo: { inicio: dIni, fim: dFim }, dados });
  } catch (err) {
    console.error('[fornecedores relatorios]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
