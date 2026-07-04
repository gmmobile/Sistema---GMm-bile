const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

router.get('/', async (req, res) => {
  try {
    const { status, urgencia, busca } = req.query;
    let sql = `
      SELECT a.*, c.nome as cliente_nome, c.telefone as cliente_tel, c.whatsapp as cliente_wpp,
             u.nome as tecnico_nome, p.numero as pedido_numero
      FROM assistencias a
      LEFT JOIN clientes c ON c.id = a.cliente_id
      LEFT JOIN usuarios u ON u.id = a.tecnico_id
      LEFT JOIN pedidos p ON p.id = a.pedido_id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;
    if (status)   { sql += ` AND a.status = $${idx++}`;   params.push(status); }
    if (urgencia) { sql += ` AND a.urgencia = $${idx++}`; params.push(urgencia); }
    if (busca) {
      const b = `%${busca}%`;
      sql += ` AND (c.nome ILIKE $${idx} OR a.numero ILIKE $${idx} OR a.tipo_problema ILIKE $${idx})`;
      params.push(b); idx++;
    }
    sql += ` ORDER BY CASE a.urgencia WHEN 'critico' THEN 1 WHEN 'alto' THEN 2 WHEN 'medio' THEN 3 ELSE 4 END, a.data_abertura DESC`;
    res.json(await db.all(sql, params));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar assistências' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const a = await db.get(`
      SELECT a.*, c.nome as cliente_nome, c.telefone as cliente_tel, c.whatsapp as cliente_wpp,
             u.nome as tecnico_nome, p.numero as pedido_numero
      FROM assistencias a
      LEFT JOIN clientes c ON c.id = a.cliente_id
      LEFT JOIN usuarios u ON u.id = a.tecnico_id
      LEFT JOIN pedidos p ON p.id = a.pedido_id
      WHERE a.id = $1
    `, [req.params.id]);
    if (!a) return res.status(404).json({ erro: 'Chamado não encontrado' });
    res.json(a);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar assistência' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { cliente_id, pedido_id, tipo_problema, descricao, urgencia, data_agendamento, tecnico_id } = req.body;
    if (!cliente_id || !tipo_problema || !descricao)
      return res.status(400).json({ erro: 'Cliente, tipo e descrição são obrigatórios' });

    const seqRow = await db.get('SELECT COUNT(*)+1 as n FROM assistencias');
    const numero = 'AT-' + String(seqRow.n).padStart(4, '0');
    const URGENCIAS_VALIDAS = ['baixo','medio','alto','critico'];
    const urgenciaFinal = urgencia && URGENCIAS_VALIDAS.includes(urgencia) ? urgencia : 'medio';

    const id = await db.insert(`
      INSERT INTO assistencias (numero, cliente_id, pedido_id, tipo_problema, descricao, urgencia, data_agendamento, tecnico_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [numero, cliente_id, pedido_id||null, tipo_problema, descricao, urgenciaFinal, data_agendamento||null, tecnico_id||null]);

    res.status(201).json({ id, numero });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao criar assistência' });
  }
});

router.put('/:id/status', async (req, res) => {
  try {
    const { status, resolucao } = req.body;
    const validos = ['aberto','analise','agendado','execucao','concluido','cancelado'];
    if (!status || !validos.includes(status)) return res.status(400).json({ erro: 'Status inválido' });

    let sql = 'UPDATE assistencias SET status=$1, resolucao=$2';
    const params = [status, resolucao||null];
    if (status === 'concluido') { sql += ', data_conclusao=NOW()'; }
    sql += ' WHERE id=$3';
    params.push(req.params.id);

    await db.run(sql, params);
    res.json({ mensagem: 'Status atualizado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar status' });
  }
});

router.put('/:id/tecnico', async (req, res) => {
  try {
    const { tecnico_id, data_agendamento } = req.body;
    if (!tecnico_id) return res.status(400).json({ erro: 'Técnico é obrigatório' });
    await db.run(`UPDATE assistencias SET tecnico_id=$1, data_agendamento=$2, status='agendado' WHERE id=$3`,
      [tecnico_id, data_agendamento, req.params.id]);
    res.json({ mensagem: 'Técnico atribuído' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atribuir técnico' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { tipo_problema, descricao, urgencia, observacoes } = req.body;
    if (!tipo_problema || !descricao)
      return res.status(400).json({ erro: 'Tipo do problema e descrição são obrigatórios' });
    await db.run('UPDATE assistencias SET tipo_problema=$1, descricao=$2, urgencia=$3, observacoes=$4 WHERE id=$5',
      [tipo_problema, descricao, urgencia, observacoes, req.params.id]);
    res.json({ mensagem: 'Chamado atualizado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar assistência' });
  }
});

module.exports = router;
