const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

router.get('/', async (req, res) => {
  try {
    const { filtro } = req.query;

    const [pedidosRaw, assistenciasRaw] = await Promise.all([
      db.all(`
        SELECT p.id, p.numero, p.status, p.etapa_producao,
               p.data_prevista_entrega::text, p.valor_total as valor_final,
               c.nome as cliente_nome, u.nome as vendedor_nome,
               (p.data_prevista_entrega::date - CURRENT_DATE) as dias_restantes
        FROM pedidos p
        LEFT JOIN clientes c ON c.id = p.cliente_id
        LEFT JOIN usuarios u ON u.id = p.vendedor_id
        WHERE p.status NOT IN ('concluido','cancelado')
        AND p.data_prevista_entrega IS NOT NULL
        ORDER BY p.data_prevista_entrega ASC
      `),
      db.all(`
        SELECT a.id, a.numero, a.status, a.urgencia,
               a.data_agendamento::text as data_prevista_entrega, a.tipo_problema,
               c.nome as cliente_nome,
               (a.data_agendamento::date - CURRENT_DATE) as dias_restantes
        FROM assistencias a
        LEFT JOIN clientes c ON c.id = a.cliente_id
        WHERE a.status NOT IN ('concluido', 'cancelado')
        AND a.data_agendamento IS NOT NULL
        ORDER BY a.data_agendamento ASC
      `),
    ]);

    const pedidos = pedidosRaw.map(p => ({
      ...p, tipo: 'pedido',
      situacao: p.dias_restantes < 0 ? 'atrasado' : p.dias_restantes <= 7 ? 'urgente' : 'ok'
    }));

    const assistencias = assistenciasRaw.map(a => ({
      ...a, tipo: 'assistencia',
      situacao: a.dias_restantes < 0 ? 'atrasado' : a.dias_restantes <= 3 ? 'urgente' : 'ok'
    }));

    let itens = [...pedidos, ...assistencias].sort((a, b) => a.dias_restantes - b.dias_restantes);

    const resumo = {
      total:     itens.length,
      atrasados: itens.filter(x => x.situacao === 'atrasado').length,
      urgentes:  itens.filter(x => x.situacao === 'urgente').length,
      ok:        itens.filter(x => x.situacao === 'ok').length,
    };

    if (filtro && filtro !== 'todos') itens = itens.filter(x => x.situacao === filtro);

    res.json({ itens, resumo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar radar' });
  }
});

router.get('/calendario', async (req, res) => {
  try {
    const { mes, ano } = req.query;
    const m = mes || String(new Date().getMonth() + 1).padStart(2, '0');
    const a = ano || new Date().getFullYear();
    const prefix = `${a}-${m}`;

    const [pedidos, assistencias] = await Promise.all([
      db.all(`
        SELECT p.id, p.numero, p.status, p.data_prevista_entrega::text, c.nome as cliente_nome
        FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id
        WHERE p.status NOT IN ('concluido','cancelado')
        AND LEFT(p.data_prevista_entrega, 7) = $1
        ORDER BY p.data_prevista_entrega ASC
      `, [prefix]),
      db.all(`
        SELECT a.id, a.numero, a.status, a.data_agendamento::text as data_prevista_entrega, c.nome as cliente_nome
        FROM assistencias a LEFT JOIN clientes c ON c.id = a.cliente_id
        WHERE a.status NOT IN ('concluido')
        AND LEFT(a.data_agendamento::text, 7) = $1
        ORDER BY a.data_agendamento ASC
      `, [prefix]),
    ]);

    res.json({ pedidos, assistencias });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar calendário' });
  }
});

module.exports = router;
