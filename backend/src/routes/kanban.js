const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

const ETAPAS = [
  'novo_pedido', 'aguardando_medicao', 'projeto_3d', 'aguardando_aprovacao',
  'compra_materiais', 'producao', 'montagem', 'qualidade',
  'entrega_agendada', 'entregue', 'assistencia', 'concluido',
];

const ETAPA_LABELS = {
  novo_pedido:          'Novo Pedido',
  aguardando_medicao:   'Aguardando Medição',
  projeto_3d:           'Projeto 3D',
  aguardando_aprovacao: 'Aguardando Aprovação',
  compra_materiais:     'Compra de Materiais',
  producao:             'Produção',
  montagem:             'Montagem',
  qualidade:            'Qualidade',
  entrega_agendada:     'Entrega Agendada',
  entregue:             'Entregue',
  assistencia:          'Assistência Técnica',
  concluido:            'Concluído',
};

const ETAPA_PROGRESSO = {
  novo_pedido: 0, aguardando_medicao: 8, projeto_3d: 17, aguardando_aprovacao: 25,
  compra_materiais: 33, producao: 50, montagem: 67, qualidade: 75,
  entrega_agendada: 83, entregue: 92, assistencia: 92, concluido: 100,
};

const CHECKLIST_DEFAULT = {
  producao:  ['Cortar MDF', 'Furar peças', 'Colar fita de borda', 'Conferir peças', 'Embalar'],
  montagem:  ['Transportar ao local', 'Instalar móveis', 'Regular portas e gavetas', 'Limpar o ambiente', 'Colher assinatura do cliente'],
  qualidade: ['Verificar medidas', 'Verificar acabamentos', 'Verificar ferragens', 'Fotografar', 'Aprovação interna'],
};

// ── GET /api/kanban/meta/etapas ──
router.get('/meta/etapas', (req, res) => {
  res.json(ETAPAS.map(id => ({ id, label: ETAPA_LABELS[id], progresso: ETAPA_PROGRESSO[id] })));
});

// ── GET /api/kanban/stats ──
router.get('/stats', async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const row = await db.get(`
      SELECT
        COUNT(*) FILTER (WHERE status <> 'cancelado' AND etapa_producao <> 'concluido') AS em_andamento,
        COUNT(*) FILTER (WHERE etapa_producao = 'producao')                             AS em_producao,
        COUNT(*) FILTER (WHERE etapa_producao = 'montagem')                             AS em_montagem,
        COUNT(*) FILTER (WHERE etapa_producao = 'entregue')                             AS entregues,
        COUNT(*) FILTER (WHERE NULLIF(data_prevista_entrega,'') IS NOT NULL
          AND data_prevista_entrega < $1
          AND etapa_producao NOT IN ('entregue','concluido','assistencia')
          AND status <> 'cancelado')                                                     AS atrasados,
        COUNT(*) FILTER (WHERE data_prevista_entrega = $1
          AND etapa_producao NOT IN ('entregue','concluido')
          AND status <> 'cancelado')                                                     AS entrega_hoje
      FROM pedidos
    `, [hoje]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar stats' });
  }
});

