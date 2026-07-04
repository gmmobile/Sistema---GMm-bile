const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../utils/db');
const log = require('../utils/atividade');
const { autenticar, autorizar } = require('../middlewares/auth');
const { criarUpload, deletarArquivo } = require('../utils/cloudinary');

const router = express.Router();
router.use(autenticar);

const upload = criarUpload({ folder: 'fotos', allowedFormats: ['jpg', 'jpeg', 'png', 'webp'] });

router.get('/', async (req, res) => {
  try {
    const { perfil } = req.query;
    let sql = 'SELECT id, nome, email, perfil, foto, ativo, criado_em FROM usuarios WHERE ativo=1';
    const params = [];
    if (perfil) { sql += ' AND perfil=$1'; params.push(perfil); }
    sql += ' ORDER BY nome';
    res.json(await db.all(sql, params));
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar usuários' });
  }
});

const TODOS_MODULOS = ['dashboard','ranking','agenda','relatorios','clientes','crm','comercial','renders','radar','assistencia','financeiro','notas_fiscais','contas','categorias','comissoes','parceiros','usuarios','configuracoes'];

router.get('/minhas-permissoes', async (req, res) => {
  try {
    if (req.usuario.perfil === 'gestor') {
      const result = {};
      TODOS_MODULOS.forEach(m => { result[m] = 'total'; });
      return res.json(result);
    }
    const result = {};
    const perfRows = await db.all('SELECT modulo, nivel FROM permissoes WHERE perfil=$1', [req.usuario.perfil]);
    perfRows.forEach(r => { result[r.modulo] = r.nivel; });
    const usrRows = await db.all('SELECT modulo, nivel FROM permissoes_usuario WHERE usuario_id=$1', [req.usuario.id]);
    usrRows.forEach(r => { result[r.modulo] = r.nivel; });
    res.json(result);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar permissões' });
  }
});

router.get('/permissoes/:perfil', autorizar('gestor'), async (req, res) => {
  try {
    const { perfil } = req.params;
    if (!['vendedor','tecnico','financeiro'].includes(perfil))
      return res.status(400).json({ erro: 'Perfil inválido' });
    const rows = await db.all('SELECT modulo, nivel FROM permissoes WHERE perfil=$1', [perfil]);
    const result = {};
    rows.forEach(r => { result[r.modulo] = r.nivel; });
    res.json(result);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar permissões' });
  }
});

router.put('/permissoes/:perfil', autorizar('gestor'), async (req, res) => {
  try {
    const { perfil } = req.params;
    if (!['vendedor','tecnico','financeiro'].includes(perfil))
      return res.status(400).json({ erro: 'Perfil inválido' });
    const { permissoes } = req.body;
    if (!permissoes || typeof permissoes !== 'object')
      return res.status(400).json({ erro: 'Dados de permissões inválidos' });
    const niveis = ['sem_acesso','leitura','edicao','total'];
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [modulo, nivel] of Object.entries(permissoes)) {
        if (TODOS_MODULOS.includes(modulo) && niveis.includes(nivel)) {
          await client.query(
            `INSERT INTO permissoes (perfil, modulo, nivel) VALUES ($1,$2,$3)
             ON CONFLICT(perfil,modulo) DO UPDATE SET nivel=EXCLUDED.nivel`,
            [perfil, modulo, nivel]
          );
        }
      }
      await client.query('COMMIT');
    } finally { client.release(); }
    await log(req.usuario.id, 'atualizar', 'usuarios', `Atualizou permissões do perfil ${perfil}`);
    res.json({ mensagem: 'Permissões atualizadas' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao salvar permissões' });
  }
});

router.get('/:id/permissoes', autorizar('gestor'), async (req, res) => {
  try {
    const u = await db.get('SELECT perfil, nome FROM usuarios WHERE id=$1', [req.params.id]);
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado' });
    const result = {};
    if (u.perfil === 'gestor') {
      TODOS_MODULOS.forEach(m => { result[m] = 'total'; });
      return res.json({ perfil: u.perfil, permissoes: result, tem_overrides: false });
    }
    const perfRows = await db.all('SELECT modulo, nivel FROM permissoes WHERE perfil=$1', [u.perfil]);
    perfRows.forEach(r => { result[r.modulo] = r.nivel; });
    const overrides = {};
    const usrRows = await db.all('SELECT modulo, nivel FROM permissoes_usuario WHERE usuario_id=$1', [+req.params.id]);
    usrRows.forEach(r => { overrides[r.modulo] = r.nivel; result[r.modulo] = r.nivel; });
    res.json({ perfil: u.perfil, permissoes: result, overrides });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar permissões' });
  }
});

