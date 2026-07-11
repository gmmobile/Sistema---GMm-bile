const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');
const { criarUpload, deletarArquivo } = require('../utils/cloudinary');

const router = express.Router();
router.use(autenticar);

const uploadFoto = criarUpload({ folder: 'clientes', allowedFormats: ['jpg', 'jpeg', 'png', 'webp'] });
const uploadPlanilha = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const CAMPOS_CLIENTE = ['nome', 'cpf_cnpj', 'email', 'telefone', 'whatsapp', 'cep', 'rua', 'numero', 'bairro', 'cidade', 'estado', 'data_nascimento', 'observacoes'];

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
          `INSERT INTO clientes (nome, email, telefone, whatsapp, cpf_cnpj, cep, rua, numero, bairro,
            cidade, estado, imovel, data_nascimento, observacoes, origem)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [c.nome, c.email||null, c.telefone||null, c.whatsapp||null, c.cpf_cnpj||null,
           c.cep||null, c.rua||null, c.numero||null, c.bairro||null,
           c.cidade||null, c.estado||null, c.imovel||null, c.data_nascimento||null,
           c.observacoes||null, c.origem||'importacao']
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

// POST /api/clientes/importar-ia/preview — lê uma planilha .xlsx (uma aba por
// empreendimento, ex: "Residencial Viverde") e usa IA para identificar as
// colunas e montar os clientes automaticamente, marcando o imóvel de cada um
// pelo nome da aba onde ele estava.
router.post('/importar-ia/preview', uploadPlanilha.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Envie um arquivo .xlsx' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const abas = [];
    for (const nomeAba of workbook.SheetNames) {
      const linhas = XLSX.utils.sheet_to_json(workbook.Sheets[nomeAba], { defval: '' });
      if (!linhas.length) continue;
      const cabecalhos = Object.keys(linhas[0]).filter(h => h && !h.startsWith('__EMPTY'));
      if (!cabecalhos.length) continue;
      abas.push({ nome: nomeAba, cabecalhos, linhas });
    }
    if (!abas.length) return res.status(400).json({ erro: 'Nenhuma aba com dados foi encontrada na planilha' });

    const prompt = `Você mapeia colunas de planilhas de clientes/moradores para os campos de um CRM.
Campos disponíveis (use exatamente estes nomes): ${CAMPOS_CLIENTE.join(', ')}.
- "nome" é obrigatório: identifique com certeza qual coluna é o nome da pessoa.
- Colunas que não correspondem a nenhum campo (ex: bloco, apartamento, unidade, torre) devem ser mapeadas para "observacoes".
- Se mais de uma coluna não tiver campo correspondente, mapeie todas para "observacoes" (serão combinadas).
- Ignore colunas totalmente vazias ou que não fazem sentido (ex: número de linha).
- NÃO invente colunas que não existem na lista de cabeçalhos.

Responda APENAS um JSON válido no formato:
{ "NomeDaAba": { "Cabeçalho Original": "campo_do_sistema" } }

Abas da planilha:
${abas.map(a => `### ${a.nome}\nCabeçalhos: ${a.cabecalhos.join(' | ')}\nExemplo de linha: ${JSON.stringify(a.linhas[0])}`).join('\n\n')}`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { responseMimeType: 'application/json' } });
    const result = await model.generateContent(prompt);
    let mapeamentoPorAba;
    try {
      mapeamentoPorAba = JSON.parse(result.response.text());
    } catch (e) {
      return res.status(502).json({ erro: 'A IA não conseguiu interpretar a planilha. Tente novamente.' });
    }

    const clientes = [];
    const resumoAbas = [];
    for (const aba of abas) {
      const mapa = mapeamentoPorAba[aba.nome] || {};
      let qtdAba = 0;
      for (const linha of aba.linhas) {
        const cliente = { imovel: aba.nome.trim() };
        const observacoesExtra = [];
        for (const [cabecalho, campo] of Object.entries(mapa)) {
          if (!CAMPOS_CLIENTE.includes(campo)) continue;
          const valor = String(linha[cabecalho] ?? '').trim();
          if (!valor) continue;
          if (campo === 'observacoes') observacoesExtra.push(`${cabecalho}: ${valor}`);
          else cliente[campo] = valor;
        }
        if (observacoesExtra.length) {
          cliente.observacoes = [cliente.observacoes, ...observacoesExtra].filter(Boolean).join(' · ');
        }
        if (!cliente.nome) continue;
        cliente.origem = 'importacao_ia';
        clientes.push(cliente);
        qtdAba++;
      }
      resumoAbas.push({ nome: aba.nome, total: qtdAba });
    }

    if (!clientes.length) return res.status(422).json({ erro: 'Nenhum cliente com nome válido foi encontrado na planilha' });

    res.json({ abas: resumoAbas, clientes });
  } catch (err) {
    console.error('[clientes importar-ia]', err.message);
    res.status(500).json({ erro: 'Erro ao processar a planilha: ' + err.message });
  }
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
