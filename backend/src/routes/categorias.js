/* ════════════════════════════════════════════════════════════════
   CATEGORIAS — Central de Classificação Financeira
   CRUD hierárquico (categorias/subcategorias) + centros de custo +
   contas contábeis + motor de regras automáticas + histórico/auditoria
   + KPIs + alertas + insights de IA + relatórios, tudo sobre a mesma
   tabela `categorias` já usada pelos lançamentos financeiros do ERP.
   ════════════════════════════════════════════════════════════════ */
const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

const n = v => parseFloat(v) || 0;
const i = v => parseInt(v) || 0;
const pct = (a, b) => b > 0 ? +((a - b) / b * 100).toFixed(1) : null;
const hoje = () => new Date().toISOString().split('T')[0];
const fmtBRL = v => 'R$ ' + n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PREFIXO_TIPO = { receita: 'REC', despesa: 'DESP', custo: 'CUST', imposto: 'IMP', comissao: 'COM' };

// Liga o bloqueio "categoria obrigatória" nos 9 pontos de criação de lançamento.
// Mantido desligado até existir uma tela (Central de Categorias) e um conjunto
// mínimo de categorias/regras cadastrado — senão fluxos reais (comissão,
// compra de fornecedor, conversão de orçamento) passam a falhar com 400.
// Ativar via variável de ambiente CATEGORIA_OBRIGATORIA=true quando pronto.
const EXIGIR_CATEGORIA = process.env.CATEGORIA_OBRIGATORIA === 'true';

