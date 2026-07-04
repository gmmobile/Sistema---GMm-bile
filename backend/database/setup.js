const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'sistema.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- Usuários do sistema
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    perfil TEXT NOT NULL CHECK(perfil IN ('gestor','vendedor','tecnico','financeiro')),
    foto TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Clientes
  CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cpf_cnpj TEXT,
    email TEXT,
    telefone TEXT,
    whatsapp TEXT,
    cep TEXT,
    rua TEXT,
    numero TEXT,
    bairro TEXT,
    cidade TEXT,
    estado TEXT,
    data_nascimento TEXT,
    origem TEXT,
    vendedor_id INTEGER REFERENCES usuarios(id),
    observacoes TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Parceiros
  CREATE TABLE IF NOT EXISTS parceiros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL,
    cpf_cnpj TEXT,
    email TEXT,
    telefone TEXT,
    whatsapp TEXT,
    banco TEXT,
    agencia TEXT,
    conta TEXT,
    chave_pix TEXT,
    cep TEXT,
    rua TEXT,
    numero TEXT,
    bairro TEXT,
    cidade TEXT,
    estado TEXT,
    observacoes TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Leads (CRM)
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    empresa TEXT,
    telefone TEXT,
    whatsapp TEXT,
    email TEXT,
    origem TEXT,
    produto_interesse TEXT,
    valor_estimado REAL,
    etapa TEXT NOT NULL DEFAULT 'novo' CHECK(etapa IN ('novo','contato','visita','proposta','negociacao','fechado','perdido')),
    motivo_perda TEXT,
    vendedor_id INTEGER REFERENCES usuarios(id),
    cliente_id INTEGER REFERENCES clientes(id),
    parceiro_id INTEGER REFERENCES parceiros(id),
    observacoes TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Interações do CRM
  CREATE TABLE IF NOT EXISTS lead_interacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL REFERENCES leads(id),
    tipo TEXT NOT NULL,
    descricao TEXT NOT NULL,
    usuario_id INTEGER REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Orçamentos
  CREATE TABLE IF NOT EXISTS orcamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT NOT NULL UNIQUE,
    cliente_id INTEGER REFERENCES clientes(id),
    lead_id INTEGER REFERENCES leads(id),
    vendedor_id INTEGER REFERENCES usuarios(id),
    valor_total REAL NOT NULL DEFAULT 0,
    desconto REAL DEFAULT 0,
    valor_final REAL NOT NULL DEFAULT 0,
    condicao_pagamento TEXT,
    validade_dias INTEGER DEFAULT 15,
    status TEXT NOT NULL DEFAULT 'rascunho' CHECK(status IN ('rascunho','enviado','aprovado','recusado')),
    observacoes TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Pedidos
  CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT NOT NULL UNIQUE,
    orcamento_id INTEGER REFERENCES orcamentos(id),
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    vendedor_id INTEGER REFERENCES usuarios(id),
    valor_total REAL NOT NULL,
    desconto REAL DEFAULT 0,
    valor_final REAL NOT NULL,
    condicao_pagamento TEXT,
    status TEXT NOT NULL DEFAULT 'confirmado' CHECK(status IN ('confirmado','medicao','projeto','producao','pronto','entrega','instalacao','concluido','cancelado')),
    data_confirmacao TEXT DEFAULT (datetime('now','localtime')),
    data_prevista_entrega TEXT,
    data_entrega_real TEXT,
    observacoes TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Itens do pedido/orçamento
  CREATE TABLE IF NOT EXISTS itens_pedido (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER REFERENCES pedidos(id),
    orcamento_id INTEGER REFERENCES orcamentos(id),
    ambiente TEXT NOT NULL,
    descricao TEXT,
    material TEXT,
    quantidade INTEGER DEFAULT 1,
    valor_unitario REAL NOT NULL,
    valor_total REAL NOT NULL
  );

  -- Categorias financeiras
  CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('receita','despesa')),
    cor TEXT DEFAULT '#6366f1',
    icone TEXT,
    categoria_pai_id INTEGER REFERENCES categorias(id),
    ativa INTEGER NOT NULL DEFAULT 1
  );

  -- Contas correntes
  CREATE TABLE IF NOT EXISTS contas_correntes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('corrente','poupanca','caixa','digital')),
    banco TEXT,
    agencia TEXT,
    numero_conta TEXT,
    saldo_inicial REAL NOT NULL DEFAULT 0,
    cor TEXT DEFAULT '#6366f1',
    ativa INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Lançamentos financeiros
  CREATE TABLE IF NOT EXISTS lancamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL CHECK(tipo IN ('receita','despesa','transferencia')),
    descricao TEXT NOT NULL,
    valor REAL NOT NULL,
    data_vencimento TEXT NOT NULL,
    data_pagamento TEXT,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','pago','atrasado','cancelado')),
    forma_pagamento TEXT,
    conta_id INTEGER REFERENCES contas_correntes(id),
    categoria_id INTEGER REFERENCES categorias(id),
    pedido_id INTEGER REFERENCES pedidos(id),
    parceiro_id INTEGER REFERENCES parceiros(id),
    observacoes TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Notas fiscais
  CREATE TABLE IF NOT EXISTS notas_fiscais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT,
    serie TEXT,
    tipo TEXT NOT NULL CHECK(tipo IN ('entrada','saida')),
    data_emissao TEXT,
    data_recebimento TEXT,
    cliente_id INTEGER REFERENCES clientes(id),
    fornecedor TEXT,
    pedido_id INTEGER REFERENCES pedidos(id),
    valor_total REAL,
    impostos REAL DEFAULT 0,
    chave_acesso TEXT,
    status TEXT NOT NULL DEFAULT 'emitida' CHECK(status IN ('emitida','cancelada','inutilizada')),
    xml_path TEXT,
    pdf_path TEXT,
    observacoes TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Comissões
  CREATE TABLE IF NOT EXISTS comissoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL CHECK(tipo IN ('vendedor','parceiro')),
    pessoa_id INTEGER NOT NULL,
    pedido_id INTEGER REFERENCES pedidos(id),
    valor_pedido REAL NOT NULL,
    percentual REAL NOT NULL,
    valor_comissao REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','pago','cancelado')),
    data_geracao TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    data_pagamento TEXT,
    forma_pagamento TEXT
  );

  -- Metas
  CREATE TABLE IF NOT EXISTS metas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendedor_id INTEGER NOT NULL REFERENCES usuarios(id),
    mes INTEGER NOT NULL,
    ano INTEGER NOT NULL,
    valor_meta REAL NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(vendedor_id, mes, ano)
  );

  -- Renders
  CREATE TABLE IF NOT EXISTS renders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER REFERENCES pedidos(id),
    cliente_id INTEGER REFERENCES clientes(id),
    nome TEXT NOT NULL,
    arquivo_path TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('imagem','pdf')),
    ambiente TEXT,
    aprovado INTEGER DEFAULT 0,
    data_aprovacao TEXT,
    token_publico TEXT UNIQUE,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Assistência técnica
  CREATE TABLE IF NOT EXISTS assistencias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT NOT NULL UNIQUE,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    pedido_id INTEGER REFERENCES pedidos(id),
    tipo_problema TEXT NOT NULL,
    descricao TEXT NOT NULL,
    urgencia TEXT NOT NULL DEFAULT 'medio' CHECK(urgencia IN ('baixo','medio','alto','critico')),
    status TEXT NOT NULL DEFAULT 'aberto' CHECK(status IN ('aberto','analise','agendado','execucao','concluido')),
    tecnico_id INTEGER REFERENCES usuarios(id),
    data_abertura TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    data_agendamento TEXT,
    data_conclusao TEXT,
    resolucao TEXT,
    observacoes TEXT
  );

  -- Índices para performance
  CREATE INDEX IF NOT EXISTS idx_leads_etapa ON leads(etapa);
  CREATE INDEX IF NOT EXISTS idx_leads_vendedor ON leads(vendedor_id);
  CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
  CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_lancamentos_status ON lancamentos(status);
  CREATE INDEX IF NOT EXISTS idx_lancamentos_vencimento ON lancamentos(data_vencimento);
  CREATE INDEX IF NOT EXISTS idx_assistencias_status ON assistencias(status);
