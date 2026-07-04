const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

// data_vencimento e data_pagamento são colunas TEXT no formato 'YYYY-MM-DD'
// Comparações de texto funcionam corretamente com ISO 8601
// Usamos LEFT(col,7) para extrair 'YYYY-MM' em vez de TO_CHAR(col::date,...)

/* ════════════════════════════════════════════════════════════════
   DASHBOARD
   ════════════════════════════════════════════════════════════════ */
router.get('/dashboard', async (req, res) => {
  try {
    const hoje    = new Date();
    const mes     = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`;
    const mesAnt  = (() => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth()-1, 1);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    })();
    const hojeStr  = hoje.toISOString().split('T')[0];
    const amanhStr = new Date(hoje.getTime() + 86400000).toISOString().split('T')[0];
    const depoisAm = new Date(hoje.getTime() + 2*86400000).toISOString().split('T')[0];

    // Datas interpoladas diretamente — geradas por código, formato fixo YYYY-MM-DD, sem risco de injection
    const atual = await db.get(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='receita' AND status='pendente' THEN valor END),0)             AS a_receber,
        COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pendente' THEN valor END),0)             AS a_pagar,
        COALESCE(SUM(CASE WHEN tipo='receita' AND status='pago'
          AND LEFT(COALESCE(data_pagamento,''),7)='${mes}' THEN valor END),0)                      AS recebido_mes,
        COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pago'
          AND LEFT(COALESCE(data_pagamento,''),7)='${mes}' THEN valor END),0)                      AS pago_mes,
        COALESCE(SUM(CASE WHEN status='pago' AND LEFT(data_vencimento,7)='${mes}'
          THEN CASE WHEN tipo='receita' THEN valor ELSE -valor END END),0)                         AS lucro_mes,
        COUNT(CASE WHEN status='pendente' AND data_vencimento < '${hojeStr}' THEN 1 END)           AS vencidos_qtd,
        COALESCE(SUM(CASE WHEN status='pendente' AND data_vencimento < '${hojeStr}' THEN valor END),0) AS vencidos_valor,
        COALESCE(SUM(CASE WHEN tipo='receita' AND status='pendente'
          AND data_vencimento >= '${hojeStr}' THEN valor END),0)                                   AS receitas_previstas,
        COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pendente'
          AND data_vencimento >= '${hojeStr}' THEN valor END),0)                                   AS despesas_previstas
      FROM lancamentos WHERE status != 'cancelado'
    `);

    const anterior = await db.get(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='receita' AND status='pago'
          AND LEFT(COALESCE(data_pagamento,''),7)='${mesAnt}' THEN valor END),0) AS recebido_mes,
        COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pago'
          AND LEFT(COALESCE(data_pagamento,''),7)='${mesAnt}' THEN valor END),0) AS pago_mes,
        COALESCE(SUM(CASE WHEN status='pago' AND LEFT(data_vencimento,7)='${mesAnt}'
          THEN CASE WHEN tipo='receita' THEN valor ELSE -valor END END),0) AS lucro_mes
      FROM lancamentos WHERE status != 'cancelado'
    `);

    const alertasVenc = await db.all(`
      SELECT l.id, l.descricao, l.valor, l.tipo, l.data_vencimento, l.status,
             c.nome as cliente_nome
      FROM lancamentos l
      LEFT JOIN clientes c ON c.id = l.cliente_id
      WHERE l.status = 'pendente' AND l.data_vencimento <= '${depoisAm}'
      ORDER BY l.data_vencimento ASC LIMIT 20
    `);

    const saldo = await db.get(`
      SELECT COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END),0) AS saldo
      FROM lancamentos WHERE status='pago'
    `);

    const pct = (a, b) => b > 0 ? +((a - b) / b * 100).toFixed(1) : null;
    const hoje_   = alertasVenc.filter(l => l.data_vencimento === hojeStr);
    const amanha  = alertasVenc.filter(l => l.data_vencimento === amanhStr);
    const vencidos = alertasVenc.filter(l => l.data_vencimento < hojeStr);

    res.json({
      saldo_caixa:        +saldo.saldo,
      a_receber:          +atual.a_receber,
      a_pagar:            +atual.a_pagar,
      recebido_mes:       +atual.recebido_mes,
      pago_mes:           +atual.pago_mes,
      lucro_mes:          +atual.lucro_mes,
      vencidos_qtd:       +atual.vencidos_qtd,
      vencidos_valor:     +atual.vencidos_valor,
      receitas_previstas: +atual.receitas_previstas,
      despesas_previstas: +atual.despesas_previstas,
      variacao: {
        recebido_mes: pct(+atual.recebido_mes, +anterior.recebido_mes),
        pago_mes:     pct(+atual.pago_mes,     +anterior.pago_mes),
        lucro_mes:    pct(+atual.lucro_mes,    +anterior.lucro_mes),
      },
      alertas: { hoje: hoje_, amanha, vencidos },
    });
  } catch (err) {
    console.error('[dashboard] ERRO:', err.message, '\nStack:', err.stack?.split('\n')[1]);
    res.status(500).json({ erro: 'Erro ao carregar dashboard financeiro' });
  }
});

/* ════════════════════════════════════════════════════════════════
   FLUXO DIÁRIO
   ════════════════════════════════════════════════════════════════ */
router.get('/fluxo-diario', async (req, res) => {
  try {
    const hoje   = new Date().toISOString().split('T')[0];
    const inicio = req.query.inicio || hoje.slice(0,7) + '-01';
    const fim    = req.query.fim    || hoje.slice(0,7) + '-31';

    const saldoBase = await db.get(`
      SELECT COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END),0) AS saldo
      FROM lancamentos
      WHERE status='pago' AND data_pagamento IS NOT NULL
        AND data_pagamento < '${inicio}' AND status != 'cancelado'
    `);

    const itens = await db.all(`
      SELECT
        CASE WHEN status='pago' AND data_pagamento IS NOT NULL
             THEN data_pagamento ELSE data_vencimento END AS dia,
        l.id, l.descricao, l.valor, l.tipo, l.status,
        l.forma_pagamento, l.origem, l.parcela_num, l.parcela_total,
        c.nome AS cliente_nome, f.nome AS fornecedor_nome,
        cat.nome AS categoria_nome, cat.cor AS categoria_cor
      FROM lancamentos l
      LEFT JOIN clientes c     ON c.id = l.cliente_id
      LEFT JOIN fornecedores f  ON f.id = l.fornecedor_id
      LEFT JOIN categorias cat  ON cat.id = l.categoria_id
      WHERE l.status != 'cancelado'
        AND (
          (l.status = 'pago' AND l.data_pagamento IS NOT NULL
            AND l.data_pagamento BETWEEN '${inicio}' AND '${fim}')
          OR
          (l.status IN ('pendente','atrasado')
            AND l.data_vencimento BETWEEN '${inicio}' AND '${fim}')
        )
      ORDER BY dia ASC, l.id ASC
    `);

    const porDia = {};
    itens.forEach(l => {
      const d = String(l.dia).slice(0,10);
      if (!porDia[d]) porDia[d] = { data: d, entradas: 0, saidas: 0, itens: [] };
      const val = +l.valor;
      if (l.tipo === 'receita') porDia[d].entradas += val;
      else                      porDia[d].saidas   += val;
      porDia[d].itens.push(l);
    });

    let saldo = +saldoBase.saldo;
    const dias = Object.values(porDia).map(d => {
      saldo += d.entradas - d.saidas;
      return { ...d, saldo_acumulado: +saldo.toFixed(2) };
    });

    res.json({ saldo_inicial: +saldoBase.saldo, dias, inicio, fim });
  } catch (err) {
    console.error('[fluxo-diario]', err.message);
    res.status(500).json({ erro: 'Erro ao carregar fluxo diário' });
  }
});

/* ════════════════════════════════════════════════════════════════
   ALERTAS
   ════════════════════════════════════════════════════════════════ */
router.get('/alertas', async (req, res) => {
  try {
    const hoje  = new Date().toISOString().split('T')[0];
    const amanha = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    const [hojeList, amanhaList, vencidos, saldoRow] = await Promise.all([
      db.all(`SELECT l.id, l.descricao, l.valor, l.tipo, c.nome as cliente_nome
              FROM lancamentos l LEFT JOIN clientes c ON c.id=l.cliente_id
              WHERE l.status='pendente' AND l.data_vencimento = '${hoje}' LIMIT 10`),
      db.all(`SELECT l.id, l.descricao, l.valor, l.tipo, c.nome as cliente_nome
              FROM lancamentos l LEFT JOIN clientes c ON c.id=l.cliente_id
              WHERE l.status='pendente' AND l.data_vencimento = '${amanha}' LIMIT 10`),
      db.all(`SELECT l.id, l.descricao, l.valor, l.tipo, l.data_vencimento,
                     c.nome as cliente_nome
              FROM lancamentos l LEFT JOIN clientes c ON c.id=l.cliente_id
              WHERE l.status='pendente' AND l.data_vencimento < '${hoje}'
              ORDER BY l.data_vencimento ASC LIMIT 20`),
      db.get(`SELECT COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END),0) AS saldo
              FROM lancamentos WHERE status='pago'`),
    ]);

    res.json({
      vencem_hoje:   hojeList,
      vencem_amanha: amanhaList,
      vencidos,
      saldo_caixa:   +saldoRow.saldo,
      saldo_baixo:   +saldoRow.saldo < 5000,
    });
  } catch (err) {
    console.error('[alertas]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar alertas' });
  }
});

/* ════════════════════════════════════════════════════════════════
   CATEGORIAS
   ════════════════════════════════════════════════════════════════ */
router.get('/categorias', async (req, res) => {
  try {
    const { tipo } = req.query;
    let sql = `SELECT * FROM categorias WHERE ativa = 1`;
    const params = [];
    if (tipo) { sql += ' AND tipo = $1'; params.push(tipo); }
    sql += ' ORDER BY tipo, nome';
    res.json(await db.all(sql, params));
  } catch (err) {
    console.error('[categorias]', err.message);
    res.status(500).json({ erro: 'Erro ao listar categorias' });
  }
});

router.post('/categorias', async (req, res) => {
  try {
    const { nome, tipo, cor, icone, centro_custo_id } = req.body;
    if (!nome || !tipo) return res.status(400).json({ erro: 'Nome e tipo são obrigatórios' });
    const id = await db.insert(
      'INSERT INTO categorias (nome, tipo, cor, icone, centro_custo_id) VALUES ($1,$2,$3,$4,$5)',
      [nome, tipo, cor || '#6366f1', icone || null, centro_custo_id || null]
    );
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao criar categoria' });
  }
});

router.put('/categorias/:id', async (req, res) => {
  try {
    const { nome, cor, icone, centro_custo_id } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
    await db.run('UPDATE categorias SET nome=$1, cor=$2, icone=$3, centro_custo_id=$4 WHERE id=$5',
      [nome, cor, icone || null, centro_custo_id || null, req.params.id]);
    res.json({ mensagem: 'Categoria atualizada' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar categoria' });
  }
});

router.delete('/categorias/:id', async (req, res) => {
  try {
    await db.run('UPDATE categorias SET ativa=0 WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Categoria removida' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover categoria' });
  }
});

/* ════════════════════════════════════════════════════════════════
   CENTROS DE CUSTO
   ════════════════════════════════════════════════════════════════ */
router.get('/centros-custo', async (req, res) => {
  try {
    res.json(await db.all('SELECT * FROM fin_centros_custo WHERE ativo=true ORDER BY nome'));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar centros de custo' });
  }
});

router.post('/centros-custo', async (req, res) => {
  try {
    const { nome, cor } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
    const id = await db.insert('INSERT INTO fin_centros_custo (nome, cor) VALUES ($1,$2)', [nome, cor || '#6366f1']);
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao criar centro de custo' });
  }
});

router.put('/centros-custo/:id', async (req, res) => {
  try {
    const { nome, cor } = req.body;
    await db.run('UPDATE fin_centros_custo SET nome=$1, cor=$2 WHERE id=$3', [nome, cor, req.params.id]);
    res.json({ mensagem: 'Centro de custo atualizado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar centro de custo' });
  }
});

/* ════════════════════════════════════════════════════════════════
   CONTAS CORRENTES
   ════════════════════════════════════════════════════════════════ */
router.get('/contas', async (req, res) => {
  try {
    const contas = await db.all('SELECT * FROM contas_correntes WHERE ativa = 1 ORDER BY nome');
    const comSaldo = await Promise.all(contas.map(async c => {
      const e = await db.get(`SELECT COALESCE(SUM(valor),0) as t FROM lancamentos WHERE conta_id=$1 AND tipo='receita' AND status='pago'`, [c.id]);
      const s = await db.get(`SELECT COALESCE(SUM(valor),0) as t FROM lancamentos WHERE conta_id=$1 AND tipo='despesa' AND status='pago'`, [c.id]);
      return { ...c, saldo_atual: +(c.saldo_inicial || 0) + +e.t - +s.t };
    }));
    res.json(comSaldo);
  } catch (err) {
    console.error('[contas]', err.message);
    res.status(500).json({ erro: 'Erro ao listar contas' });
  }
});

router.post('/contas', async (req, res) => {
  try {
    const { nome, tipo, banco, agencia, numero_conta, saldo_inicial, cor, pix, saldo_minimo, observacoes } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
    const id = await db.insert(
      `INSERT INTO contas_correntes (nome, tipo, banco, agencia, numero_conta, saldo_inicial, cor, pix, saldo_minimo, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [nome, tipo || 'corrente', banco || null, agencia || null, numero_conta || null,
       saldo_inicial || 0, cor || '#6366f1', pix || null, saldo_minimo || 0, observacoes || null]
    );
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao criar conta' });
  }
});