async function registrarHistorico(categoriaId, regraId, usuarioId, acao, dadosAntes, dadosDepois) {
  await db.run(
    `INSERT INTO cat_historico (categoria_id, regra_id, usuario_id, acao, dados_antes, dados_depois)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [categoriaId || null, regraId || null, usuarioId || null, acao,
     dadosAntes ? JSON.stringify(dadosAntes) : null, dadosDepois ? JSON.stringify(dadosDepois) : null]
  );
}

/* ════════════════════════════════════════════════════════════════
   MOTOR DE REGRAS — função exportada (não é rota)
   ════════════════════════════════════════════════════════════════ */
async function aplicarRegras(payload = {}) {
  const regras = await db.all(`SELECT * FROM cat_regras WHERE ativa=true ORDER BY prioridade DESC, id ASC`);
  for (const regra of regras) {
    const alvo = payload[regra.campo];
    if (alvo === undefined || alvo === null) continue;
    const texto = String(alvo);
    let bateu = false;
    switch (regra.operador) {
      case 'contem':
        bateu = texto.toLowerCase().includes(String(regra.valor).toLowerCase());
        break;
      case 'igual':
        bateu = texto.toLowerCase() === String(regra.valor).toLowerCase();
        break;
      case 'comeca_com':
        bateu = texto.toLowerCase().startsWith(String(regra.valor).toLowerCase());
        break;
      case 'regex':
        try { bateu = new RegExp(regra.valor, 'i').test(texto); } catch { bateu = false; }
        break;
    }
    if (bateu) {
      await db.run(`UPDATE cat_regras SET aplicacoes=aplicacoes+1, ultima_aplicacao=NOW() WHERE id=$1`, [regra.id]);
      await registrarHistorico(regra.categoria_id, regra.id, null, 'regra_aplicada', null, { campo: regra.campo, valor_avaliado: texto });
      return regra.categoria_id;
    }
  }
  return null;
}

/* ════════════════════════════════════════════════════════════════
   CÓDIGO AUTOMÁTICO — TIPO-NNN sequencial por tipo
   ════════════════════════════════════════════════════════════════ */
async function gerarCodigo(tipo) {
  const prefixo = PREFIXO_TIPO[tipo] || 'CAT';
  const row = await db.get(
    `SELECT codigo FROM categorias WHERE codigo LIKE $1 ORDER BY codigo DESC LIMIT 1`,
    [`${prefixo}-%`]
  );
  let proximo = 1;
  if (row && row.codigo) {
    const partes = row.codigo.split('-');
    const num = parseInt(partes[partes.length - 1]);
    if (!isNaN(num)) proximo = num + 1;
  }
  return `${prefixo}-${String(proximo).padStart(3, '0')}`;
}

/* ════════════════════════════════════════════════════════════════
   KPIs — sparklines de 6 meses
   ════════════════════════════════════════════════════════════════ */
router.get('/kpis', async (req, res) => {
  try {
    const m0 = hoje().slice(0, 8) + '01';
    const sd = new Date(); sd.setMonth(sd.getMonth() - 5); sd.setDate(1);
    const sparkIni = sd.toISOString().split('T')[0];
    const meses = [];
    for (let k = 5; k >= 0; k--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }

    const [
      porTipo, statusRow, semCategoria, maisUtilizada, valorMovRow,
      semCategoriaSpark, valorMovSpark,
    ] = await Promise.all([
      db.get(`SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER(WHERE tipo='receita') AS receita,
        COUNT(*) FILTER(WHERE tipo='despesa') AS despesa,
        COUNT(*) FILTER(WHERE tipo='custo') AS custo,
        COUNT(*) FILTER(WHERE tipo='imposto') AS imposto,
        COUNT(*) FILTER(WHERE tipo='comissao') AS comissao
        FROM categorias WHERE ativa=1`),
      db.get(`SELECT COUNT(*) FILTER(WHERE ativa=1) AS ativas, COUNT(*) FILTER(WHERE ativa=0) AS inativas FROM categorias`),
      db.get(`SELECT COUNT(*) AS v FROM lancamentos WHERE categoria_id IS NULL AND tipo<>'transferencia'`),
      db.get(`SELECT c.nome, COUNT(l.id) AS qtd FROM categorias c JOIN lancamentos l ON l.categoria_id=c.id
              WHERE c.ativa=1 GROUP BY c.id, c.nome ORDER BY qtd DESC LIMIT 1`),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE categoria_id IS NOT NULL AND data_vencimento>=$1`, [m0]),
      db.all(`SELECT LEFT(data_vencimento,7) AS m, COUNT(*) AS v FROM lancamentos WHERE categoria_id IS NULL AND tipo<>'transferencia' AND data_vencimento>=$1 GROUP BY 1`, [sparkIni]),
      db.all(`SELECT LEFT(data_vencimento,7) AS m, COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE categoria_id IS NOT NULL AND data_vencimento>=$1 GROUP BY 1`, [sparkIni]),
    ]);

    const mapBy = rows => Object.fromEntries((rows || []).map(r => [r.m, r]));
    const scm = mapBy(semCategoriaSpark), vmm = mapBy(valorMovSpark);
    const semCategoriaSparkArr = meses.map(k => i(scm[k]?.v));
    const valorMovSparkArr = meses.map(k => n(vmm[k]?.v));

    res.json({
      total: { valor: i(porTipo.total) },
      receita: { valor: i(porTipo.receita) },
      despesa: { valor: i(porTipo.despesa) },
      custo: { valor: i(porTipo.custo) },
      imposto: { valor: i(porTipo.imposto) },
      comissao: { valor: i(porTipo.comissao) },
      ativas: { valor: i(statusRow.ativas) },
      inativas: { valor: i(statusRow.inativas) },
      semCategoria: { valor: i(semCategoria.v), sparkline: semCategoriaSparkArr },
      maisUtilizada: { nome: maisUtilizada?.nome || null, qtd: i(maisUtilizada?.qtd) },
      valorMovimentado: { valor: n(valorMovRow.v), sparkline: valorMovSparkArr },
    });
  } catch (err) {
    console.error('[categorias/kpis]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   ÁRVORE — hierarquia completa via WITH RECURSIVE
   ════════════════════════════════════════════════════════════════ */
router.get('/arvore', async (req, res) => {
  try {
    const rows = await db.all(`
      WITH RECURSIVE arv AS (
        SELECT c.*, 0 AS nivel, ARRAY[c.ordem, c.id] AS caminho
        FROM categorias c WHERE c.categoria_pai_id IS NULL
        UNION ALL
        SELECT c.*, a.nivel + 1, a.caminho || ARRAY[c.ordem, c.id]
        FROM categorias c JOIN arv a ON c.categoria_pai_id = a.id
      )
      SELECT arv.*,
        (SELECT COUNT(*) FROM lancamentos l WHERE l.categoria_id=arv.id) AS qtd_lancamentos,
        (SELECT COALESCE(SUM(l.valor),0) FROM lancamentos l WHERE l.categoria_id=arv.id) AS valor_movimentado,
        (SELECT MAX(l.data_vencimento) FROM lancamentos l WHERE l.categoria_id=arv.id) AS ultima_utilizacao
      FROM arv ORDER BY caminho
    `);
    const lista = rows.map(r => ({ ...r, qtd_lancamentos: i(r.qtd_lancamentos), valor_movimentado: n(r.valor_movimentado) }));

    // Monta árvore em memória
    const byId = new Map(lista.map(r => [r.id, { ...r, filhos: [] }]));
    const raiz = [];
    for (const node of byId.values()) {
      if (node.categoria_pai_id && byId.has(node.categoria_pai_id)) byId.get(node.categoria_pai_id).filhos.push(node);
      else raiz.push(node);
    }
    res.json(raiz);
  } catch (err) {
    console.error('[categorias/arvore]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   ALERTAS — computados on-the-fly
   ════════════════════════════════════════════════════════════════ */
router.get('/alertas', async (req, res) => {
  try {
    const d90 = new Date(); d90.setDate(d90.getDate() - 90);
    const d90str = d90.toISOString().split('T')[0];

    const [duplicadas, semUso, semCategoriaCount, semCategoriaAmostra, inativaEmUso, generica, semCentroCusto] = await Promise.all([
      db.all(`SELECT LOWER(nome) AS nome_norm, tipo, COUNT(*) AS qtd, array_agg(id) AS ids
              FROM categorias WHERE ativa=1 GROUP BY LOWER(nome), tipo HAVING COUNT(*) > 1`),
      db.all(`SELECT c.id, c.nome, c.tipo FROM categorias c
              WHERE c.ativa=1 AND NOT EXISTS (SELECT 1 FROM lancamentos l WHERE l.categoria_id=c.id)`),
      db.get(`SELECT COUNT(*) AS v FROM lancamentos WHERE categoria_id IS NULL AND tipo<>'transferencia'`),
      db.all(`SELECT id, descricao, valor, data_vencimento FROM lancamentos WHERE categoria_id IS NULL AND tipo<>'transferencia' ORDER BY data_vencimento DESC LIMIT 5`),
      db.all(`SELECT c.id, c.nome, COUNT(l.id) AS qtd FROM categorias c JOIN lancamentos l ON l.categoria_id=c.id
              WHERE c.ativa=0 AND l.data_vencimento>=$1 GROUP BY c.id, c.nome`, [d90str]),
      db.all(`SELECT c.id, c.nome, COUNT(l.id) AS qtd FROM categorias c LEFT JOIN lancamentos l ON l.categoria_id=c.id
              WHERE c.ativa=1 AND (LENGTH(c.nome) < 4 OR LOWER(c.nome) = ANY(ARRAY['outros','diversos','geral']))
              GROUP BY c.id, c.nome HAVING COUNT(l.id) > 20`),
      db.all(`SELECT c.id, c.nome, COUNT(l.id) AS qtd FROM categorias c JOIN lancamentos l ON l.categoria_id=c.id
              WHERE c.ativa=1 AND c.centro_custo_id IS NULL GROUP BY c.id, c.nome HAVING COUNT(l.id) > 0`),
    ]);

    res.json({
      duplicadas: duplicadas.map(d => ({ nome: d.nome_norm, tipo: d.tipo, qtd: i(d.qtd), ids: d.ids })),
      semUso: semUso,
      semCategoria: { qtd: i(semCategoriaCount.v), amostra: semCategoriaAmostra },
      inativaEmUso: inativaEmUso.map(r => ({ ...r, qtd: i(r.qtd) })),
      muitoGenerica: generica.map(r => ({ ...r, qtd: i(r.qtd) })),
      semCentroCusto: semCentroCusto.map(r => ({ ...r, qtd: i(r.qtd) })),
    });
  } catch (err) {
    console.error('[categorias/alertas]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   IA — INSIGHTS (cache 24h em cat_ia_insights)
   ════════════════════════════════════════════════════════════════ */
router.get('/ia-insights', async (req, res) => {
  try {
    const periodoIni = req.query.periodo_ini || (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); d.setDate(1); return d.toISOString().split('T')[0]; })();
    const periodoFim = req.query.periodo_fim || hoje();

    const cache = await db.get(
      `SELECT * FROM cat_ia_insights WHERE periodo_ini=$1 AND periodo_fim=$2 AND gerado_em > NOW() - INTERVAL '24 hours' ORDER BY gerado_em DESC LIMIT 1`,
      [periodoIni, periodoFim]
    );
    if (cache) return res.json({ insights: cache.insights, gerado_em: cache.gerado_em, cache: true });

    const [topCategorias, totalRow, semCategoria] = await Promise.all([
      db.all(`SELECT c.nome, COALESCE(SUM(l.valor),0) AS valor
              FROM categorias c JOIN lancamentos l ON l.categoria_id=c.id
              WHERE l.data_vencimento BETWEEN $1 AND $2
              GROUP BY c.id, c.nome ORDER BY valor DESC LIMIT 5`, [periodoIni, periodoFim]),
      db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE categoria_id IS NOT NULL AND data_vencimento BETWEEN $1 AND $2`, [periodoIni, periodoFim]),
      db.get(`SELECT COUNT(*) AS v FROM lancamentos WHERE categoria_id IS NULL AND tipo<>'transferencia' AND data_vencimento BETWEEN $1 AND $2`, [periodoIni, periodoFim]),
    ]);

    const totalPeriodo = n(totalRow.v);
    const top5 = topCategorias.map(c => ({ nome: c.nome, valor: n(c.valor), pct: totalPeriodo > 0 ? +((n(c.valor) / totalPeriodo) * 100).toFixed(1) : 0 }));

    // Variação mês a mês das top 3 (comparando o mês do período com o mês anterior)
    const variacoes = [];
    for (const cat of topCategorias.slice(0, 3)) {
      const catRow = await db.get(`SELECT id FROM categorias WHERE nome=$1 LIMIT 1`, [cat.nome]);
      if (!catRow) continue;
      const atual = await db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE categoria_id=$1 AND data_vencimento BETWEEN $2 AND $3`, [catRow.id, periodoIni, periodoFim]);
      const diasPeriodo = Math.max(1, Math.round((new Date(periodoFim) - new Date(periodoIni)) / 86400000));
      const antIni = new Date(periodoIni); antIni.setDate(antIni.getDate() - diasPeriodo);
      const antFim = new Date(periodoIni); antFim.setDate(antFim.getDate() - 1);
      const anterior = await db.get(`SELECT COALESCE(SUM(valor),0) AS v FROM lancamentos WHERE categoria_id=$1 AND data_vencimento BETWEEN $2 AND $3`,
        [catRow.id, antIni.toISOString().split('T')[0], antFim.toISOString().split('T')[0]]);
      variacoes.push({ nome: cat.nome, variacao: pct(n(atual.v), n(anterior.v)) });
    }

    const resumo = { top5, variacoes, semCategoria: i(semCategoria.v), periodo: { periodoIni, periodoFim } };

    let insights = [];
    let erro = null;
    try {
      if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY ausente');
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { responseMimeType: 'application/json' } });
      const prompt = `Você é um analista financeiro de uma empresa de móveis planejados. Com base neste resumo compacto de categorias financeiras (JSON abaixo), gere de 3 a 6 insights curtos em português, no estilo:
"Compra de Materiais representa 42% das despesas.", "Marketing aumentou 31%.", "Existem 8 lançamentos sem categoria."

Resumo: ${JSON.stringify(resumo)}

Responda APENAS um JSON válido no formato: { "insights": ["...", "..."] }`;
      const result = await model.generateContent(prompt);
      const parsed = JSON.parse(result.response.text());
      insights = Array.isArray(parsed.insights) ? parsed.insights : [];
    } catch (e) {
      console.error('[categorias/ia-insights] IA indisponível:', e.message);
      return res.json({ insights: [], erro: 'IA indisponível' });
    }

    await db.run(`INSERT INTO cat_ia_insights (periodo_ini, periodo_fim, insights) VALUES ($1,$2,$3)`,
      [periodoIni, periodoFim, JSON.stringify(insights)]);

    res.json({ insights, cache: false });
  } catch (err) {
    console.error('[categorias/ia-insights]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   RELATÓRIOS — JSON tabular (PDF/CSV são client-side)
   ════════════════════════════════════════════════════════════════ */
router.get('/relatorio', async (req, res) => {
  try {
    const { tipo } = req.query;
    const periodoIni = req.query.periodo_ini || '2000-01-01';
    const periodoFim = req.query.periodo_fim || hoje();
    let dados;

    switch (tipo) {
      case 'periodo':
        dados = await db.all(`
          SELECT c.nome, c.tipo, COUNT(l.id) AS qtd, COALESCE(SUM(l.valor),0) AS total
          FROM categorias c LEFT JOIN lancamentos l ON l.categoria_id=c.id AND l.data_vencimento BETWEEN $1 AND $2
          WHERE c.ativa=1 GROUP BY c.id, c.nome, c.tipo ORDER BY total DESC`, [periodoIni, periodoFim]);
        break;
      case 'receitas':
        dados = await db.all(`
          SELECT c.nome, COUNT(l.id) AS qtd, COALESCE(SUM(l.valor),0) AS total
          FROM categorias c JOIN lancamentos l ON l.categoria_id=c.id
          WHERE c.tipo='receita' AND l.data_vencimento BETWEEN $1 AND $2
          GROUP BY c.id, c.nome ORDER BY total DESC`, [periodoIni, periodoFim]);
        break;
      case 'despesas':
        dados = await db.all(`
          SELECT c.nome, COUNT(l.id) AS qtd, COALESCE(SUM(l.valor),0) AS total
          FROM categorias c JOIN lancamentos l ON l.categoria_id=c.id
          WHERE c.tipo IN ('despesa','custo','imposto') AND l.data_vencimento BETWEEN $1 AND $2
          GROUP BY c.id, c.nome ORDER BY total DESC`, [periodoIni, periodoFim]);
        break;
      case 'mais-utilizadas':
        dados = await db.all(`
          SELECT c.nome, c.tipo, COUNT(l.id) AS qtd, COALESCE(SUM(l.valor),0) AS total
          FROM categorias c JOIN lancamentos l ON l.categoria_id=c.id
          WHERE l.data_vencimento BETWEEN $1 AND $2
          GROUP BY c.id, c.nome, c.tipo ORDER BY qtd DESC LIMIT 20`, [periodoIni, periodoFim]);
        break;
      case 'sem-utilizacao':
        dados = await db.all(`
          SELECT c.nome, c.tipo, c.criado_em FROM categorias c
          WHERE c.ativa=1 AND NOT EXISTS (SELECT 1 FROM lancamentos l WHERE l.categoria_id=c.id)
          ORDER BY c.nome`);
        break;
      case 'centro-custo':
        dados = await db.all(`
          SELECT COALESCE(cc.nome,'Sem centro de custo') AS centro_custo, COUNT(l.id) AS qtd, COALESCE(SUM(l.valor),0) AS total
          FROM lancamentos l JOIN categorias c ON c.id=l.categoria_id LEFT JOIN fin_centros_custo cc ON cc.id=c.centro_custo_id
          WHERE l.data_vencimento BETWEEN $1 AND $2
          GROUP BY cc.nome ORDER BY total DESC`, [periodoIni, periodoFim]);
        break;
      case 'comparativo':
        dados = await db.all(`
          SELECT c.nome, LEFT(l.data_vencimento,7) AS mes, COALESCE(SUM(l.valor),0) AS total
          FROM categorias c JOIN lancamentos l ON l.categoria_id=c.id
          WHERE l.data_vencimento BETWEEN $1 AND $2
          GROUP BY c.id, c.nome, mes ORDER BY c.nome, mes`, [periodoIni, periodoFim]);
        break;
      default:
        return res.status(400).json({ erro: 'Tipo de relatório inválido' });
    }
    res.json({ tipo, periodo: { inicio: periodoIni, fim: periodoFim }, dados: dados.map(d => ({ ...d, qtd: d.qtd !== undefined ? i(d.qtd) : undefined, total: d.total !== undefined ? n(d.total) : undefined })) });
  } catch (err) {
    console.error('[categorias/relatorio]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   HISTÓRICO GLOBAL (paginado) — antes da rota /:id para não colidir
   ════════════════════════════════════════════════════════════════ */
router.get('/historico', async (req, res) => {
  try {
    const pagina = Math.max(1, i(req.query.pagina) || 1);
    const limite = Math.min(200, i(req.query.limite) || 50);
    const offset = (pagina - 1) * limite;
    const { acao } = req.query;

    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;
    if (acao) { where += ` AND h.acao=$${idx++}`; params.push(acao); }

    const [rows, totalRow] = await Promise.all([
      db.all(`SELECT h.*, c.nome AS categoria_nome, r.nome AS regra_nome, u.nome AS usuario_nome
              FROM cat_historico h
              LEFT JOIN categorias c ON c.id=h.categoria_id
              LEFT JOIN cat_regras r ON r.id=h.regra_id
              LEFT JOIN usuarios u ON u.id=h.usuario_id
              ${where} ORDER BY h.criado_em DESC LIMIT $${idx} OFFSET $${idx + 1}`, [...params, limite, offset]),
      db.get(`SELECT COUNT(*) AS v FROM cat_historico h ${where}`, params),
    ]);
    res.json({ dados: rows, total: i(totalRow.v), pagina, limite });
  } catch (err) {
    console.error('[categorias/historico]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   CENTROS DE CUSTO (sobre fin_centros_custo)
   ════════════════════════════════════════════════════════════════ */
router.get('/centros-custo', async (req, res) => {
  try {
    res.json(await db.all(`SELECT * FROM fin_centros_custo WHERE ativo=true ORDER BY nome`));
  } catch (err) {
    console.error('[categorias/centros-custo GET]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.post('/centros-custo', async (req, res) => {
  try {
    const { nome, cor, codigo, descricao } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
    const id = await db.insert(
      `INSERT INTO fin_centros_custo (nome, cor, codigo, descricao) VALUES ($1,$2,$3,$4)`,
      [nome, cor || '#6366f1', codigo || null, descricao || null]
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error('[categorias/centros-custo POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.put('/centros-custo/:id', async (req, res) => {
  try {
    const { nome, cor, codigo, descricao, ativo } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
    await db.run(
      `UPDATE fin_centros_custo SET nome=$1, cor=$2, codigo=$3, descricao=$4, ativo=COALESCE($5,ativo) WHERE id=$6`,
      [nome, cor || '#6366f1', codigo || null, descricao || null, ativo === undefined ? null : !!ativo, req.params.id]
    );
    res.json({ mensagem: 'Centro de custo atualizado' });
  } catch (err) {
    console.error('[categorias/centros-custo PUT]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   CONTAS CONTÁBEIS
   ════════════════════════════════════════════════════════════════ */
router.get('/contas-contabeis', async (req, res) => {
  try {
    res.json(await db.all(`SELECT * FROM contas_contabeis WHERE ativa=true ORDER BY codigo`));
  } catch (err) {
    console.error('[categorias/contas-contabeis GET]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.post('/contas-contabeis', async (req, res) => {
  try {
    const { codigo, nome, natureza } = req.body;
    if (!codigo || !nome) return res.status(400).json({ erro: 'Código e nome são obrigatórios' });
    const id = await db.insert(
      `INSERT INTO contas_contabeis (codigo, nome, natureza) VALUES ($1,$2,$3)`,
      [codigo, nome, natureza || null]
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error('[categorias/contas-contabeis POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.put('/contas-contabeis/:id', async (req, res) => {
  try {
    const { codigo, nome, natureza, ativa } = req.body;
    if (!codigo || !nome) return res.status(400).json({ erro: 'Código e nome são obrigatórios' });
    await db.run(
      `UPDATE contas_contabeis SET codigo=$1, nome=$2, natureza=$3, ativa=COALESCE($4,ativa) WHERE id=$5`,
      [codigo, nome, natureza || null, ativa === undefined ? null : !!ativa, req.params.id]
    );
    res.json({ mensagem: 'Conta contábil atualizada' });
  } catch (err) {
    console.error('[categorias/contas-contabeis PUT]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   REGRAS AUTOMÁTICAS
   ════════════════════════════════════════════════════════════════ */
router.get('/regras', async (req, res) => {
  try {
    res.json(await db.all(`
      SELECT r.*, c.nome AS categoria_nome, c.tipo AS categoria_tipo
      FROM cat_regras r LEFT JOIN categorias c ON c.id=r.categoria_id
      ORDER BY r.prioridade DESC, r.id ASC`));
  } catch (err) {
    console.error('[categorias/regras GET]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.post('/regras', async (req, res) => {
  try {
    const { nome, categoria_id, campo, operador, valor, prioridade } = req.body;
    if (!nome || !categoria_id || !campo || !valor) return res.status(400).json({ erro: 'Nome, categoria, campo e valor são obrigatórios' });
    const id = await db.insert(
      `INSERT INTO cat_regras (nome, categoria_id, campo, operador, valor, prioridade, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [nome, categoria_id, campo, operador || 'contem', valor, i(prioridade), req.usuario?.id || null]
    );
    await registrarHistorico(categoria_id, id, req.usuario?.id, 'regra_criada', null, { nome, campo, operador, valor });
    res.status(201).json({ id });
  } catch (err) {
    console.error('[categorias/regras POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.put('/regras/:id', async (req, res) => {
  try {
    const antes = await db.get(`SELECT * FROM cat_regras WHERE id=$1`, [req.params.id]);
    if (!antes) return res.status(404).json({ erro: 'Regra não encontrada' });
    const { nome, categoria_id, campo, operador, valor, prioridade, ativa } = req.body;
    if (!nome || !categoria_id || !campo || !valor) return res.status(400).json({ erro: 'Nome, categoria, campo e valor são obrigatórios' });
    await db.run(
      `UPDATE cat_regras SET nome=$1, categoria_id=$2, campo=$3, operador=$4, valor=$5, prioridade=$6, ativa=$7 WHERE id=$8`,
      [nome, categoria_id, campo, operador || 'contem', valor, i(prioridade), ativa === undefined ? antes.ativa : !!ativa, req.params.id]
    );
    await registrarHistorico(categoria_id, req.params.id, req.usuario?.id, 'regra_editada', antes, { nome, categoria_id, campo, operador, valor });
    res.json({ mensagem: 'Regra atualizada' });
  } catch (err) {
    console.error('[categorias/regras PUT]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.delete('/regras/:id', async (req, res) => {
  try {
    const antes = await db.get(`SELECT * FROM cat_regras WHERE id=$1`, [req.params.id]);
    if (!antes) return res.status(404).json({ erro: 'Regra não encontrada' });
    await db.run(`DELETE FROM cat_regras WHERE id=$1`, [req.params.id]);
    await registrarHistorico(antes.categoria_id, null, req.usuario?.id, 'regra_excluida', antes, null);
    res.json({ mensagem: 'Regra excluída' });
  } catch (err) {
    console.error('[categorias/regras DELETE]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.post('/regras/testar', async (req, res) => {
  try {
    const { campo, operador, valor } = req.body;
    if (!campo || !valor) return res.status(400).json({ erro: 'Campo e valor são obrigatórios' });

    const colunaPorCampo = {
      descricao: 'l.descricao',
      fornecedor_nome: 'f.nome',
      parceiro_nome: 'p.nome',
      cliente_nome: 'cl.nome',
      forma_pagamento: 'l.forma_pagamento',
    };
    const coluna = colunaPorCampo[campo];
    if (!coluna) return res.status(400).json({ erro: 'Campo inválido' });

    let condicao;
    const params = [];
    switch (operador) {
      case 'igual': condicao = `LOWER(${coluna}) = LOWER($1)`; params.push(valor); break;
      case 'comeca_com': condicao = `${coluna} ILIKE $1`; params.push(`${valor}%`); break;
      case 'regex': condicao = `${coluna} ~* $1`; params.push(valor); break;
      case 'contem':
      default: condicao = `${coluna} ILIKE $1`; params.push(`%${valor}%`); break;
    }

    const rows = await db.all(`
      SELECT l.id, l.descricao, l.valor, l.data_vencimento, f.nome AS fornecedor_nome, p.nome AS parceiro_nome, cl.nome AS cliente_nome, l.forma_pagamento
      FROM lancamentos l
      LEFT JOIN fornecedores f ON f.id=l.fornecedor_id
      LEFT JOIN parceiros p ON p.id=l.parceiro_id
      LEFT JOIN clientes cl ON cl.id=l.cliente_id
      WHERE ${coluna} IS NOT NULL AND ${condicao}
      ORDER BY l.data_vencimento DESC LIMIT 500`, params);

    res.json({ total: rows.length, amostra: rows.slice(0, 20) });
  } catch (err) {
    console.error('[categorias/regras/testar]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   REORDENAR (drag-and-drop)
   ════════════════════════════════════════════════════════════════ */
router.put('/reordenar-lote', async (req, res) => {
  try {
    const itens = req.body.itens || req.body;
    if (!Array.isArray(itens) || !itens.length) return res.status(400).json({ erro: 'Informe a lista de itens a reordenar' });
    for (const it of itens) {
      await db.run(`UPDATE categorias SET ordem=$1, categoria_pai_id=$2, atualizado_em=NOW() WHERE id=$3`,
        [i(it.ordem), it.categoria_pai_id || null, it.id]);
    }
    res.json({ mensagem: 'Ordem atualizada' });
  } catch (err) {
    console.error('[categorias/reordenar-lote]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.put('/:id/reordenar', async (req, res) => {
  try {
    const { ordem, categoria_pai_id } = req.body;
    await db.run(`UPDATE categorias SET ordem=$1, categoria_pai_id=$2, atualizado_em=NOW() WHERE id=$3`,
      [i(ordem), categoria_pai_id || null, req.params.id]);
    res.json({ mensagem: 'Ordem atualizada' });
  } catch (err) {
    console.error('[categorias/:id/reordenar]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   LISTAGEM PRINCIPAL — busca + filtros + agregados por linha
   ════════════════════════════════════════════════════════════════ */
router.get('/', async (req, res) => {
  try {
    const { tipo, status, centro_custo_id, mais_utilizadas, sem_movimentacao, automaticas, manuais, busca } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;

    if (tipo) { where += ` AND c.tipo=$${idx++}`; params.push(tipo); }
    if (status === 'ativa') where += ' AND c.ativa=1';
    if (status === 'inativa') where += ' AND c.ativa=0';
    if (centro_custo_id) { where += ` AND c.centro_custo_id=$${idx++}`; params.push(centro_custo_id); }
    if (automaticas === '1') where += ' AND c.automatica=true';
    if (manuais === '1') where += ' AND c.automatica=false';
    if (busca) {
      where += ` AND (c.nome ILIKE $${idx} OR c.descricao ILIKE $${idx} OR c.codigo ILIKE $${idx}
                 OR EXISTS(SELECT 1 FROM fin_centros_custo cc WHERE cc.id=c.centro_custo_id AND cc.nome ILIKE $${idx})
                 OR EXISTS(SELECT 1 FROM categorias pai WHERE pai.id=c.categoria_pai_id AND pai.nome ILIKE $${idx}))`;
      params.push(`%${busca}%`); idx++;
    }

    const rows = await db.all(`
      SELECT c.*, cc.nome AS centro_custo_nome, pai.nome AS categoria_pai_nome, ct.codigo AS conta_contabil_codigo, ct.nome AS conta_contabil_nome,
        COALESCE(agg.qtd_lancamentos, 0) AS qtd_lancamentos,
        COALESCE(agg.valor_movimentado, 0) AS valor_movimentado,
        agg.ultima_utilizacao
      FROM categorias c
      LEFT JOIN fin_centros_custo cc ON cc.id=c.centro_custo_id
      LEFT JOIN categorias pai ON pai.id=c.categoria_pai_id
      LEFT JOIN contas_contabeis ct ON ct.id=c.conta_contabil_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS qtd_lancamentos, COALESCE(SUM(l.valor),0) AS valor_movimentado, MAX(l.data_vencimento) AS ultima_utilizacao
        FROM lancamentos l WHERE l.categoria_id = c.id
      ) agg ON true
      ${where}
      ORDER BY c.tipo, c.ordem, c.nome
    `, params);

    let lista = rows.map(r => ({ ...r, qtd_lancamentos: i(r.qtd_lancamentos), valor_movimentado: n(r.valor_movimentado) }));

    if (mais_utilizadas === '1') lista = lista.filter(c => c.qtd_lancamentos > 0).sort((a, b) => b.qtd_lancamentos - a.qtd_lancamentos);
    if (sem_movimentacao === '1') lista = lista.filter(c => c.qtd_lancamentos === 0);

    res.json(lista);
  } catch (err) {
    console.error('[categorias GET]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   DETALHE / DRAWER
   ════════════════════════════════════════════════════════════════ */
router.get('/:id/detalhe', async (req, res) => {
  try {
    const id = req.params.id;
    const [categoria, subcategorias, regras, ultimosLancamentos, stats] = await Promise.all([
      db.get(`SELECT c.*, cc.nome AS centro_custo_nome, pai.nome AS categoria_pai_nome, ct.codigo AS conta_contabil_codigo, ct.nome AS conta_contabil_nome
              FROM categorias c
              LEFT JOIN fin_centros_custo cc ON cc.id=c.centro_custo_id
              LEFT JOIN categorias pai ON pai.id=c.categoria_pai_id
              LEFT JOIN contas_contabeis ct ON ct.id=c.conta_contabil_id
              WHERE c.id=$1`, [id]),
      db.all(`SELECT * FROM categorias WHERE categoria_pai_id=$1 ORDER BY ordem, nome`, [id]),
      db.all(`SELECT * FROM cat_regras WHERE categoria_id=$1 ORDER BY prioridade DESC, id ASC`, [id]),
      db.all(`SELECT * FROM lancamentos WHERE categoria_id=$1 ORDER BY data_vencimento DESC LIMIT 10`, [id]),
      db.get(`SELECT COUNT(*) AS qtd, COALESCE(SUM(valor),0) AS total, COALESCE(AVG(valor),0) AS media, MAX(data_vencimento) AS ultima
              FROM lancamentos WHERE categoria_id=$1`, [id]),
    ]);
    if (!categoria) return res.status(404).json({ erro: 'Categoria não encontrada' });

    res.json({
      categoria,
      subcategorias,
      regras,
      ultimosLancamentos,
      stats: { qtd: i(stats.qtd), total: n(stats.total), media: n(stats.media), ultima: stats.ultima },
    });
  } catch (err) {
    console.error('[categorias/:id/detalhe]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.get('/:id/grafico', async (req, res) => {
  try {
    const id = req.params.id;
    const ano = i(req.query.ano) || new Date().getFullYear();

    const [mensal, anual] = await Promise.all([
      db.all(`SELECT SUBSTRING(data_vencimento,6,2)::int AS mes, COALESCE(SUM(valor),0) AS total
              FROM lancamentos WHERE categoria_id=$1 AND LEFT(data_vencimento,4)=$2
              GROUP BY mes ORDER BY mes`, [id, String(ano)]),
      db.all(`SELECT LEFT(data_vencimento,4) AS ano, COALESCE(SUM(valor),0) AS total
              FROM lancamentos WHERE categoria_id=$1 GROUP BY ano ORDER BY ano`, [id]),
    ]);

    const serieMensal = Array.from({ length: 12 }, (_, idx) => {
      const row = mensal.find(m => i(m.mes) === idx + 1);
      return { mes: idx + 1, total: n(row?.total) };
    });
    const serieAnual = anual.map(a => ({ ano: i(a.ano), total: n(a.total) }));

    res.json({ ano, mensal: serieMensal, anual: serieAnual });
  } catch (err) {
    console.error('[categorias/:id/grafico]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.get('/:id/historico', async (req, res) => {
  try {
    res.json(await db.all(`
      SELECT h.*, r.nome AS regra_nome, u.nome AS usuario_nome
      FROM cat_historico h
      LEFT JOIN cat_regras r ON r.id=h.regra_id
      LEFT JOIN usuarios u ON u.id=h.usuario_id
      WHERE h.categoria_id=$1 ORDER BY h.criado_em DESC LIMIT 100`, [req.params.id]));
  } catch (err) {
    console.error('[categorias/:id/historico]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════
   CRUD CORE — GET/:id, POST, PUT, DELETE
   ════════════════════════════════════════════════════════════════ */
router.get('/:id', async (req, res) => {
  try {
    const categoria = await db.get(`
      SELECT c.*, cc.nome AS centro_custo_nome, pai.nome AS categoria_pai_nome, ct.codigo AS conta_contabil_codigo, ct.nome AS conta_contabil_nome
      FROM categorias c
      LEFT JOIN fin_centros_custo cc ON cc.id=c.centro_custo_id
      LEFT JOIN categorias pai ON pai.id=c.categoria_pai_id
      LEFT JOIN contas_contabeis ct ON ct.id=c.conta_contabil_id
      WHERE c.id=$1`, [req.params.id]);
    if (!categoria) return res.status(404).json({ erro: 'Categoria não encontrada' });
    res.json(categoria);
  } catch (err) {
    console.error('[categorias/:id GET]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      nome, tipo, cor, icone, categoria_pai_id, ativa, centro_custo_id,
      codigo, descricao, conta_contabil_id, automatica, ordem,
    } = req.body;
    if (!nome || !tipo) return res.status(400).json({ erro: 'Nome e tipo são obrigatórios' });
    if (!PREFIXO_TIPO[tipo]) return res.status(400).json({ erro: 'Tipo inválido' });

    const codigoFinal = codigo && codigo.trim() ? codigo.trim() : await gerarCodigo(tipo);

    const id = await db.insert(`
      INSERT INTO categorias (nome, tipo, cor, icone, categoria_pai_id, ativa, centro_custo_id, codigo, descricao, conta_contabil_id, automatica, ordem)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [nome, tipo, cor || '#6366f1', icone || null, categoria_pai_id || null, ativa === undefined ? 1 : (ativa ? 1 : 0),
       centro_custo_id || null, codigoFinal, descricao || null, conta_contabil_id || null, !!automatica, i(ordem)]);

    const criada = await db.get(`SELECT * FROM categorias WHERE id=$1`, [id]);
    await registrarHistorico(id, null, req.usuario?.id, 'categoria_criada', null, criada);
    res.status(201).json({ id, codigo: codigoFinal });
  } catch (err) {
    console.error('[categorias POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const antes = await db.get(`SELECT * FROM categorias WHERE id=$1`, [req.params.id]);
    if (!antes) return res.status(404).json({ erro: 'Categoria não encontrada' });

    const {
      nome, tipo, cor, icone, categoria_pai_id, ativa, centro_custo_id,
      codigo, descricao, conta_contabil_id, automatica, ordem,
    } = req.body;
    if (!nome || !tipo) return res.status(400).json({ erro: 'Nome e tipo são obrigatórios' });
    if (!PREFIXO_TIPO[tipo]) return res.status(400).json({ erro: 'Tipo inválido' });

    await db.run(`
      UPDATE categorias SET nome=$1, tipo=$2, cor=$3, icone=$4, categoria_pai_id=$5, ativa=$6, centro_custo_id=$7,
        codigo=$8, descricao=$9, conta_contabil_id=$10, automatica=$11, ordem=$12, atualizado_em=NOW()
      WHERE id=$13`,
      [nome, tipo, cor || '#6366f1', icone || null, categoria_pai_id || null, ativa === undefined ? antes.ativa : (ativa ? 1 : 0),
       centro_custo_id || null, codigo || antes.codigo, descricao || null, conta_contabil_id || null,
       automatica === undefined ? antes.automatica : !!automatica, ordem === undefined ? antes.ordem : i(ordem), req.params.id]);

    const depois = await db.get(`SELECT * FROM categorias WHERE id=$1`, [req.params.id]);
    await registrarHistorico(req.params.id, null, req.usuario?.id, 'categoria_editada', antes, depois);
    res.json({ mensagem: 'Categoria atualizada' });
  } catch (err) {
    console.error('[categorias PUT]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const antes = await db.get(`SELECT * FROM categorias WHERE id=$1`, [req.params.id]);
    if (!antes) return res.status(404).json({ erro: 'Categoria não encontrada' });

    const regrasAtivas = await db.get(`SELECT COUNT(*) AS q FROM cat_regras WHERE categoria_id=$1 AND ativa=true`, [req.params.id]);
    if (i(regrasAtivas.q) > 0) {
      return res.status(409).json({ erro: 'Esta categoria possui regras automáticas ativas vinculadas e não pode ser excluída — inative-a ou desative as regras primeiro.' });
    }

    await db.run(`UPDATE categorias SET ativa=0, atualizado_em=NOW() WHERE id=$1`, [req.params.id]);
    const depois = await db.get(`SELECT * FROM categorias WHERE id=$1`, [req.params.id]);
    await registrarHistorico(req.params.id, null, req.usuario?.id, 'categoria_excluida', antes, depois);
    res.json({ mensagem: 'Categoria removida' });
  } catch (err) {
    console.error('[categorias DELETE]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
router.aplicarRegras = aplicarRegras;
router.EXIGIR_CATEGORIA = EXIGIR_CATEGORIA;
