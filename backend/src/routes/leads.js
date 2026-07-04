const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

const ETAPAS_VALIDAS = [
  'novo_lead','primeiro_contato','qualificacao','visita_agendada',
  'projeto','orcamento_enviado','negociacao','contrato',
  'pedido_confirmado','producao','entrega','pos_venda','perdido',
];

// GET /api/leads
router.get('/', async (req, res) => {
  try {
    const { etapa, vendedor_id, busca, origem, temperatura } = req.query;
    let sql = `
      SELECT l.*, u.nome AS vendedor_nome, p.nome AS parceiro_nome
      FROM leads l
      LEFT JOIN usuarios u ON u.id = l.vendedor_id
      LEFT JOIN parceiros p ON p.id = l.parceiro_id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (etapa)       { sql += ` AND l.etapa = $${idx++}`;       params.push(etapa); }
    if (vendedor_id) { sql += ` AND l.vendedor_id = $${idx++}`; params.push(vendedor_id); }
    if (origem)      { sql += ` AND l.origem = $${idx++}`;      params.push(origem); }
    if (temperatura) { sql += ` AND l.temperatura = $${idx++}`; params.push(temperatura); }
    if (busca) {
      const b = `%${busca}%`;
      sql += ` AND (l.nome ILIKE $${idx} OR l.telefone ILIKE $${idx} OR l.whatsapp ILIKE $${idx} OR l.email ILIKE $${idx} OR l.cidade ILIKE $${idx})`;
      params.push(b); idx++;
    }

    sql += ` ORDER BY l.criado_em DESC`;
    res.json(await db.all(sql, params));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar leads' });
  }
});

// GET /api/leads/:id
router.get('/:id', async (req, res) => {
  try {
    const lead = await db.get(`
      SELECT l.*, u.nome AS vendedor_nome, u2.nome AS responsavel_nome
      FROM leads l
      LEFT JOIN usuarios u  ON u.id  = l.vendedor_id
      LEFT JOIN usuarios u2 ON u2.id = l.vendedor_id
      WHERE l.id = $1
    `, [req.params.id]);
    if (!lead) return res.status(404).json({ erro: 'Lead não encontrado' });

    const interacoes = await db.all(`
      SELECT i.*, u.nome AS usuario_nome FROM lead_interacoes i
      LEFT JOIN usuarios u ON u.id = i.usuario_id
      WHERE i.lead_id = $1 ORDER BY i.criado_em ASC
    `, [req.params.id]);

    res.json({ ...lead, interacoes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar lead' });
  }
});

// POST /api/leads
router.post('/', async (req, res) => {
  try {
    const {
      nome, empresa, telefone, whatsapp, email, origem,
      produto_interesse, projeto_desejado, valor_estimado,
      vendedor_id, parceiro_id, observacoes, cidade, cpf, endereco,
    } = req.body;

    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });

    const id = await db.insert(`
      INSERT INTO leads (nome, empresa, telefone, whatsapp, email, origem,
        produto_interesse, projeto_desejado, valor_estimado, vendedor_id,
        parceiro_id, observacoes, cidade, cpf, endereco, etapa, ultimo_contato)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'novo_lead',NOW())
    `, [nome, empresa, telefone, whatsapp, email, origem,
        produto_interesse, projeto_desejado, parseFloat(valor_estimado) || 0,
        vendedor_id || null, parceiro_id || null, observacoes,
        cidade, cpf, endereco]);

    // Registra interação de criação
    await db.run(`
      INSERT INTO lead_interacoes (lead_id, tipo, descricao, usuario_id)
      VALUES ($1,'criado','Lead cadastrado no CRM',$2)
    `, [id, req.usuario.id]);

    res.status(201).json({ id, mensagem: 'Lead criado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar lead' });
  }
});

// PUT /api/leads/:id
router.put('/:id', async (req, res) => {
  try {
    const {
      nome, empresa, telefone, whatsapp, email, origem,
      produto_interesse, projeto_desejado, valor_estimado,
      vendedor_id, parceiro_id, observacoes, cidade, cpf, endereco, probabilidade,
    } = req.body;

    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });

    await db.run(`
      UPDATE leads SET
        nome=$1, empresa=$2, telefone=$3, whatsapp=$4, email=$5,
        origem=$6, produto_interesse=$7, projeto_desejado=$8,
        valor_estimado=$9, vendedor_id=$10, parceiro_id=$11,
        observacoes=$12, cidade=$13, cpf=$14, endereco=$15,
        probabilidade=$16, atualizado_em=NOW()
      WHERE id=$17
    `, [nome, empresa, telefone, whatsapp, email, origem,
        produto_interesse, projeto_desejado, parseFloat(valor_estimado) || 0,
        vendedor_id || null, parceiro_id || null, observacoes,
        cidade, cpf, endereco, parseInt(probabilidade) || 30, req.params.id]);

    res.json({ mensagem: 'Lead atualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar lead' });
  }
});

// PUT /api/leads/:id/etapa
router.put('/:id/etapa', async (req, res) => {
  try {
    const { etapa, motivo_perda } = req.body;
    if (!ETAPAS_VALIDAS.includes(etapa))
      return res.status(400).json({ erro: 'Etapa inválida' });

    await db.run(`
      UPDATE leads SET etapa=$1, motivo_perda=$2, atualizado_em=NOW() WHERE id=$3
    `, [etapa, motivo_perda || null, req.params.id]);

    // Registra movimentação no histórico
    const etapaLabels = {
      novo_lead:'Novo Lead', primeiro_contato:'Primeiro Contato',
      qualificacao:'Qualificação', visita_agendada:'Visita Agendada',
      projeto:'Em Projeto', orcamento_enviado:'Orçamento Enviado',
      negociacao:'Negociação', contrato:'Contrato',
      pedido_confirmado:'Pedido Confirmado', producao:'Em Produção',
      entrega:'Entrega', pos_venda:'Pós-venda', perdido:'Perdido',
    };
    await db.run(`
      INSERT INTO lead_interacoes (lead_id, tipo, descricao, usuario_id)
      VALUES ($1,'etapa',$2,$3)
    `, [req.params.id, `Etapa alterada para "${etapaLabels[etapa] || etapa}"`, req.usuario.id]);

    res.json({ mensagem: 'Etapa atualizada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar etapa' });
  }
});

// POST /api/leads/:id/interacoes
router.post('/:id/interacoes', async (req, res) => {
  try {
    const { tipo, descricao } = req.body;
    if (!tipo) return res.status(400).json({ erro: 'Tipo obrigatório' });

    await db.run(`
      INSERT INTO lead_interacoes (lead_id, tipo, descricao, usuario_id)
      VALUES ($1,$2,$3,$4)
    `, [req.params.id, tipo, descricao || '', req.usuario.id]);

    // Atualiza último contato
    await db.run(`UPDATE leads SET ultimo_contato=NOW(), atualizado_em=NOW() WHERE id=$1`, [req.params.id]);

    res.status(201).json({ mensagem: 'Interação registrada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao registrar interação' });
  }
});

// POST /api/leads/:id/converter
router.post('/:id/converter', async (req, res) => {
  try {
    const lead = await db.get('SELECT * FROM leads WHERE id = $1', [req.params.id]);
    if (!lead) return res.status(404).json({ erro: 'Lead não encontrado' });
    if (lead.cliente_id)
      return res.status(400).json({ erro: 'Lead já foi convertido em cliente', cliente_id: lead.cliente_id });

    // Cria o cliente propagando origem e lead_id para rastreabilidade completa
    const cliente_id = await db.insert(`
      INSERT INTO clientes (nome, email, telefone, whatsapp, cpf_cnpj, origem, vendedor_id, cidade, endereco, lead_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [lead.nome, lead.email||null, lead.telefone||null, lead.whatsapp||null,
        lead.cpf||null, lead.origem||null, lead.vendedor_id||null,
        lead.cidade||null, lead.endereco||null, lead.id]);

    await db.run(`
      UPDATE leads SET etapa='pedido_confirmado', cliente_id=$1, atualizado_em=NOW() WHERE id=$2
    `, [cliente_id, lead.id]);

    await db.run(`
      INSERT INTO lead_interacoes (lead_id, tipo, descricao, usuario_id)
      VALUES ($1,'pedido','Lead convertido em cliente',$2)
    `, [lead.id, req.usuario.id]);

    res.json({ mensagem: 'Lead convertido em cliente', cliente_id, lead_id: lead.id, origem: lead.origem });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao converter lead' });
  }
});

// DELETE /api/leads/:id
router.delete('/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM leads WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Lead removido' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover lead' });
  }
});

module.exports = router;