// ── GET /api/kanban ──
router.get('/', async (req, res) => {
  try {
    const { busca, prioridade, responsavel_id, concluidos } = req.query;
    let where = `WHERE p.status <> 'cancelado'`;
    const params = [];
    let idx = 1;

    if (!concluidos || concluidos === '0') {
      where += ` AND p.etapa_producao <> 'concluido'`;
    }
    if (prioridade)    { where += ` AND p.prioridade=$${idx++}`;             params.push(prioridade); }
    if (responsavel_id){ where += ` AND p.responsavel_producao_id=$${idx++}`; params.push(responsavel_id); }
    if (busca) {
      where += ` AND (c.nome ILIKE $${idx} OR p.numero ILIKE $${idx} OR uv.nome ILIKE $${idx})`;
      params.push(`%${busca}%`); idx++;
    }

    const pedidos = await db.all(`
      SELECT
        p.id, p.numero, p.valor_final, p.valor_total, p.data_prevista_entrega,
        p.etapa_producao, p.etapa_atualizada_em, p.prioridade, p.progresso,
        p.status, p.criado_em, p.origem,
        c.nome  AS cliente_nome,
        uv.nome AS vendedor_nome,
        up.nome AS projetista_nome,
        ur.nome AS responsavel_nome,
        (SELECT COUNT(*) FROM itens_pedido    WHERE pedido_id=p.id)                   AS total_itens,
        (SELECT COUNT(*) FROM kanban_checklist WHERE pedido_id=p.id AND concluido=TRUE) AS checklist_feito,
        (SELECT COUNT(*) FROM kanban_checklist WHERE pedido_id=p.id)                   AS checklist_total
      FROM pedidos p
      LEFT JOIN clientes  c  ON c.id  = p.cliente_id
      LEFT JOIN usuarios  uv ON uv.id = p.vendedor_id
      LEFT JOIN usuarios  up ON up.id = p.projetista_id
      LEFT JOIN usuarios  ur ON ur.id = p.responsavel_producao_id
      ${where}
      ORDER BY
        CASE p.prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
        p.data_prevista_entrega ASC NULLS LAST,
        p.criado_em ASC
    `, params);

    const resultado = {};
    ETAPAS.forEach(e => resultado[e] = []);
    for (const p of pedidos) {
      const etapa = ETAPAS.includes(p.etapa_producao) ? p.etapa_producao : 'novo_pedido';
      resultado[etapa].push(p);
    }
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar kanban' });
  }
});

// ── GET /api/kanban/:id ──
router.get('/:id', async (req, res) => {
  try {
    const pedido = await db.get(`
      SELECT p.*,
        c.nome    AS cliente_nome, c.whatsapp AS cliente_whatsapp,
        c.email   AS cliente_email, c.cidade  AS cliente_cidade,
        CONCAT_WS(', ', NULLIF(c.rua,''), NULLIF(c.numero,''), NULLIF(c.bairro,'')) AS cliente_endereco,
        uv.nome   AS vendedor_nome,
        up.nome   AS projetista_nome,
        ur.nome   AS responsavel_nome,
        o.numero  AS orcamento_numero
      FROM pedidos p
      LEFT JOIN clientes   c  ON c.id  = p.cliente_id
      LEFT JOIN usuarios   uv ON uv.id = p.vendedor_id
      LEFT JOIN usuarios   up ON up.id = p.projetista_id
      LEFT JOIN usuarios   ur ON ur.id = p.responsavel_producao_id
      LEFT JOIN orcamentos o  ON o.id  = p.orcamento_id
      WHERE p.id = $1
    `, [req.params.id]);

    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });

    const [itens, checklist, timeline] = await Promise.all([
      db.all('SELECT * FROM itens_pedido WHERE pedido_id=$1 ORDER BY id', [req.params.id]),
      db.all('SELECT * FROM kanban_checklist WHERE pedido_id=$1 ORDER BY etapa, ordem, id', [req.params.id]),
      db.all(`SELECT t.*, u.nome AS usuario_nome FROM kanban_timeline t
              LEFT JOIN usuarios u ON u.id=t.usuario_id
              WHERE t.pedido_id=$1 ORDER BY t.criado_em ASC`, [req.params.id]),
    ]);

    res.json({ ...pedido, itens, checklist, timeline });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar pedido' });
  }
});

// ── PATCH /api/kanban/:id/etapa ──
router.patch('/:id/etapa', async (req, res) => {
  try {
    const { etapa } = req.body;
    if (!ETAPAS.includes(etapa)) return res.status(400).json({ erro: 'Etapa inválida' });

    const progresso = ETAPA_PROGRESSO[etapa] ?? 0;
    await db.run(
      'UPDATE pedidos SET etapa_producao=$1, etapa_atualizada_em=NOW(), progresso=$2 WHERE id=$3',
      [etapa, progresso, req.params.id]
    );

    await db.run(
      'INSERT INTO kanban_timeline (pedido_id, tipo, descricao, usuario_id) VALUES ($1,$2,$3,$4)',
      [req.params.id, 'etapa', `Movido para "${ETAPA_LABELS[etapa]}"`, req.usuario.id]
    );

    if (CHECKLIST_DEFAULT[etapa]) {
      const existing = await db.get(
        'SELECT id FROM kanban_checklist WHERE pedido_id=$1 AND etapa=$2 LIMIT 1',
        [req.params.id, etapa]
      );
      if (!existing) {
        for (let i = 0; i < CHECKLIST_DEFAULT[etapa].length; i++) {
          await db.run(
            'INSERT INTO kanban_checklist (pedido_id, etapa, item, ordem) VALUES ($1,$2,$3,$4)',
            [req.params.id, etapa, CHECKLIST_DEFAULT[etapa][i], i]
          );
        }
      }
    }

    res.json({ mensagem: 'Etapa atualizada', progresso });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar etapa' });
  }
});

