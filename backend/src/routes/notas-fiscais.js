const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

const hoje = () => new Date().toISOString().split('T')[0];
const dStr = v => String(v || '').slice(0, 10).replace(/[^0-9-]/g, '');

// ─── Dashboard ───────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const mes = req.query.mes || hoje().slice(0, 7);
    const mesAnt = (() => {
      const [y, m] = mes.split('-').map(Number);
      return m === 1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2,'0')}`;
    })();

    const [atual, anterior, porStatus, impostos] = await Promise.all([
      db.get(`
        SELECT
          COUNT(*)                                                          AS total,
          COUNT(CASE WHEN status='autorizada'  THEN 1 END)                 AS emitidas,
          COUNT(CASE WHEN status='cancelada'   THEN 1 END)                 AS canceladas,
          COUNT(CASE WHEN status IN ('rascunho','pendente') THEN 1 END)    AS pendentes,
          COUNT(CASE WHEN status='rejeitada'   THEN 1 END)                 AS rejeitadas,
          COUNT(CASE WHEN tipo='entrada'       THEN 1 END)                 AS entradas,
          COUNT(CASE WHEN tipo='saida'         THEN 1 END)                 AS saidas,
          COALESCE(SUM(CASE WHEN status='autorizada' THEN valor_total ELSE 0 END),0) AS valor_faturado,
          COALESCE(SUM(CASE WHEN status='autorizada' THEN valor_icms  ELSE 0 END),0) AS total_icms,
          COALESCE(SUM(CASE WHEN status='autorizada' THEN valor_ipi   ELSE 0 END),0) AS total_ipi,
          COALESCE(SUM(CASE WHEN status='autorizada' THEN valor_pis   ELSE 0 END),0) AS total_pis,
          COALESCE(SUM(CASE WHEN status='autorizada' THEN valor_cofins ELSE 0 END),0) AS total_cofins,
          COALESCE(SUM(CASE WHEN status='autorizada' THEN valor_iss   ELSE 0 END),0) AS total_iss
        FROM notas_fiscais
        WHERE LEFT(COALESCE(data_emissao,''),7) = '${mes}'
      `),
      db.get(`
        SELECT
          COUNT(CASE WHEN status='autorizada' THEN 1 END) AS emitidas,
          COALESCE(SUM(CASE WHEN status='autorizada' THEN valor_total ELSE 0 END),0) AS valor_faturado
        FROM notas_fiscais
        WHERE LEFT(COALESCE(data_emissao,''),7) = '${mesAnt}'
      `),
      db.all(`
        SELECT status, COUNT(*) AS qtd, COALESCE(SUM(valor_total),0) AS valor
        FROM notas_fiscais
        WHERE LEFT(COALESCE(data_emissao,''),7) = '${mes}'
        GROUP BY status
      `),
      db.all(`
        SELECT LEFT(COALESCE(data_emissao,''),7) AS mes,
               COALESCE(SUM(valor_total),0) AS faturado,
               COUNT(*) AS qtd
        FROM notas_fiscais
        WHERE status='autorizada'
          AND data_emissao >= '${(() => {
            const [y,m] = mes.split('-').map(Number);
            const d = new Date(y, m-7, 1);
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
          })()}'
        GROUP BY LEFT(COALESCE(data_emissao,''),7)
        ORDER BY 1
      `),
    ]);

    res.json({ atual, anterior, porStatus, historico: impostos });
  } catch (err) {
    console.error('[nf dashboard]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── Alertas ─────────────────────────────────────────────────────────────────
router.get('/alertas', async (req, res) => {
  try {
    const alertas = [];

    const rejeitadas = await db.all(`
      SELECT id, numero, motivo_rejeicao, data_emissao FROM notas_fiscais
      WHERE status='rejeitada' ORDER BY criado_em DESC LIMIT 5
    `);
    rejeitadas.forEach(n => alertas.push({
      tipo: 'erro', icon: 'x-circle',
      msg: `NF #${n.numero||'S/N'} rejeitada: ${n.motivo_rejeicao||'Erro na transmissão'}`,
      nota_id: n.id,
    }));

    const pendentes = await db.all(`
      SELECT id, numero FROM notas_fiscais WHERE status='pendente'
      ORDER BY criado_em DESC LIMIT 5
    `);
    pendentes.forEach(n => alertas.push({
      tipo: 'warning', icon: 'clock',
      msg: `NF #${n.numero||'S/N'} aguardando transmissão`,
      nota_id: n.id,
    }));

    const semCpfCnpj = await db.all(`
      SELECT nf.id, nf.numero, cli.nome FROM notas_fiscais nf
      JOIN clientes cli ON cli.id = nf.cliente_id
      WHERE (cli.cpf_cnpj IS NULL OR cli.cpf_cnpj='')
        AND nf.status NOT IN ('cancelada','rejeitada')
      LIMIT 3
    `);
    semCpfCnpj.forEach(n => alertas.push({
      tipo: 'warning', icon: 'user-x',
      msg: `NF #${n.numero||'S/N'} — cliente ${n.nome} sem CPF/CNPJ`,
      nota_id: n.id,
    }));

    const pedidosSemNF = await db.all(`
      SELECT p.id, p.numero FROM pedidos p
      WHERE p.status='concluido'
        AND p.deleted_at IS NULL
        AND p.id NOT IN (SELECT pedido_id FROM notas_fiscais WHERE pedido_id IS NOT NULL)
      LIMIT 5
    `);
    pedidosSemNF.forEach(p => alertas.push({
      tipo: 'info', icon: 'file-plus',
      msg: `Pedido #${p.numero} concluído sem nota fiscal`,
      pedido_id: p.id,
    }));

    res.json(alertas);
  } catch (err) {
    console.error('[nf alertas]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── GET / — listar notas ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, tipo, cliente_id, pedido_id, inicio, fim, busca, page = 1, limit = 50 } = req.query;
    let sql = `
      SELECT nf.*,
        cli.nome      AS cliente_nome, cli.cpf_cnpj,
        p.numero      AS pedido_numero,
        u.nome        AS usuario_nome
      FROM notas_fiscais nf
      LEFT JOIN clientes  cli ON cli.id = nf.cliente_id
      LEFT JOIN pedidos   p   ON p.id   = nf.pedido_id
      LEFT JOIN usuarios  u   ON u.id   = nf.usuario_id
      WHERE 1=1
    `;
    const params = []; let idx = 1;

    if (status)     { sql += ` AND nf.status=$${idx++}`;     params.push(status); }
    if (tipo)       { sql += ` AND nf.tipo=$${idx++}`;       params.push(tipo); }
    if (cliente_id) { sql += ` AND nf.cliente_id=$${idx++}`; params.push(cliente_id); }
    if (pedido_id)  { sql += ` AND nf.pedido_id=$${idx++}`;  params.push(pedido_id); }
    if (inicio)     { sql += ` AND nf.data_emissao>='${dStr(inicio)}'`; }
    if (fim)        { sql += ` AND nf.data_emissao<='${dStr(fim)}'`; }
    if (busca)      {
      sql += ` AND (cli.nome ILIKE $${idx} OR CAST(nf.numero AS TEXT) LIKE $${idx}
               OR nf.chave_acesso ILIKE $${idx} OR nf.natureza_operacao ILIKE $${idx})`;
      params.push(`%${busca}%`); idx++;
    }

    sql += ` ORDER BY nf.criado_em DESC LIMIT ${parseInt(limit)} OFFSET ${(parseInt(page)-1)*parseInt(limit)}`;
    res.json(await db.all(sql, params));
  } catch (err) {
    console.error('[nf GET]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── GET /pedidos/sem-nota — pedidos prontos para faturar ─────────────────────
router.get('/pedidos/sem-nota', async (req, res) => {
  try {
    const pedidos = await db.all(`
      SELECT p.*, cli.nome AS cliente_nome
      FROM pedidos p
      LEFT JOIN clientes cli ON cli.id = p.cliente_id
      WHERE p.status IN ('concluido','producao_concluida')
        AND p.deleted_at IS NULL
        AND p.id NOT IN (
          SELECT DISTINCT pedido_id FROM notas_fiscais
          WHERE pedido_id IS NOT NULL AND status NOT IN ('cancelada','rejeitada')
        )
      ORDER BY p.criado_em DESC
      LIMIT 50
    `);
    res.json(pedidos);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─── GET /:id — nota completa ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [nota, itens, eventos, logs] = await Promise.all([
      db.get(`
        SELECT nf.*,
          cli.nome      AS cliente_nome, cli.cpf_cnpj,
          cli.email     AS cliente_email, cli.telefone AS cliente_telefone,
          cli.rua       AS cliente_endereco, cli.cidade AS cliente_cidade,
          cli.estado    AS cliente_estado, cli.cep     AS cliente_cep,
          p.numero      AS pedido_numero,
          u.nome        AS usuario_nome
        FROM notas_fiscais nf
        LEFT JOIN clientes cli ON cli.id = nf.cliente_id
        LEFT JOIN pedidos  p   ON p.id   = nf.pedido_id
        LEFT JOIN usuarios u   ON u.id   = nf.usuario_id
        WHERE nf.id=$1
      `, [req.params.id]),
      db.all('SELECT * FROM nf_itens WHERE nota_id=$1 ORDER BY ordem', [req.params.id]),
      db.all('SELECT * FROM nf_eventos WHERE nota_id=$1 ORDER BY criado_em DESC', [req.params.id]),
      db.all(`
        SELECT nl.*, u.nome AS usuario_nome FROM nf_log nl
        LEFT JOIN usuarios u ON u.id = nl.usuario_id
        WHERE nl.nota_id=$1 ORDER BY nl.criado_em DESC LIMIT 20
      `, [req.params.id]),
    ]);
    if (!nota) return res.status(404).json({ erro: 'Nota não encontrada' });
    res.json({ ...nota, itens, eventos, logs });
  } catch (err) {
    console.error('[nf GET/:id]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── POST / — criar nota ──────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      tipo = 'saida', natureza_operacao, cfop, finalidade,
      cliente_id, fornecedor_id, pedido_id,
      data_emissao, data_saida, hora_saida,
      valor_produtos, valor_frete = 0, valor_seguro = 0,
      valor_desconto = 0, valor_outros = 0,
      valor_icms = 0, valor_ipi = 0, valor_pis = 0, valor_cofins = 0, valor_iss = 0,
      forma_pagamento, transportadora, placa_veiculo, uf_veiculo,
      observacoes, informacoes_adicionais, itens = [],
    } = req.body;

    const userId = req.usuario?.id || null;
    const valorTotal = (parseFloat(valor_produtos)||0)
      + (parseFloat(valor_frete)||0) + (parseFloat(valor_seguro)||0)
      + (parseFloat(valor_outros)||0) - (parseFloat(valor_desconto)||0);

    // Próximo número de série
    const ultimo = await db.get(`SELECT MAX(numero) AS max FROM notas_fiscais WHERE tipo=$1`, [tipo]);
    const numero = (parseInt(ultimo?.max)||0) + 1;

    const client = await db.pool.connect();
    let notaId;
    try {
      await client.query('BEGIN');
      const r = await client.query(`
        INSERT INTO notas_fiscais
          (numero, tipo, natureza_operacao, cfop, finalidade, status,
           cliente_id, fornecedor_id, pedido_id,
           data_emissao, data_saida, hora_saida,
           valor_produtos, valor_frete, valor_seguro, valor_desconto, valor_outros, valor_total,
           valor_icms, valor_ipi, valor_pis, valor_cofins, valor_iss,
           forma_pagamento, transportadora, placa_veiculo, uf_veiculo,
           observacoes, informacoes_adicionais, usuario_id)
        VALUES ($1,$2,$3,$4,$5,'rascunho',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
        RETURNING id
      `, [numero, tipo, natureza_operacao||'Venda de Mercadoria', cfop||'5102', finalidade||'1',
          cliente_id||null, fornecedor_id||null, pedido_id||null,
          data_emissao||hoje(), data_saida||null, hora_saida||null,
          parseFloat(valor_produtos)||0, parseFloat(valor_frete)||0,
          parseFloat(valor_seguro)||0, parseFloat(valor_desconto)||0,
          parseFloat(valor_outros)||0, valorTotal,
          parseFloat(valor_icms)||0, parseFloat(valor_ipi)||0,
          parseFloat(valor_pis)||0, parseFloat(valor_cofins)||0, parseFloat(valor_iss)||0,
          forma_pagamento||'outros', transportadora||null, placa_veiculo||null, uf_veiculo||null,
          observacoes||null, informacoes_adicionais||null, userId]);
      notaId = r.rows[0].id;

      for (let i = 0; i < itens.length; i++) {
        const it = itens[i];
        const vTotal = (parseFloat(it.quantidade)||1) * (parseFloat(it.valor_unitario)||0)
          - (parseFloat(it.valor_desconto)||0);
        await client.query(`
          INSERT INTO nf_itens (nota_id, produto_id, codigo, descricao, ncm, cfop, unidade,
            quantidade, valor_unitario, valor_desconto, valor_total,
            valor_icms, valor_ipi, valor_pis, valor_cofins,
            aliquota_icms, aliquota_ipi, aliquota_pis, aliquota_cofins,
            cst_icms, cst_pis, cst_cofins, csosn, ordem)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
        `, [notaId, it.produto_id||null, it.codigo||null, it.descricao, it.ncm||null,
            it.cfop||cfop||'5102', it.unidade||'UN',
            parseFloat(it.quantidade)||1, parseFloat(it.valor_unitario)||0,
            parseFloat(it.valor_desconto)||0, vTotal,
            parseFloat(it.valor_icms)||0, parseFloat(it.valor_ipi)||0,
            parseFloat(it.valor_pis)||0, parseFloat(it.valor_cofins)||0,
            parseFloat(it.aliquota_icms)||0, parseFloat(it.aliquota_ipi)||0,
            parseFloat(it.aliquota_pis)||0, parseFloat(it.aliquota_cofins)||0,
            it.cst_icms||'00', it.cst_pis||'01', it.cst_cofins||'01', it.csosn||null, i+1]);
      }

      await client.query(
        `INSERT INTO nf_log (nota_id, usuario_id, acao) VALUES ($1,$2,'criar')`,
        [notaId, userId]
      );
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    res.status(201).json({ id: notaId, numero, mensagem: 'Nota criada como rascunho' });
  } catch (err) {
    console.error('[nf POST]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── POST /gerar-de-pedido/:pedidoId ─────────────────────────────────────────
router.post('/gerar-de-pedido/:pedidoId', async (req, res) => {
  try {
    const pedido = await db.get(`
      SELECT p.*, cli.nome AS cliente_nome, cli.cpf_cnpj,
        cli.email AS cliente_email, cli.rua AS cliente_endereco
      FROM pedidos p
      LEFT JOIN clientes cli ON cli.id = p.cliente_id
      WHERE p.id=$1 AND p.deleted_at IS NULL
    `, [req.params.pedidoId]);
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });

    const itensPedido = await db.all(`
      SELECT ip.*, prod.nome AS prod_nome, prod.codigo, prod.ncm, prod.valor_custo AS preco_padrao
      FROM itens_pedido ip
      LEFT JOIN produtos prod ON prod.id = ip.produto_id
      WHERE ip.pedido_id=$1
    `, [req.params.pedidoId]);

    const itens = itensPedido.map((it, i) => ({
      produto_id: it.produto_id,
      codigo: it.codigo || String(it.produto_id||''),
      descricao: it.prod_nome || it.descricao || 'Produto',
      ncm: it.ncm || '',
      cfop: '5102',
      unidade: 'UN',
      quantidade: it.quantidade || 1,
      valor_unitario: it.preco_unitario || it.preco_padrao || 0,
      valor_desconto: 0,
      aliquota_icms: 12, aliquota_pis: 0.65, aliquota_cofins: 3,
      cst_icms: '00', cst_pis: '01', cst_cofins: '01',
      ordem: i + 1,
    }));

    const valorProdutos = itens.reduce((s, it) =>
      s + (parseFloat(it.quantidade)||1) * (parseFloat(it.valor_unitario)||0), 0);
    const valorIcms   = valorProdutos * 0.12;
    const valorPis    = valorProdutos * 0.0065;
    const valorCofins = valorProdutos * 0.03;

    const body = {
      tipo: 'saida',
      natureza_operacao: 'Venda de Mercadoria',
      cfop: '5102',
      cliente_id: pedido.cliente_id,
      pedido_id: pedido.id,
      data_emissao: hoje(),
      valor_produtos: valorProdutos,
      valor_icms: valorIcms,
      valor_pis: valorPis,
      valor_cofins: valorCofins,
      forma_pagamento: pedido.forma_pagamento || 'outros',
      observacoes: `Gerada automaticamente do Pedido #${pedido.numero}`,
      itens,
    };

    req.body = body;
    // Delegate to POST /
    const userId = req.usuario?.id || null;
    const ultimo = await db.get(`SELECT MAX(numero) AS max FROM notas_fiscais WHERE tipo='saida'`);
    const numero = (parseInt(ultimo?.max)||0) + 1;
    const valorTotal = valorProdutos;

    const notaId = await db.insert(`
      INSERT INTO notas_fiscais
        (numero, tipo, natureza_operacao, cfop, finalidade, status,
         cliente_id, pedido_id, data_emissao,
         valor_produtos, valor_total, valor_icms, valor_pis, valor_cofins,
         forma_pagamento, observacoes, usuario_id)
      VALUES ($1,'saida',$2,'5102','1','rascunho',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `, [numero, 'Venda de Mercadoria', pedido.cliente_id, pedido.id, hoje(),
        valorProdutos, valorTotal, valorIcms, valorPis, valorCofins,
        pedido.forma_pagamento||'outros',
        `Gerada automaticamente do Pedido #${pedido.numero}`, userId]);

    for (let i = 0; i < itens.length; i++) {
      const it = itens[i];
      const vt = (it.quantidade||1) * (it.valor_unitario||0);
      await db.run(`
        INSERT INTO nf_itens (nota_id, produto_id, codigo, descricao, ncm, cfop, unidade,
          quantidade, valor_unitario, valor_total, aliquota_icms, aliquota_pis, aliquota_cofins,
          cst_icms, cst_pis, cst_cofins, ordem)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      `, [notaId, it.produto_id||null, it.codigo||null, it.descricao, it.ncm||null,
          it.cfop, it.unidade, it.quantidade, it.valor_unitario, vt,
          it.aliquota_icms, it.aliquota_pis, it.aliquota_cofins,
          it.cst_icms, it.cst_pis, it.cst_cofins, i+1]);
    }

    await db.run(
      `INSERT INTO nf_log (nota_id, usuario_id, acao, detalhes) VALUES ($1,$2,'gerar-pedido',$3)`,
      [notaId, userId, JSON.stringify({ pedido_id: pedido.id, numero: pedido.numero })]
    );

    res.status(201).json({ id: notaId, numero, mensagem: 'Nota gerada do pedido (rascunho)' });
  } catch (err) {
    console.error('[nf gerar-pedido]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── POST /:id/emitir — simula transmissão SEFAZ ──────────────────────────────
router.post('/:id/emitir', async (req, res) => {
  try {
    const nota = await db.get('SELECT * FROM notas_fiscais WHERE id=$1', [req.params.id]);
    if (!nota) return res.status(404).json({ erro: 'Nota não encontrada' });
    if (!['rascunho','pendente','rejeitada'].includes(nota.status))
      return res.status(400).json({ erro: `Nota não pode ser emitida no status ${nota.status}` });

    // Gera chave de acesso simulada
    const chave = Array.from({ length: 44 }, () => Math.floor(Math.random() * 10)).join('');
    const protocolo = `1${Date.now()}`.slice(0, 15);
    const xml = gerarXmlSimulado(nota, chave);

    await db.run(`
      UPDATE notas_fiscais
      SET status='autorizada', chave_acesso=$1, protocolo=$2, xml=$3,
          data_emissao=COALESCE(data_emissao,$4), atualizado_em=NOW()
      WHERE id=$5
    `, [chave, protocolo, xml, hoje(), req.params.id]);

    // Criar lançamento financeiro automaticamente
    if (nota.cliente_id && nota.valor_total > 0) {
      const lancId = await db.insert(`
        INSERT INTO lancamentos
          (tipo, descricao, valor, data_vencimento, status, cliente_id, pedido_id, origem)
        VALUES ('receita',$1,$2,$3,'pendente',$4,$5,'nf')
      `, [`NF #${nota.numero} — ${req.body.cliente_nome||''}`,
          nota.valor_total, hoje(), nota.cliente_id, nota.pedido_id||null]);
      await db.run('UPDATE notas_fiscais SET lancamento_id=$1 WHERE id=$2', [lancId, req.params.id]);
    }

    await db.run(
      `INSERT INTO nf_log (nota_id, usuario_id, acao, detalhes) VALUES ($1,$2,'emitir',$3)`,
      [req.params.id, req.usuario?.id||null,
       JSON.stringify({ chave, protocolo, valor: nota.valor_total })]
    );
    await db.run(
      `INSERT INTO nf_eventos (nota_id, tipo, descricao, protocolo, status)
       VALUES ($1,'autorizacao','NF-e autorizada pela SEFAZ',$2,'autorizado')`,
      [req.params.id, protocolo]
    );

    res.json({ mensagem: 'Nota emitida com sucesso', chave, protocolo });
  } catch (err) {
    console.error('[nf emitir]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── POST /:id/cancelar ───────────────────────────────────────────────────────
router.post('/:id/cancelar', async (req, res) => {
  try {
    const { motivo } = req.body;
    if (!motivo || motivo.length < 15)
      return res.status(400).json({ erro: 'Motivo deve ter no mínimo 15 caracteres' });

    const nota = await db.get('SELECT * FROM notas_fiscais WHERE id=$1', [req.params.id]);
    if (!nota) return res.status(404).json({ erro: 'Nota não encontrada' });
    if (nota.status !== 'autorizada')
      return res.status(400).json({ erro: 'Apenas notas autorizadas podem ser canceladas' });

    await db.run(
      `UPDATE notas_fiscais SET status='cancelada', motivo_rejeicao=$1, atualizado_em=NOW() WHERE id=$2`,
      [motivo, req.params.id]
    );
    // Estornar lançamento financeiro
    if (nota.lancamento_id) {
      await db.run(`UPDATE lancamentos SET status='cancelado' WHERE id=$1`, [nota.lancamento_id]);
    }
    await db.run(
      `INSERT INTO nf_eventos (nota_id, tipo, descricao, status) VALUES ($1,'cancelamento',$2,'autorizado')`,
      [req.params.id, motivo]
    );
    await db.run(
      `INSERT INTO nf_log (nota_id, usuario_id, acao, detalhes) VALUES ($1,$2,'cancelar',$3)`,
      [req.params.id, req.usuario?.id||null, JSON.stringify({ motivo })]
    );

    res.json({ mensagem: 'Nota cancelada' });
  } catch (err) {
    console.error('[nf cancelar]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── POST /:id/carta-correcao ─────────────────────────────────────────────────
router.post('/:id/carta-correcao', async (req, res) => {
  try {
    const { descricao } = req.body;
    if (!descricao || descricao.length < 15)
      return res.status(400).json({ erro: 'Descrição deve ter no mínimo 15 caracteres' });

    const nota = await db.get('SELECT * FROM notas_fiscais WHERE id=$1', [req.params.id]);
    if (!nota || nota.status !== 'autorizada')
      return res.status(400).json({ erro: 'Apenas notas autorizadas permitem carta de correção' });

    const protocolo = `2${Date.now()}`.slice(0, 15);
    await db.run(
      `INSERT INTO nf_eventos (nota_id, tipo, descricao, protocolo, status)
       VALUES ($1,'carta_correcao',$2,$3,'autorizado')`,
      [req.params.id, descricao, protocolo]
    );
    await db.run(
      `INSERT INTO nf_log (nota_id, usuario_id, acao) VALUES ($1,$2,'carta_correcao')`,
      [req.params.id, req.usuario?.id||null]
    );

    res.json({ mensagem: 'Carta de Correção registrada', protocolo });
  } catch (err) {
    console.error('[nf carta-correcao]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── PATCH /:id — atualizar rascunho ─────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const nota = await db.get('SELECT * FROM notas_fiscais WHERE id=$1', [req.params.id]);
    if (!nota) return res.status(404).json({ erro: 'Nota não encontrada' });
    if (!['rascunho','pendente'].includes(nota.status))
      return res.status(400).json({ erro: 'Apenas rascunhos podem ser editados' });

    const {
      natureza_operacao, cfop, cliente_id, pedido_id, data_emissao,
      valor_produtos, valor_frete, valor_seguro, valor_desconto, valor_outros,
      valor_icms, valor_ipi, valor_pis, valor_cofins, valor_iss,
      forma_pagamento, observacoes,
    } = req.body;

    const valorTotal = (parseFloat(valor_produtos)||nota.valor_produtos)
      + (parseFloat(valor_frete)||0) + (parseFloat(valor_seguro)||0)
      + (parseFloat(valor_outros)||0) - (parseFloat(valor_desconto)||0);

    await db.run(`
      UPDATE notas_fiscais SET
        natureza_operacao = COALESCE($1, natureza_operacao),
        cfop              = COALESCE($2, cfop),
        cliente_id        = COALESCE($3, cliente_id),
        pedido_id         = COALESCE($4, pedido_id),
        data_emissao      = COALESCE($5, data_emissao),
        valor_produtos    = COALESCE($6, valor_produtos),
        valor_frete       = COALESCE($7, valor_frete),
        valor_desconto    = COALESCE($8, valor_desconto),
        valor_total       = $9,
        valor_icms        = COALESCE($10, valor_icms),
        valor_ipi         = COALESCE($11, valor_ipi),
        valor_pis         = COALESCE($12, valor_pis),
        valor_cofins      = COALESCE($13, valor_cofins),
        valor_iss         = COALESCE($14, valor_iss),
        forma_pagamento   = COALESCE($15, forma_pagamento),
        observacoes       = COALESCE($16, observacoes),
        atualizado_em     = NOW()
      WHERE id=$17
    `, [natureza_operacao||null, cfop||null, cliente_id||null, pedido_id||null,
        data_emissao||null, valor_produtos||null, valor_frete||null,
        valor_desconto||null, valorTotal,
        valor_icms||null, valor_ipi||null, valor_pis||null, valor_cofins||null, valor_iss||null,
        forma_pagamento||null, observacoes||null, req.params.id]);

    res.json({ mensagem: 'Nota atualizada' });
  } catch (err) {
    console.error('[nf PATCH]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const nota = await db.get('SELECT status FROM notas_fiscais WHERE id=$1', [req.params.id]);
    if (!nota) return res.status(404).json({ erro: 'Não encontrada' });
    if (nota.status === 'autorizada')
      return res.status(400).json({ erro: 'Cancele a nota antes de excluir' });
    await db.run('DELETE FROM notas_fiscais WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Nota excluída' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ─── Gerador de XML simulado ──────────────────────────────────────────────────
function gerarXmlSimulado(nota, chave) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe${chave}" versao="4.00">
      <ide>
        <cUF>41</cUF><natOp>${nota.natureza_operacao||'Venda'}</natOp>
        <mod>55</mod><serie>${nota.serie||'1'}</serie>
        <nNF>${nota.numero}</nNF><dhEmi>${new Date().toISOString()}</dhEmi>
        <tpNF>1</tpNF><finNFe>1</finNFe>
      </ide>
      <total><ICMSTot>
        <vProd>${nota.valor_produtos||0}</vProd>
        <vNF>${nota.valor_total||0}</vNF>
        <vICMS>${nota.valor_icms||0}</vICMS>
        <vIPI>${nota.valor_ipi||0}</vIPI>
        <vPIS>${nota.valor_pis||0}</vPIS>
        <vCOFINS>${nota.valor_cofins||0}</vCOFINS>
      </ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt>
    <chNFe>${chave}</chNFe>
    <dhRecbto>${new Date().toISOString()}</dhRecbto>
    <nProt>${nota.protocolo||''}</nProt>
    <cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>
  </infProt></protNFe>
</nfeProc>`;
}

module.exports = router;