router.put('/:id/permissoes', autorizar('gestor'), async (req, res) => {
  try {
    const u = await db.get('SELECT perfil, nome FROM usuarios WHERE id=$1', [req.params.id]);
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado' });
    if (u.perfil === 'gestor') return res.status(400).json({ erro: 'Não é possível restringir permissões do gestor' });
    const { permissoes } = req.body;
    if (!permissoes || typeof permissoes !== 'object') return res.status(400).json({ erro: 'Dados inválidos' });
    const niveis = ['sem_acesso','leitura','edicao','total'];
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [modulo, nivel] of Object.entries(permissoes)) {
        if (TODOS_MODULOS.includes(modulo) && niveis.includes(nivel)) {
          await client.query(
            `INSERT INTO permissoes_usuario (usuario_id, modulo, nivel) VALUES ($1,$2,$3)
             ON CONFLICT(usuario_id,modulo) DO UPDATE SET nivel=EXCLUDED.nivel`,
            [+req.params.id, modulo, nivel]
          );
        }
      }
      await client.query('COMMIT');
    } finally { client.release(); }
    await log(req.usuario.id, 'atualizar', 'usuarios', `Atualizou permissões individuais de ${u.nome}`, +req.params.id);
    res.json({ mensagem: 'Permissões do usuário atualizadas' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao salvar permissões' });
  }
});

router.delete('/:id/permissoes', autorizar('gestor'), async (req, res) => {
  try {
    const u = await db.get('SELECT nome FROM usuarios WHERE id=$1', [req.params.id]);
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado' });
    await db.run('DELETE FROM permissoes_usuario WHERE usuario_id=$1', [+req.params.id]);
    await log(req.usuario.id, 'atualizar', 'usuarios', `Resetou permissões individuais de ${u.nome}`, +req.params.id);
    res.json({ mensagem: 'Permissões redefinidas para o padrão do perfil' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao resetar permissões' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const u = await db.get('SELECT id, nome, email, perfil, foto, ativo, criado_em FROM usuarios WHERE id=$1', [req.params.id]);
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado' });
    res.json(u);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar usuário' });
  }
});

router.post('/', autorizar('gestor'), upload.single('foto'), async (req, res) => {
  try {
    const { nome, email, senha, perfil } = req.body;
    if (!nome || !email || !senha || !perfil) return res.status(400).json({ erro: 'Todos os campos são obrigatórios' });
    if (senha.length < 6) return res.status(400).json({ erro: 'Senha mínima de 6 caracteres' });
    const existe = await db.get('SELECT id FROM usuarios WHERE email=$1 AND ativo=1', [email]);
    if (existe) return res.status(409).json({ erro: 'E-mail já cadastrado' });
    const foto = req.file?.path || null;
    const hash = bcrypt.hashSync(senha, 10);
    const id = await db.insert(
      'INSERT INTO usuarios (nome, email, senha_hash, perfil, foto) VALUES ($1,$2,$3,$4,$5)',
      [nome, email, hash, perfil, foto]
    );
    await log(req.usuario.id, 'criar', 'usuarios', `Criou usuário ${nome} (${perfil})`, id);
    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar usuário' });
  }
});

router.put('/:id', autorizar('gestor'), upload.single('foto'), async (req, res) => {
  try {
    const { nome, email, perfil, ativo } = req.body;
    const atual = await db.get('SELECT * FROM usuarios WHERE id=$1', [req.params.id]);
    if (!atual) return res.status(404).json({ erro: 'Usuário não encontrado' });
    let foto = atual.foto;
    if (req.file) {
      await deletarArquivo(atual.foto);
      foto = req.file.path;
    }
    await db.run(
      `UPDATE usuarios SET nome=$1, email=$2, perfil=$3, foto=$4, ativo=$5, atualizado_em=NOW() WHERE id=$6`,
      [nome||atual.nome, email||atual.email, perfil||atual.perfil, foto, ativo!==undefined?+ativo:atual.ativo, req.params.id]
    );
    await log(req.usuario.id, 'atualizar', 'usuarios', `Atualizou usuário ${nome||atual.nome}`, +req.params.id);
    res.json({ mensagem: 'Usuário atualizado' });
  } catch(e) {
    console.error(e);
    res.status(500).json({ erro: 'Erro ao atualizar usuário' });
  }
});

router.put('/:id/senha', async (req, res) => {
  try {
    const { nova_senha, senha_atual } = req.body;
    if (!nova_senha || nova_senha.length < 6) return res.status(400).json({ erro: 'Senha mínima de 6 caracteres' });
    const u = await db.get('SELECT * FROM usuarios WHERE id=$1', [req.params.id]);
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado' });
    if (req.usuario.id === u.id) {
      if (!senha_atual || !bcrypt.compareSync(senha_atual, u.senha_hash))
        return res.status(401).json({ erro: 'Senha atual incorreta' });
    } else if (req.usuario.perfil !== 'gestor') {
      return res.status(403).json({ erro: 'Sem permissão' });
    }
    await db.run('UPDATE usuarios SET senha_hash=$1, atualizado_em=NOW() WHERE id=$2',
      [bcrypt.hashSync(nova_senha, 10), req.params.id]);
    res.json({ mensagem: 'Senha alterada com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao alterar senha' });
  }
});

router.delete('/:id', autorizar('gestor'), async (req, res) => {
  try {
    if (+req.params.id === req.usuario.id) return res.status(400).json({ erro: 'Não é possível desativar seu próprio usuário' });
    const u = await db.get('SELECT email FROM usuarios WHERE id=$1', [req.params.id]);
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado' });
    const emailLiber = `_excluido_${req.params.id}_${u.email}`;
    await db.run('UPDATE usuarios SET ativo=0, email=$1 WHERE id=$2', [emailLiber, req.params.id]);
    res.json({ mensagem: 'Usuário removido' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover usuário' });
  }
});

module.exports = router;