router.put('/contas/:id', async (req, res) => {
  try {
    const { nome, banco, agencia, numero_conta, cor, pix, saldo_inicial, saldo_minimo, observacoes } = req.body;
    await db.run(`UPDATE contas_correntes SET nome=$1, banco=$2, agencia=$3, numero_conta=$4, cor=$5, pix=$6,
      saldo_inicial=COALESCE($7,saldo_inicial), saldo_minimo=COALESCE($8,saldo_minimo), observacoes=$9 WHERE id=$10`,
      [nome, banco, agencia, numero_conta, cor, pix, saldo_inicial ?? null, saldo_minimo ?? null, observacoes || null, req.params.id]);
    res.json({ mensagem: 'Conta atualizada' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar conta' });
  }
});

router.delete('/contas/:id', async (req, res) => {
  try {
    await db.run('UPDATE contas_correntes SET ativa=0 WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Conta desativada' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao desativar conta' });
  }
});

/* ── Transferência entre contas ── */
router.post('/transferencias', async (req, res) => {
  try {
    const { conta_origem_id, conta_destino_id, valor, data, descricao } = req.body;
    if (!conta_origem_id || !conta_destino_id || !valor)
      return res.status(400).json({ erro: 'Origem, destino e valor são obrigatórios' });

    const dataStr = data || new Date().toISOString().split('T')[0];
    const grpId   = uuid();

    await Promise.all([
      db.run(`INSERT INTO lancamentos (tipo, descricao, valor, data_vencimento, data_pagamento, status, conta_id, origem, grupo_parcela_id)
              VALUES ('despesa',$1,$2,$3,$3,'pago',$4,'transferencia',$5)`,
             [`Transferência → ${descricao||''}`, valor, dataStr, conta_origem_id, grpId]),
      db.run(`INSERT INTO lancamentos (tipo, descricao, valor, data_vencimento, data_pagamento, status, conta_id, origem, grupo_parcela_id)
              VALUES ('receita',$1,$2,$3,$3,'pago',$4,'transferencia',$5)`,
             [`Transferência ← ${descricao||''}`, valor, dataStr, conta_destino_id, grpId]),
      db.run('INSERT INTO fin_transferencias (conta_origem_id, conta_destino_id, valor, data, descricao) VALUES ($1,$2,$3,$4,$5)',
             [conta_origem_id, conta_destino_id, valor, dataStr, descricao || null]),
    ]);

    res.status(201).json({ mensagem: 'Transferência realizada' });
  } catch (err) {
    console.error('[transferencia]', err.message);
    res.status(500).json({ erro: 'Erro ao realizar transferência' });
  }
});

/* ════════════════════════════════════════════════════════════════
   LANÇAMENTOS
   ════════════════════════════════════════════════════════════════ */
router.get('/lancamentos', async (req, res) => {
  try {
    const { tipo, status, inicio, fim, forma_pagamento, conta_id, cliente_id,
            vencido, busca, categoria_id, centro_custo_id, origem } = req.query;
    const hoje = new Date().toISOString().split('T')[0];

    let sql = `
      SELECT l.*,
             cat.nome  AS categoria_nome, cat.cor AS categoria_cor,
             cc.nome   AS conta_nome,
             cli.nome  AS cliente_nome,
             forn.nome AS fornecedor_nome,
             fcc.nome  AS centro_custo_nome
      FROM lancamentos l
      LEFT JOIN categorias         cat  ON cat.id  = l.categoria_id
      LEFT JOIN contas_correntes   cc   ON cc.id   = l.conta_id
      LEFT JOIN clientes           cli  ON cli.id  = l.cliente_id
      LEFT JOIN fornecedores       forn ON forn.id = l.fornecedor_id
      LEFT JOIN fin_centros_custo  fcc  ON fcc.id  = l.centro_custo_id
      WHERE l.status != 'cancelado'
    `;
    const params = [];
    let idx = 1;

    // IDs e textos de busca via params (podem ser input do usuário)
    if (tipo)            { sql += ` AND l.tipo=$${idx++}`;            params.push(tipo); }
    if (conta_id)        { sql += ` AND l.conta_id=$${idx++}`;        params.push(conta_id); }
    if (cliente_id)      { sql += ` AND l.cliente_id=$${idx++}`;      params.push(cliente_id); }
    if (categoria_id)    { sql += ` AND l.categoria_id=$${idx++}`;    params.push(categoria_id); }
    if (centro_custo_id) { sql += ` AND l.centro_custo_id=$${idx++}`; params.push(centro_custo_id); }
    if (forma_pagamento) { sql += ` AND l.forma_pagamento=$${idx++}`; params.push(forma_pagamento); }
    if (origem)          { sql += ` AND l.origem=$${idx++}`;          params.push(origem); }
    if (busca)           { sql += ` AND l.descricao ILIKE $${idx++}`; params.push(`%${busca}%`); }

    // Datas interpoladas — sempre vêm do front no formato YYYY-MM-DD via query string
    if (inicio) { const d = String(inicio).slice(0,10).replace(/[^0-9-]/g,''); sql += ` AND l.data_vencimento>='${d}'`; }
    if (fim)    { const d = String(fim).slice(0,10).replace(/[^0-9-]/g,'');    sql += ` AND l.data_vencimento<='${d}'`; }

    if (vencido === '1') {
      sql += ` AND l.status='pendente' AND l.data_vencimento<'${hoje}'`;
    } else if (status === 'a_vencer') {
      sql += ` AND l.status='pendente' AND l.data_vencimento>='${hoje}'`;
    } else if (status) {
      sql += ` AND l.status=$${idx++}`;
      params.push(status);
    }

    const limite = Math.min(Math.max(parseInt(req.query.limite) || 500, 1), 2000);
    sql += ` ORDER BY l.data_vencimento ASC LIMIT $${idx}`;
    params.push(limite);

    res.json(await db.all(sql, params));
  } catch (err) {
    console.error('[lancamentos GET]', err.message);
    res.status(500).json({ erro: 'Erro ao listar lançamentos' });
  }
});

router.post('/lancamentos', async (req, res) => {
  try {
    const {
      tipo, descricao, valor, data_vencimento,
      forma_pagamento, conta_id, categoria_id, observacoes,
      cliente_id, fornecedor_id, orcamento_id, pedido_id,
      centro_custo_id, num_documento, origem = 'manual',
      recorrencia = 'unica',
      parcelas = 1,
      valor_entrada = 0,
    } = req.body;

    if (!tipo || !descricao || !valor || !data_vencimento)
      return res.status(400).json({ erro: 'Campos obrigatórios: tipo, descrição, valor, vencimento' });
    if (!['receita','despesa'].includes(tipo))
      return res.status(400).json({ erro: 'Tipo inválido' });

    const valorNum    = parseFloat(valor);
    const entradaNum  = parseFloat(valor_entrada) || 0;
    const numParcelas = Math.max(1, parseInt(parcelas) || 1);

    if (isNaN(valorNum) || valorNum <= 0)
      return res.status(400).json({ erro: 'Valor inválido' });

    const inserir = (vals) => db.run(
      `INSERT INTO lancamentos
        (tipo, descricao, valor, data_vencimento, forma_pagamento, conta_id,
         categoria_id, observacoes, cliente_id, fornecedor_id, orcamento_id,
         pedido_id, centro_custo_id, num_documento, origem, recorrencia,
         parcela_num, parcela_total, grupo_parcela_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      vals
    );

    const base = [tipo, descricao, 0, data_vencimento,
                  forma_pagamento||null, conta_id||null, categoria_id||null,
                  observacoes||null, cliente_id||null, fornecedor_id||null,
                  orcamento_id||null, pedido_id||null, centro_custo_id||null,
                  num_documento||null, origem, recorrencia];

    if (numParcelas <= 1 && entradaNum === 0) {
      await db.run(
        `INSERT INTO lancamentos
          (tipo, descricao, valor, data_vencimento, forma_pagamento, conta_id,
           categoria_id, observacoes, cliente_id, fornecedor_id, orcamento_id,
           pedido_id, centro_custo_id, num_documento, origem, recorrencia)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [tipo, descricao, valorNum, data_vencimento,
         forma_pagamento||null, conta_id||null, categoria_id||null,
         observacoes||null, cliente_id||null, fornecedor_id||null,
         orcamento_id||null, pedido_id||null, centro_custo_id||null,
         num_documento||null, origem, recorrencia]
      );
      return res.status(201).json({ mensagem: 'Lançamento criado' });
    }

    const grupoId = uuid();

    if (entradaNum > 0) {
      await inserir([...base, entradaNum, 0, numParcelas + 1, grupoId]);
    }

    const valorRest = valorNum - entradaNum;
    const valorParc = +(valorRest / numParcelas).toFixed(2);
    const dataBase  = new Date(data_vencimento + 'T12:00:00');

    for (let i = 0; i < numParcelas; i++) {
      const dataVenc = new Date(dataBase);
      dataVenc.setMonth(dataVenc.getMonth() + i);
      const vencStr = dataVenc.toISOString().split('T')[0];
      const descParcela = numParcelas > 1 ? `${descricao} (${i+1}/${numParcelas})` : descricao;
      await inserir([tipo, descParcela, valorParc, vencStr,
                     forma_pagamento||null, conta_id||null, categoria_id||null,
                     observacoes||null, cliente_id||null, fornecedor_id||null,
                     orcamento_id||null, pedido_id||null, centro_custo_id||null,
                     num_documento||null, origem, recorrencia,
                     i+1, numParcelas, grupoId]);
    }

    res.status(201).json({ grupo_parcela_id: grupoId, parcelas: numParcelas });
  } catch (err) {
    console.error('[lancamentos POST]', err.message);
    res.status(500).json({ erro: 'Erro ao criar lançamento' });
  }
});

router.put('/lancamentos/:id', async (req, res) => {
  try {
    const { descricao, valor, data_vencimento, forma_pagamento, conta_id,
            categoria_id, observacoes, cliente_id, fornecedor_id, centro_custo_id, num_documento } = req.body;
    const valorNum = parseFloat(valor);
    if (!descricao || isNaN(valorNum) || valorNum <= 0 || !data_vencimento)
      return res.status(400).json({ erro: 'Campos inválidos' });
    await db.run(`UPDATE lancamentos SET descricao=$1, valor=$2, data_vencimento=$3,
                  forma_pagamento=$4, conta_id=$5, categoria_id=$6, observacoes=$7,
                  cliente_id=$8, fornecedor_id=$9, centro_custo_id=$10, num_documento=$11
                  WHERE id=$12`,
      [descricao, valorNum, data_vencimento, forma_pagamento||null, conta_id||null,
       categoria_id||null, observacoes||null, cliente_id||null, fornecedor_id||null,
       centro_custo_id||null, num_documento||null, req.params.id]);
    res.json({ mensagem: 'Lançamento atualizado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar lançamento' });
  }
});

router.put('/lancamentos/:id/pagar', async (req, res) => {
  try {
    const { data_pagamento, forma_pagamento, conta_id } = req.body;
    const dataStr = data_pagamento || new Date().toISOString().split('T')[0];
    await db.run(
      `UPDATE lancamentos SET status='pago', data_pagamento=$1, forma_pagamento=$2,
       conta_id=COALESCE($3::integer, conta_id) WHERE id=$4`,
      [dataStr, forma_pagamento||null, conta_id||null, req.params.id]
    );
    await db.run('INSERT INTO fin_log (lancamento_id, usuario_id, acao, detalhe) VALUES ($1,$2,$3,$4)',
      [req.params.id, req.usuario?.id || null, 'pago',
       JSON.stringify({ data: dataStr, forma: forma_pagamento })]);
    res.json({ mensagem: 'Lançamento marcado como pago' });
  } catch (err) {
    console.error('[pagar]', err.message);
    res.status(500).json({ erro: 'Erro ao pagar lançamento' });
  }
});

router.put('/lancamentos/grupo/:grupoId/pagar', async (req, res) => {
  try {
    const { data_pagamento, forma_pagamento, conta_id } = req.body;
    const dataStr = data_pagamento || new Date().toISOString().split('T')[0];
    await db.run(
      `UPDATE lancamentos SET status='pago', data_pagamento=$1, forma_pagamento=$2,
       conta_id=COALESCE($3::integer, conta_id)
       WHERE grupo_parcela_id=$4 AND status='pendente'`,
      [dataStr, forma_pagamento||null, conta_id||null, req.params.grupoId]
    );
    res.json({ mensagem: 'Todas as parcelas marcadas como pagas' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao pagar grupo de parcelas' });
  }
});

router.delete('/lancamentos/:id', async (req, res) => {
  try {
    await db.run(`UPDATE lancamentos SET status='cancelado' WHERE id=$1`, [req.params.id]);
    res.json({ mensagem: 'Lançamento cancelado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao cancelar lançamento' });
  }
});

/* ════════════════════════════════════════════════════════════════
   FLUXO DE CAIXA (compat. frontend existente)
   ════════════════════════════════════════════════════════════════ */
router.get('/fluxo', async (req, res) => {
  try {
    const hoje   = new Date();
    const inicio = req.query.inicio || `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-01`;
    const fim    = req.query.fim    || `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-31`;

    const dias = await db.all(`
      SELECT data_vencimento AS data,
        SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END) as entradas,
        SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END) as saidas
      FROM lancamentos
      WHERE data_vencimento BETWEEN '${inicio}' AND '${fim}' AND status != 'cancelado'
      GROUP BY data_vencimento ORDER BY data_vencimento ASC
    `);

    const totais = await db.get(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='receita' AND status='pago' THEN valor ELSE 0 END),0) as recebido,
        COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pago' THEN valor ELSE 0 END),0) as pago,
        COALESCE(SUM(CASE WHEN tipo='receita' AND status='pendente' THEN valor ELSE 0 END),0) as a_receber,
        COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pendente' THEN valor ELSE 0 END),0) as a_pagar
      FROM lancamentos WHERE data_vencimento BETWEEN '${inicio}' AND '${fim}' AND status != 'cancelado'
    `);

    res.json({ dias, totais, inicio, fim });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar fluxo de caixa' });
  }
});

/* ════════════════════════════════════════════════════════════════
   RESUMO
   ════════════════════════════════════════════════════════════════ */
router.get('/resumo', async (req, res) => {
  try {
    const mes  = req.query.mes || new Date().toISOString().slice(0,7);
    const hoje = new Date().toISOString().split('T')[0];
    const dados = await db.get(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='receita' AND status='pago'
          AND LEFT(COALESCE(data_pagamento,''),7)='${mes}' THEN valor END),0) AS receita_realizada,
        COALESCE(SUM(CASE WHEN tipo='receita' AND status='pendente' THEN valor END),0) AS a_receber,
        COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pendente' THEN valor END),0) AS a_pagar,
        COUNT(CASE WHEN status='pendente' AND data_vencimento < '${hoje}' THEN 1 END)  AS atrasados
      FROM lancamentos WHERE status != 'cancelado'
    `);
    res.json(dados);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar resumo' });
  }
});

/* ════════════════════════════════════════════════════════════════
   RENTABILIDADE POR PROJETO
   ════════════════════════════════════════════════════════════════ */
router.get('/rentabilidade/:pedidoId', async (req, res) => {
  try {
    const id = req.params.pedidoId;
    const [pedido, custos, receitas, comissoes] = await Promise.all([
      db.get(`SELECT p.*, c.nome as cliente_nome FROM pedidos p LEFT JOIN clientes c ON c.id=p.cliente_id WHERE p.id=$1`, [id]),
      db.all('SELECT * FROM fin_custo_projeto WHERE pedido_id=$1', [id]),
      db.get(`SELECT COALESCE(SUM(valor),0) AS total FROM lancamentos WHERE pedido_id=$1 AND tipo='receita' AND status='pago'`, [id]),
      db.get(`SELECT COALESCE(SUM(valor_comissao),0) AS total FROM fin_comissoes WHERE pedido_id=$1`, [id]),
    ]);
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });
    const valorVendido  = +pedido.valor_final || 0;
    const custoTotal    = custos.reduce((s,c) => s + +c.valor, 0);
    const comissaoTotal = +comissoes.total;
    const lucroBruto    = valorVendido - custoTotal;
    const lucroLiquido  = lucroBruto - comissaoTotal;
    const margemPct     = valorVendido > 0 ? +((lucroLiquido / valorVendido) * 100).toFixed(1) : 0;
    res.json({
      pedido, custos,
      valor_vendido:    valorVendido,
      custo_total:      +custoTotal.toFixed(2),
      comissao_total:   +comissaoTotal.toFixed(2),
      lucro_bruto:      +lucroBruto.toFixed(2),
      lucro_liquido:    +lucroLiquido.toFixed(2),
      margem_pct:       margemPct,
      receita_realizada:+receitas.total,
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao calcular rentabilidade' });
  }
});

/* ════════════════════════════════════════════════════════════════
   COMISSÕES
   ════════════════════════════════════════════════════════════════ */
router.get('/comissoes', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `SELECT fc.*, u.nome as usuario_nome, p.numero as pedido_numero,
                      cli.nome as cliente_nome
               FROM fin_comissoes fc
               LEFT JOIN usuarios u   ON u.id  = fc.usuario_id
               LEFT JOIN pedidos  p   ON p.id  = fc.pedido_id
               LEFT JOIN clientes cli ON cli.id = p.cliente_id
               WHERE 1=1`;
    const params = [];
    if (status) { sql += ` AND fc.status=$1`; params.push(status); }
    sql += ' ORDER BY fc.criado_em DESC';
    res.json(await db.all(sql, params));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar comissões' });
  }
});