`);

// Inserir usuário gestor padrão se não existir
const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get('admin@sistema.com');
if (!existe) {
  const senhaHash = bcrypt.hashSync('admin123', 10);
  db.prepare(`
    INSERT INTO usuarios (nome, email, senha_hash, perfil)
    VALUES (?, ?, ?, ?)
  `).run('Administrador', 'admin@sistema.com', senhaHash, 'gestor');

  // Categorias padrão
  const cats = [
    ['Venda de Móveis Planejados', 'receita', '#22c55e'],
    ['Serviço de Instalação', 'receita', '#16a34a'],
    ['Assistência Técnica', 'receita', '#15803d'],
    ['Outros (receita)', 'receita', '#4ade80'],
    ['Compra de Materiais', 'despesa', '#ef4444'],
    ['Mão de Obra', 'despesa', '#dc2626'],
    ['Aluguel', 'despesa', '#f97316'],
    ['Salários', 'despesa', '#ea580c'],
    ['Marketing', 'despesa', '#a855f7'],
    ['Impostos', 'despesa', '#7c3aed'],
    ['Outros (despesa)', 'despesa', '#94a3b8'],
  ];
  const insertCat = db.prepare('INSERT INTO categorias (nome, tipo, cor) VALUES (?, ?, ?)');
  cats.forEach(c => insertCat.run(...c));

  // Conta padrão
  db.prepare(`
    INSERT INTO contas_correntes (nome, tipo, saldo_inicial, cor)
    VALUES ('Caixa Principal', 'caixa', 0, '#6366f1')
  `).run();

  console.log('✅ Banco criado com sucesso!');
  console.log('👤 Usuário padrão: admin@sistema.com / admin123');
} else {
  console.log('✅ Banco já existente — estrutura atualizada.');
}

db.close();
