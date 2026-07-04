const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

async function gerarNumero() {
  const ultimo = await db.get('SELECT numero FROM ordens_servico ORDER BY id DESC LIMIT 1');
  if (!ultimo) return 'OS-0001';
  const n = parseInt(ultimo.numero.replace('OS-', '')) + 1;
  return 'OS-' + String(n).padStart(4, '0');
}

router.get('/', async (req, res) => {
  try {
    const { status, tipo, tecnico_id, busca } = req.query;
    let sql = `
      SELECT os.*, c.nome as cliente_nome, c.telefone as cliente_tel, c.whatsapp as cliente_whatsapp,
             t.nome as tecnico_nome, p.numero as pedido_numero
      FROM ordens_servico os
      LEFT JOIN clientes c ON c.id = os.cliente_id
      LEFT JOIN usuarios t ON t.id = os.tecnico_id
      LEFT JOIN pedidos p ON p.id = os.pedido_id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;
    if (status)     { sql += ` AND os.status=$${idx++}`;     params.push(status); }
    if (tipo)       { sql += ` AND os.tipo=$${idx++}`;        params.push(tipo); }
    if (tecnico_id) { sql += ` AND os.tecnico_id=$${idx++}`;  params.push(tecnico_id); }
    if (busca)      {
      sql += ` AND (os.numero ILIKE $${idx} OR c.nome ILIKE $${idx})`;
      params.push(`%${busca}%`); idx++;
    }
    sql += ' ORDER BY os.data_agendada ASC, os.criado_em DESC';
    res.json(await db.all(sql, params));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar OS' });
  }
});

router.get('/resumo/stats', async (req, res) => {
  try {
    const r = await db.get(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='pendente' THEN 1 ELSE 0 END) as pendentes,
        SUM(CASE WHEN status='em_andamento' THEN 1 ELSE 0 END) as em_andamento,
        SUM(CASE WHEN status='concluido' THEN 1 ELSE 0 END) as concluidas,
        SUM(CASE WHEN status='cancelado' THEN 1 ELSE 0 END) as canceladas,
        SUM(CASE WHEN data_agendada < CURRENT_DATE::text AND status NOT IN ('concluido','cancelado') THEN 1 ELSE 0 END) as atrasadas
      FROM ordens_servico WHERE status != 'cancelado'
    `);
    res.json(r);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar stats' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const os = await db.get(`
      SELECT os.*, c.nome as cliente_nome, c.telefone as cliente_tel, c.whatsapp as cliente_whatsapp,
             c.rua, c.numero as end_numero, c.bairro, c.cidade, c.estado,
             t.nome as tecnico_nome, p.numero as pedido_numero
      FROM ordens_servico os
      LEFT JOIN clientes c ON c.id = os.cliente_id
      LEFT JOIN usuarios t ON t.id = os.tecnico_id
      LEFT JOIN pedidos p ON p.id = os.pedido_id
      WHERE os.id=$1
    `, [req.params.id]);
    if (!os) return res.status(404).json({ erro: 'OS não encontrada' });
    res.json(os);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar OS' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { cliente_id, pedido_id, tecnico_id, tipo, data_agendada, descricao, itens_instalados } = req.body;
    if (!cliente_id) return res.status(400).json({ erro: 'Cliente é obrigatório' });
    const numero = await gerarNumero();
    const id = await db.insert(`
      INSERT INTO ordens_servico (numero, cliente_id, pedido_id, tecnico_id, tipo, data_agendada, descricao, itens_instalados)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [numero, cliente_id, pedido_id||null, tecnico_id||null, tipo||'instalacao',
        data_agendada||null, descricao||null, itens_instalados||null]);
    res.status(201).json({ id, numero });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao criar OS' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { tecnico_id, tipo, data_agendada, descricao, itens_instalados, observacoes_tecnico } = req.body;
    await db.run(`
      UPDATE ordens_servico SET tecnico_id=$1, tipo=$2, data_agendada=$3, descricao=$4,
        itens_instalados=$5, observacoes_tecnico=$6 WHERE id=$7
    `, [tecnico_id||null, tipo, data_agendada||null, descricao||null, itens_instalados||null, observacoes_tecnico||null, req.params.id]);
    res.json({ mensagem: 'OS atualizada' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar OS' });
  }
});

const ETAPAS_KANBAN = ['medicao','projeto','aprovacao','producao','entrega','instalacao'];
const OS_TIPO_ETAPA = { visita: 'medicao', instalacao: 'instalacao', entrega: 'entrega', manutencao: null };

router.patch('/:id/status', async (req, res) => {
  try {
    const { status, observacoes_tecnico } = req.body;
    const validos = ['pendente','em_andamento','concluido','cancelado'];
    if (!validos.includes(status)) return res.status(400).json({ erro: 'Status inválido' });

    const concluido_em = status === 'concluido' ? 'NOW()' : null;
    await db.run(`
      UPDATE ordens_servico SET status=$1,
        observacoes_tecnico=COALESCE($2,observacoes_tecnico),
        concluido_em=${status === 'concluido' ? 'NOW()' : '$3'}
      WHERE id=${status === 'concluido' ? '$3' : '$4'}
    `, status === 'concluido'
        ? [status, observacoes_tecnico||null, req.params.id]
        : [status, observacoes_tecnico||null, null, req.params.id]);

    if (status === 'concluido') {
      const os = await db.get('SELECT * FROM ordens_servico WHERE id=$1', [req.params.id]);
      if (os?.pedido_id) {
        const etapaOs = OS_TIPO_ETAPA[os.tipo];
        if (etapaOs !== null) {
          const pedido = await db.get('SELECT id, etapa_producao, status FROM pedidos WHERE id=$1', [os.pedido_id]);
          if (pedido && pedido.status !== 'concluido' && pedido.status !== 'cancelado') {
            const idxAtual = ETAPAS_KANBAN.indexOf(pedido.etapa_producao);
            const idxOs    = ETAPAS_KANBAN.indexOf(etapaOs);
            if (etapaOs === 'instalacao' && pedido.etapa_producao === 'instalacao') {
              await db.run('UPDATE pedidos SET status=$1, etapa_atualizada_em=NOW() WHERE id=$2', ['concluido', pedido.id]);
            } else if (idxOs >= idxAtual && idxAtual < ETAPAS_KANBAN.length - 1) {
              const proxima = ETAPAS_KANBAN[idxOs + 1] || ETAPAS_KANBAN[idxAtual + 1];
              await db.run('UPDATE pedidos SET etapa_producao=$1, etapa_atualizada_em=NOW() WHERE id=$2', [proxima, pedido.id]);
            }
          }
        }
      }
    }

    res.json({ mensagem: 'Status atualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar status' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.run("UPDATE ordens_servico SET status='cancelado' WHERE id=$1", [req.params.id]);
    res.json({ mensagem: 'OS removida' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover OS' });
  }
});

module.exports = router;