// ── PATCH /api/kanban/:id ──
router.patch('/:id', async (req, res) => {
  try {
    const { prioridade, responsavel_producao_id, projetista_id, data_prevista_entrega, observacoes, progresso } = req.body;
    const fields = []; const vals = []; let idx = 1;

    if (prioridade              !== undefined) { fields.push(`prioridade=$${idx++}`);               vals.push(prioridade); }
    if (responsavel_producao_id !== undefined) { fields.push(`responsavel_producao_id=$${idx++}`);  vals.push(responsavel_producao_id || null); }
    if (projetista_id           !== undefined) { fields.push(`projetista_id=$${idx++}`);            vals.push(projetista_id || null); }
    if (data_prevista_entrega   !== undefined) { fields.push(`data_prevista_entrega=$${idx++}`);    vals.push(data_prevista_entrega || null); }
    if (observacoes             !== undefined) { fields.push(`observacoes=$${idx++}`);              vals.push(observacoes); }
    if (progresso               !== undefined) { fields.push(`progresso=$${idx++}`);               vals.push(parseInt(progresso) || 0); }

    if (!fields.length) return res.json({ mensagem: 'Nada a atualizar' });
    vals.push(req.params.id);
    await db.run(`UPDATE pedidos SET ${fields.join(', ')} WHERE id=$${idx}`, vals);
    res.json({ mensagem: 'Atualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar' });
  }
});

// ── PATCH /api/kanban/checklist/:itemId ──
router.patch('/checklist/:itemId', async (req, res) => {
  try {
    const item = await db.get('SELECT * FROM kanban_checklist WHERE id=$1', [req.params.itemId]);
    if (!item) return res.status(404).json({ erro: 'Item não encontrado' });

    const novo = !item.concluido;
    await db.run('UPDATE kanban_checklist SET concluido=$1 WHERE id=$2', [novo, req.params.itemId]);

    const [tot, fei] = await Promise.all([
      db.get('SELECT COUNT(*) AS n FROM kanban_checklist WHERE pedido_id=$1', [item.pedido_id]),
      db.get('SELECT COUNT(*) AS n FROM kanban_checklist WHERE pedido_id=$1 AND concluido=TRUE', [item.pedido_id]),
    ]);
    const pct = tot.n > 0 ? Math.round((fei.n / tot.n) * 100) : 0;
    const ped = await db.get('SELECT etapa_producao FROM pedidos WHERE id=$1', [item.pedido_id]);
    const etapaPct = ETAPA_PROGRESSO[ped?.etapa_producao] ?? 0;
    const final = Math.max(etapaPct, pct);
    await db.run('UPDATE pedidos SET progresso=$1 WHERE id=$2', [final, item.pedido_id]);

    res.json({ concluido: novo, progresso: final });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar checklist' });
  }
});

// ── POST /api/kanban/:id/timeline ──
router.post('/:id/timeline', async (req, res) => {
  try {
    const { tipo = 'nota', descricao } = req.body;
    if (!descricao) return res.status(400).json({ erro: 'Descrição obrigatória' });
    await db.run(
      'INSERT INTO kanban_timeline (pedido_id, tipo, descricao, usuario_id) VALUES ($1,$2,$3,$4)',
      [req.params.id, tipo, descricao, req.usuario.id]
    );
    res.status(201).json({ mensagem: 'Registrado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao registrar' });
  }
});

// ── GET /api/kanban/resumo (compat) ──
router.get('/resumo', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT etapa_producao AS etapa, COUNT(*) AS total
      FROM pedidos WHERE status NOT IN ('cancelado','concluido')
      GROUP BY etapa_producao
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar resumo' });
  }
});

module.exports = router;
