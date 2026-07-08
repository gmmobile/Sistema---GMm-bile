const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');
const { criarUpload, deletarArquivo } = require('../utils/cloudinary');

const router = express.Router();
router.use(autenticar);

const uploadFoto = criarUpload({ folder: 'clientes', allowedFormats: ['jpg', 'jpeg', 'png', 'webp'] });

// GET /api/clientes
router.get('/', async (req, res) => {
  try {
    const { busca, cidade, ativo = 1 } = req.query;
    let sql = `
      SELECT c.*, u.nome as vendedor_nome
      FROM clientes c
      LEFT JOIN usuarios u ON u.id = c.vendedor_id
      WHERE c.ativo = $1
    `;
    const params = [ativo];
    let idx = 2;

    if (busca) {
      const buscaSemMask = busca.replace(/[\.\-\/\(\)\s]/g, '');
      sql += ` AND (c.nome ILIKE $${idx} OR c.email ILIKE $${idx} OR c.telefone ILIKE $${idx}
               OR c.cpf_cnpj ILIKE $${idx}
               OR REPLACE(REPLACE(REPLACE(c.cpf_cnpj,'.',''),'-',''),'/','') ILIKE $${idx + 1})`;
      params.push(`%${busca}%`, `%${buscaSemMask}%`);
      idx += 2;
    }
    if (cidade) { sql += ` AND c.cidade = $${idx}`; params.push(cidade); idx++; }

    sql += ` ORDER BY c.criado_em DESC`;
    res.json(await db.all(sql, params));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar clientes' });
  }
});

// GET /api/clientes/:id
router.get('/:id', async (req, res) => {
  try {
    const cliente = await db.get(`
      SELECT c.*, u.nome as vendedor_nome
      FROM clientes c LEFT JOIN usuarios u ON u.id = c.vendedor_id
      WHERE c.id = $1
    `, [req.params.id]);
    if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });

    const pedidos = await db.all(`
      SELECT id, numero, valor_final, status, data_prevista_entrega, criado_em
      FROM pedidos WHERE cliente_id = $1 ORDER BY criado_em DESC
    `, [req.params.id]);

    res.json({ ...cliente, pedidos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar cliente' });
  }
});

// POST /api/clientes
router.post('/', async (req, res) => {
  try {
    const { nome, cpf_cnpj, email, telefone, whatsapp, cep, rua, numero,
            bairro, cidade, estado, imovel, data_nascimento, origem, vendedor_id,
            observacoes, tipo_servico, comodos } = req.body;

    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });

    const id = await db.insert(`
      INSERT INTO clientes (nome, cpf_cnpj, email, telefone, whatsapp, cep, rua, numero,
        bairro, cidade, estado, imovel, data_nascimento, origem, vendedor_id, observacoes,
        tipo_servico, comodos)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    `, [nome, cpf_cnpj, email, telefone, whatsapp, cep, rua, numero,
        bairro, cidade, estado, imovel||null, data_nascimento, origem, vendedor_id, observacoes,
        tipo_servico, comodos ? JSON.stringify(comodos) : null]);

    res.status(201).json({ id, mensagem: 'Cliente criado com sucesso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar cliente' });
  }
});

// PUT /api/clientes/:id
router.put('/:id', async (req, res) => {
  try {
    const { nome, cpf_cnpj, email, telefone, whatsapp, cep, rua, numero,
            bairro, cidade, estado, imovel, data_nascimento, origem, vendedor_id,
            observacoes, tipo_servico, comodos } = req.body;

    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });

    await db.run(`
      UPDATE clientes SET nome=$1, cpf_cnpj=$2, email=$3, telefone=$4, whatsapp=$5,
        cep=$6, rua=$7, numero=$8, bairro=$9, cidade=$10, estado=$11, imovel=$12,
        data_nascimento=$13, origem=$14, vendedor_id=$15, observacoes=$16,
        tipo_servico=$17, comodos=$18, atualizado_em=NOW()
      WHERE id=$19
    `, [nome, cpf_cnpj, email, telefone, whatsapp, cep, rua, numero,
        bairro, cidade, estado, imovel||null, data_nascimento, origem, vendedor_id, observacoes,
        tipo_servico, comodos ? JSON.stringify(comodos) : null, req.params.id]);

    res.json({ mensagem: 'Cliente atualizado com sucesso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar cliente' });
  }
});

// POST /api/clientes/importar
router.post('/importar', async (req, res) => {
  const { clientes } = req.body;
  if (!Array.isArray(clientes) || clientes.length === 0)
    return res.status(400).json({ erro: 'Nenhum cliente para importar' });

  let importados = 0, erros = 0;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of clientes) {
      if (!c.nome) { erros++; continue; }
      try {
        await client.query(
          `INSERT INTO clientes (nome, email, telefone, whatsapp, cpf_cnpj, cidade, estado, origem)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [c.nome, c.email||null, c.telefone||null, c.whatsapp||null,
           c.cpf_cnpj||null, c.cidade||null, c.estado||null, c.origem||'importacao']
        );
        importados++;
      } catch(e) { erros++; }
    }
    await client.query('COMMIT');
  } catch(e) {
    await client.query('ROLLBACK');
    erros = clientes.length;
  } finally {
    client.release();
  }
  res.json({ importados, erros, mensagem: `${importados} cliente(s) importado(s)` });
});

// POST /api/clientes/:id/foto
router.post('/:id/foto', uploadFoto.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Imagem não enviada' });

    const caminho = req.file.path; // URL do Cloudinary

    const atual = await db.get('SELECT foto FROM clientes WHERE id=$1', [req.params.id]);
    if (atual?.foto) await deletarArquivo(atual.foto);

    await db.run('UPDATE clientes SET foto=$1 WHERE id=$2', [caminho, req.params.id]);
    res.json({ foto: caminho });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao salvar foto' });
  }
});

// DELETE /api/clientes/:id (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    await db.run('UPDATE clientes SET ativo=0 WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Cliente removido' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover cliente' });
  }
});

module.exports = router;
