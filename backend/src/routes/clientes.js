const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
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

// Formata um valor de célula de data (Date, serial do Excel ou texto dd/mm/aaaa) em 'YYYY-MM-DD'
function formatarDataCelula(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().split('T')[0];
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const [, d, mo, a] = m;
    const ano = a.length === 2 ? '20' + a : a;
    return `${ano}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}
// Converte "R$ 1.234,56" / 1234.56 / "1234,56" em número
function formatarValorCelula(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  return parseFloat(s) || 0;
}

// POST /api/clientes/importar-ia/preview — lê uma planilha .xlsx onde cada
// aba é o carnê de um cliente (nome da aba = nome do cliente, com um título
// do imóvel/empreendimento dentro da planilha e uma tabela de parcelas:
// nº, data, valor, pago/OK). A IA identifica a estrutura de cada aba
// (onde fica o título do imóvel, onde começa a tabela e o que é cada
// coluna) e o parsing das linhas é feito de forma determinística.
router.post('/importar-ia/preview', uploadPlanilha.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Envie um arquivo .xlsx' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const abas = [];
    for (const nomeAba of workbook.SheetNames) {
      const grade = XLSX.utils.sheet_to_json(workbook.Sheets[nomeAba], { header: 1, defval: '' });
      const naoVazia = grade.filter(l => l.some(c => String(c).trim() !== ''));
      if (!naoVazia.length) continue;
      // "grade" completa é usada na extração determinística das parcelas;
      // "amostra" (só as primeiras linhas) é o que vai pro prompt da IA —
      // suficiente pra identificar a estrutura sem estourar o limite de tokens.
      abas.push({ nome: nomeAba, grade, amostra: grade.slice(0, 20) });
    }
    if (!abas.length) return res.status(400).json({ erro: 'Nenhuma aba com dados foi encontrada na planilha' });

    const prompt = `Você analisa planilhas de carnê de pagamento de clientes de uma empresa de móveis planejados.
Cada aba da planilha é o carnê de UM cliente. A estrutura típica é:
- Em algum lugar no topo, o nome do imóvel/empreendimento onde o cliente mora (ex: "RESIDENCIAL VIVERDE"), como um título solto.
- Uma linha de cabeçalho de tabela com colunas como: nome do cliente (repetido em toda linha), número da parcela, data de pagamento/vencimento, valor, e uma marcação de pago (ex: "OK", "PAGO", "X").
- Linhas de dados abaixo, uma por parcela.

Cada aba foi enviada como uma matriz (array de arrays), cada sub-array é uma linha da planilha, na ordem original (índice 0 = primeira linha).

Para cada aba, identifique:
- "cliente": o nome do cliente (geralmente igual ao nome da própria aba, ou repetido na coluna de nome da tabela).
- "imovel": o nome do imóvel/empreendimento encontrado como título solto (ou null se não houver).
- "linha_cabecalho": o índice (dentro da matriz enviada) da linha que contém os cabeçalhos da tabela de parcelas.
- "colunas": um objeto mapeando cada TEXTO de cabeçalho encontrado na linha de cabeçalho para um destes campos: "parcela_num", "data_vencimento", "valor", "status_pago". Ignore/não inclua colunas que sejam apenas o nome do cliente repetido ou irrelevantes.

Responda APENAS um JSON válido no formato:
{ "NomeDaAba": { "cliente": "...", "imovel": "..." , "linha_cabecalho": 2, "colunas": { "DATA PAGAMENTO": "data_vencimento", "VALOR": "valor", "OK": "status_pago", "Nº PARCELAS": "parcela_num" } } }

Abas da planilha:
${abas.map(a => `### ${a.nome}\n${JSON.stringify(a.amostra)}`).join('\n\n')}`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { responseMimeType: 'application/json' } });
    const result = await model.generateContent(prompt);
    let estruturaPorAba;
    try {
      estruturaPorAba = JSON.parse(result.response.text());
    } catch (e) {
      return res.status(502).json({ erro: 'A IA não conseguiu interpretar a planilha. Tente novamente.' });
    }

    const clientes = [];
    const resumoAbas = [];
    for (const aba of abas) {
      const est = estruturaPorAba[aba.nome];
      if (!est || est.linha_cabecalho === undefined || !est.colunas) { resumoAbas.push({ nome: aba.nome, erro: true }); continue; }

      const linhaCab = aba.grade[est.linha_cabecalho] || [];
      const idxPorCampo = {};
      linhaCab.forEach((texto, idx) => {
        const campo = est.colunas[String(texto).trim()];
        if (campo) idxPorCampo[campo] = idx;
      });

      const parcelas = [];
      for (let i = est.linha_cabecalho + 1; i < aba.grade.length; i++) {
        const linha = aba.grade[i];
        if (!linha || !linha.some(c => String(c).trim() !== '')) continue;
        const valorBruto = idxPorCampo.valor !== undefined ? linha[idxPorCampo.valor] : '';
        const dataBruta = idxPorCampo.data_vencimento !== undefined ? linha[idxPorCampo.data_vencimento] : '';
        const valor = formatarValorCelula(valorBruto);
        const data_vencimento = formatarDataCelula(dataBruta);
        if (!valor && !data_vencimento) continue;
        const statusBruto = idxPorCampo.status_pago !== undefined ? String(linha[idxPorCampo.status_pago] || '').trim() : '';
        parcelas.push({
          parcela_num: idxPorCampo.parcela_num !== undefined ? (parseInt(linha[idxPorCampo.parcela_num]) || parcelas.length + 1) : parcelas.length + 1,
          data_vencimento,
          valor,
          pago: statusBruto.length > 0,
        });
      }

      const nomeCliente = (est.cliente || aba.nome).trim();
      if (!nomeCliente || !parcelas.length) { resumoAbas.push({ nome: aba.nome, erro: true }); continue; }

      clientes.push({ nome: nomeCliente, imovel: est.imovel ? String(est.imovel).trim() : null, origem: 'importacao_ia', parcelas });
      resumoAbas.push({
        nome: aba.nome, cliente: nomeCliente, imovel: est.imovel || null,
        parcelas: parcelas.length, pagas: parcelas.filter(p => p.pago).length,
        valorTotal: parcelas.reduce((s, p) => s + p.valor, 0),
      });
    }

    if (!clientes.length) return res.status(422).json({ erro: 'Nenhum carnê válido foi identificado na planilha. Confira se cada aba tem uma tabela de parcelas com data e valor.' });

    res.json({ abas: resumoAbas, clientes });
  } catch (err) {
    console.error('[clientes importar-ia preview]', err.message);
    res.status(500).json({ erro: 'Erro ao processar a planilha: ' + err.message });
  }
});

// POST /api/clientes/importar-ia/confirmar — cria os clientes e gera as
// parcelas em Contas a Receber (lancamentos), preservando o status pago/
// pendente identificado na planilha.
router.post('/importar-ia/confirmar', async (req, res) => {
  const { clientes } = req.body;
  if (!Array.isArray(clientes) || !clientes.length) return res.status(400).json({ erro: 'Nenhum cliente para importar' });

  let clientesImportados = 0, parcelasImportadas = 0;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of clientes) {
      if (!c.nome || !Array.isArray(c.parcelas) || !c.parcelas.length) continue;

      const { rows } = await client.query(
        `INSERT INTO clientes (nome, imovel, origem) VALUES ($1,$2,$3) RETURNING id`,
        [c.nome, c.imovel || null, c.origem || 'importacao_ia']
      );
      const clienteId = rows[0].id;
      clientesImportados++;

      const grupoId = crypto.randomUUID();
      const total = c.parcelas.length;
      for (const p of c.parcelas) {
        if (!p.data_vencimento) continue;
        await client.query(
          `INSERT INTO lancamentos (tipo, descricao, valor, data_vencimento, data_pagamento, status,
             cliente_id, origem, parcela_num, parcela_total, grupo_parcela_id)
           VALUES ('receita',$1,$2,$3,$4,$5,$6,'importacao_ia',$7,$8,$9)`,
          [`${c.nome} — Parcela ${p.parcela_num}/${total}`, p.valor, p.data_vencimento,
           p.pago ? p.data_vencimento : null, p.pago ? 'pago' : 'pendente',
           clienteId, p.parcela_num, total, grupoId]
        );
        parcelasImportadas++;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[clientes importar-ia confirmar]', err.message);
    return res.status(500).json({ erro: 'Erro ao importar: ' + err.message });
  } finally {
    client.release();
  }

  res.json({ clientesImportados, parcelasImportadas, mensagem: `${clientesImportados} cliente(s) e ${parcelasImportadas} parcela(s) importados` });
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
