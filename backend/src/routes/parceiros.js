const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

router.get('/', async (req, res) => {
  try {
    const { busca } = req.query;
    let sql = 'SELECT * FROM parceiros WHERE ativo = 1';
    const params = [];
    if (busca) {
      sql += ' AND (nome ILIKE $1 OR email ILIKE $1 OR telefone ILIKE $1)';
      params.push(`%${busca}%`);
    }
    sql += ' ORDER BY nome';
    const parceiros = await db.all(sql, params);

    const comStats = await Promise.all(parceiros.map(async p => {
      const [indRow, convRow, comRow, pendRow] = await Promise.all([
        db.get('SELECT COUNT(*) as n FROM leads WHERE parceiro_id = $1', [p.id]),
        db.get(`SELECT COUNT(*) as n FROM leads WHERE parceiro_id = $1 AND etapa = 'fechado'`, [p.id]),
        db.get(`SELECT COALESCE(SUM(valor_comissao),0) as t FROM comissoes WHERE tipo='parceiro' AND pessoa_id=$1 AND valor_comissao > 0`, [p.id]),
        db.get(`SELECT COALESCE(SUM(valor_comissao),0) as t FROM comissoes WHERE tipo='parceiro' AND pessoa_id=$1 AND status='pendente' AND valor_comissao > 0`, [p.id]),
      ]);
      return { ...p, indicacoes: parseInt(indRow.n), convertidos: parseInt(convRow.n),
               comissoes_total: parseFloat(comRow.t), comissoes_pendentes: parseFloat(pendRow.t) };
    }));

    res.json(comStats);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar parceiros' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const p = await db.get('SELECT * FROM parceiros WHERE id = $1', [req.params.id]);
    if (!p) return res.status(404).json({ erro: 'Parceiro não encontrado' });
    const indicacoes = await db.all(`
      SELECT l.id, l.nome, l.etapa, l.valor_estimado, l.criado_em FROM leads l
      WHERE l.parceiro_id = $1 ORDER BY l.criado_em DESC
    `, [req.params.id]);
    res.json({ ...p, indicacoes });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar parceiro' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { nome, tipo, cpf_cnpj, email, telefone, whatsapp, banco, agencia, conta, chave_pix,
            cep, rua, numero, bairro, cidade, estado, observacoes } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
    const id = await db.insert(`
      INSERT INTO parceiros (nome, tipo, cpf_cnpj, email, telefone, whatsapp, banco, agencia, conta, chave_pix,
        cep, rua, numero, bairro, cidade, estado, observacoes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    `, [nome, tipo||'indicador', cpf_cnpj, email, telefone, whatsapp, banco, agencia, conta, chave_pix,
        cep, rua, numero, bairro, cidade, estado, observacoes]);
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao criar parceiro' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { nome, tipo, cpf_cnpj, email, telefone, whatsapp, banco, agencia, conta, chave_pix,
            cep, rua, numero, bairro, cidade, estado, observacoes } = req.body;
    await db.run(`
      UPDATE parceiros SET nome=$1, tipo=$2, cpf_cnpj=$3, email=$4, telefone=$5, whatsapp=$6,
        banco=$7, agencia=$8, conta=$9, chave_pix=$10, cep=$11, rua=$12, numero=$13, bairro=$14,
        cidade=$15, estado=$16, observacoes=$17 WHERE id=$18
    `, [nome, tipo, cpf_cnpj, email, telefone, whatsapp, banco, agencia, conta, chave_pix,
        cep, rua, numero, bairro, cidade, estado, observacoes, req.params.id]);
    res.json({ mensagem: 'Parceiro atualizado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar parceiro' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.run('UPDATE parceiros SET ativo=0 WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Parceiro removido' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover parceiro' });
  }
});

module.exports = router;