router.put('/comissoes/:id/liberar', async (req, res) => {
  try {
    await db.run(`UPDATE fin_comissoes SET status='a_liberar' WHERE id=$1`, [req.params.id]);
    res.json({ mensagem: 'Comissão liberada' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao liberar comissão' });
  }
});

router.put('/comissoes/:id/pagar', async (req, res) => {
  try {
    const data = req.body.data_pagamento || new Date().toISOString().split('T')[0];
    await db.run(`UPDATE fin_comissoes SET status='pago', data_pagamento=$1 WHERE id=$2`, [data, req.params.id]);
    res.json({ mensagem: 'Comissão paga' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao pagar comissão' });
  }
});

/* ════════════════════════════════════════════════════════════════
   PROJEÇÃO
   ════════════════════════════════════════════════════════════════ */
router.get('/projecao', async (req, res) => {
  try {
    const dias  = parseInt(req.query.dias) || 90;
    const hoje  = new Date().toISOString().split('T')[0];
    const fim   = new Date(Date.now() + dias * 86400000).toISOString().split('T')[0];
    const [lancamentos, saldoRow] = await Promise.all([
      db.all(`SELECT data_vencimento AS data,
                SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END) as entradas,
                SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END) as saidas
              FROM lancamentos WHERE status='pendente'
                AND data_vencimento BETWEEN '${hoje}' AND '${fim}'
              GROUP BY data_vencimento ORDER BY data_vencimento ASC`),
      db.get(`SELECT COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END),0) as saldo
              FROM lancamentos WHERE status='pago'`),
    ]);
    let saldoAcum = +saldoRow.saldo;
    const projecao = lancamentos.map(l => {
      saldoAcum += +l.entradas - +l.saidas;
      return { ...l, saldo_acumulado: +saldoAcum.toFixed(2) };
    });
    res.json({ saldo_atual: +saldoRow.saldo, projecao, dias });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao calcular projeção' });
  }
});

/* ════════════════════════════════════════════════════════════════
   DRE
   ════════════════════════════════════════════════════════════════ */
router.get('/dre', async (req, res) => {
  try {
    const hoje = new Date();
    const ano  = req.query.ano || hoje.getFullYear();
    const mes  = req.query.mes || String(hoje.getMonth()+1).padStart(2,'0');
    const periodo = `${ano}-${mes}`;
    const [receitas, despesas, vendas] = await Promise.all([
      db.all(`SELECT COALESCE(SUM(l.valor),0) as total, cat.nome as categoria, cat.cor
              FROM lancamentos l LEFT JOIN categorias cat ON cat.id=l.categoria_id
              WHERE l.tipo='receita' AND l.status='pago'
                AND LEFT(COALESCE(l.data_pagamento,''),7)='${periodo}'
              GROUP BY cat.nome, cat.cor ORDER BY total DESC`),
      db.all(`SELECT COALESCE(SUM(l.valor),0) as total, cat.nome as categoria, cat.cor
              FROM lancamentos l LEFT JOIN categorias cat ON cat.id=l.categoria_id
              WHERE l.tipo='despesa' AND l.status='pago'
                AND LEFT(COALESCE(l.data_pagamento,''),7)='${periodo}'
              GROUP BY cat.nome, cat.cor ORDER BY total DESC`),
      db.get(`SELECT COALESCE(SUM(valor_final),0) as total, COUNT(*) as qtd FROM pedidos
              WHERE status NOT IN ('cancelado')
                AND TO_CHAR(criado_em,'YYYY-MM')='${periodo}'`),
    ]);
    const totalR = receitas.reduce((s,r) => s + +r.total, 0);
    const totalD = despesas.reduce((s,r) => s + +r.total, 0);
    const lucro  = totalR - totalD;
    const mesAnt = new Date(+ano, +mes-2, 1);
    const pAnt   = `${mesAnt.getFullYear()}-${String(mesAnt.getMonth()+1).padStart(2,'0')}`;
    const ant = await db.get(`SELECT
      COALESCE(SUM(CASE WHEN tipo='receita' THEN valor ELSE 0 END),0) as receitas,
      COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor ELSE 0 END),0) as despesas
      FROM lancamentos WHERE status='pago'
        AND LEFT(COALESCE(data_pagamento,''),7)='${pAnt}'`);
    res.json({ periodo, receitas, despesas, vendas,
      totais:{ receitas:totalR, despesas:totalD, lucro, margem: totalR>0?Math.round(lucro/totalR*100):0 },
      anterior: ant });
  } catch (err) {
    console.error('[dre]', err.message);
    res.status(500).json({ erro: 'Erro ao gerar DRE' });
  }
});

/* ════════════════════════════════════════════════════════════════
   NOTAS FISCAIS
   ════════════════════════════════════════════════════════════════ */
router.get('/notas', async (req, res) => {
  try {
    const { tipo, status } = req.query;
    let sql = `SELECT n.*, c.nome as cliente_nome, p.numero as pedido_numero
               FROM notas_fiscais n
               LEFT JOIN clientes c ON c.id=n.cliente_id
               LEFT JOIN pedidos  p ON p.id=n.pedido_id WHERE 1=1`;
    const params = []; let idx = 1;
    if (tipo)   { sql += ` AND n.tipo=$${idx++}`;   params.push(tipo); }
    if (status) { sql += ` AND n.status=$${idx++}`; params.push(status); }
    sql += ' ORDER BY n.criado_em DESC';
    res.json(await db.all(sql, params));
  } catch (err) { res.status(500).json({ erro: 'Erro ao listar notas' }); }
});

router.get('/notas/:id', async (req, res) => {
  try {
    const n = await db.get(`SELECT n.*, c.nome as cliente_nome, p.numero as pedido_numero
      FROM notas_fiscais n LEFT JOIN clientes c ON c.id=n.cliente_id
      LEFT JOIN pedidos p ON p.id=n.pedido_id WHERE n.id=$1`, [req.params.id]);
    if (!n) return res.status(404).json({ erro: 'Nota não encontrada' });
    res.json(n);
  } catch (err) { res.status(500).json({ erro: 'Erro ao buscar nota' }); }
});

router.post('/notas', async (req, res) => {
  try {
    const { tipo, numero, serie, cliente_id, fornecedor, pedido_id,
            data_emissao, valor_total, impostos, chave_acesso, status, observacoes } = req.body;
    if (!tipo || !valor_total) return res.status(400).json({ erro: 'Tipo e valor são obrigatórios' });
    const id = await db.insert(`INSERT INTO notas_fiscais
      (tipo,numero,serie,cliente_id,fornecedor,pedido_id,data_emissao,valor_total,impostos,chave_acesso,status,observacoes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [tipo, numero, serie||'1', cliente_id||null, fornecedor||null, pedido_id||null,
       data_emissao||null, +valor_total, impostos||0, chave_acesso||null, status||'emitida', observacoes||null]);
    res.status(201).json({ id });
  } catch (err) { res.status(500).json({ erro: 'Erro ao criar nota' }); }
});

router.put('/notas/:id', async (req, res) => {
  try {
    const { status, valor_total, tipo, numero, serie, cliente_id, fornecedor,
            pedido_id, data_emissao, impostos, chave_acesso, observacoes } = req.body;
    if (status && !valor_total) {
      await db.run('UPDATE notas_fiscais SET status=$1 WHERE id=$2', [status, req.params.id]);
      return res.json({ mensagem: 'Nota atualizada' });
    }
    await db.run(`UPDATE notas_fiscais SET tipo=$1,numero=$2,serie=$3,cliente_id=$4,fornecedor=$5,
      pedido_id=$6,data_emissao=$7,valor_total=$8,impostos=$9,chave_acesso=$10,status=$11,observacoes=$12
      WHERE id=$13`,
      [tipo, numero, serie, cliente_id||null, fornecedor||null, pedido_id||null,
       data_emissao||null, +valor_total, impostos||0, chave_acesso||null,
       status||null, observacoes||null, req.params.id]);
    res.json({ mensagem: 'Nota atualizada' });
  } catch (err) { res.status(500).json({ erro: 'Erro ao atualizar nota' }); }
});

router.delete('/notas/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM notas_fiscais WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Nota excluída' });
  } catch (err) { res.status(500).json({ erro: 'Erro ao excluir nota' }); }
});

module.exports = router;
