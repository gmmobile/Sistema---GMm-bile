-- ═══════════════════════════════════════════════
-- SCHEMA PostgreSQL — Sistema GM MÓBILE
-- Execute no SQL Editor do Neon
-- ═══════════════════════════════════════════════

-- Usuários
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL CHECK(perfil IN ('gestor','vendedor','tecnico','financeiro')),
  foto TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clientes
CREATE TABLE IF NOT EXISTS clientes (
  id SERIAL PRIMARY KEY,
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
  tipo_servico TEXT,
  comodos TEXT,
  foto TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Parceiros
CREATE TABLE IF NOT EXISTS parceiros (
  id SERIAL PRIMARY KEY,
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
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Leads (CRM)
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
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
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Interações do CRM
CREATE TABLE IF NOT EXISTS lead_interacoes (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Orçamentos
CREATE TABLE IF NOT EXISTS orcamentos (
  id SERIAL PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  cliente_id INTEGER REFERENCES clientes(id),
  lead_id INTEGER REFERENCES leads(id),
  vendedor_id INTEGER REFERENCES usuarios(id),
  projetista_id INTEGER REFERENCES usuarios(id),
  valor_total REAL NOT NULL DEFAULT 0,
  desconto REAL DEFAULT 0,
  valor_final REAL NOT NULL DEFAULT 0,
  valor_global REAL NOT NULL DEFAULT 0,
  condicao_pagamento TEXT,
  validade_dias INTEGER DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK(status IN ('rascunho','enviado','aprovado','recusado','expirado')),
  observacoes TEXT,
  comissao_vendedor REAL NOT NULL DEFAULT 0,
  comissao_projetista REAL NOT NULL DEFAULT 0,
  indicacao_projetista INTEGER NOT NULL DEFAULT 0,
  taxa_medicao REAL NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Histórico de orçamentos
CREATE TABLE IF NOT EXISTS historico_orcamentos (
  id SERIAL PRIMARY KEY,
  orcamento_id INTEGER NOT NULL REFERENCES orcamentos(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  usuario_nome TEXT,
  descricao TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pedidos
CREATE TABLE IF NOT EXISTS pedidos (
  id SERIAL PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  orcamento_id INTEGER REFERENCES orcamentos(id),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  vendedor_id INTEGER REFERENCES usuarios(id),
  valor_total REAL NOT NULL,
  desconto REAL DEFAULT 0,
  valor_final REAL NOT NULL,
  condicao_pagamento TEXT,
  status TEXT NOT NULL DEFAULT 'confirmado' CHECK(status IN ('confirmado','medicao','projeto','producao','pronto','entrega','instalacao','concluido','cancelado')),
  etapa_producao TEXT NOT NULL DEFAULT 'medicao',
  etapa_atualizada_em TIMESTAMPTZ DEFAULT NOW(),
  data_confirmacao TIMESTAMPTZ DEFAULT NOW(),
  data_prevista_entrega TEXT,
  data_entrega_real TIMESTAMPTZ,
  observacoes TEXT,
  token TEXT UNIQUE,
  prazo_garantia_meses INTEGER DEFAULT 12,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Itens do pedido/orçamento
CREATE TABLE IF NOT EXISTS itens_pedido (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
  orcamento_id INTEGER REFERENCES orcamentos(id) ON DELETE CASCADE,
  ambiente TEXT,
  descricao TEXT NOT NULL,
  material TEXT,
  quantidade INTEGER DEFAULT 1,
  valor_unitario REAL NOT NULL DEFAULT 0,
  valor_total REAL NOT NULL DEFAULT 0
);

-- Categorias financeiras
CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('receita','despesa')),
  cor TEXT DEFAULT '#6366f1',
  icone TEXT,
  categoria_pai_id INTEGER REFERENCES categorias(id),
  ativa INTEGER NOT NULL DEFAULT 1
);

-- Contas correntes
CREATE TABLE IF NOT EXISTS contas_correntes (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('corrente','poupanca','caixa','digital')),
  banco TEXT,
  agencia TEXT,
  numero_conta TEXT,
  saldo_inicial REAL NOT NULL DEFAULT 0,
  cor TEXT DEFAULT '#6366f1',
  ativa INTEGER NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lançamentos financeiros
CREATE TABLE IF NOT EXISTS lancamentos (
  id SERIAL PRIMARY KEY,
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
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Extrato bancário
CREATE TABLE IF NOT EXISTS extrato_bancario (
  id SERIAL PRIMARY KEY,
  conta_id INTEGER NOT NULL REFERENCES contas_correntes(id),
  data TEXT NOT NULL,
  descricao TEXT NOT NULL,
  valor REAL NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('credito','debito')),
  conciliado INTEGER NOT NULL DEFAULT 0,
  lancamento_id INTEGER REFERENCES lancamentos(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Comissões
CREATE TABLE IF NOT EXISTS comissoes (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL CHECK(tipo IN ('vendedor','parceiro')),
  pessoa_id INTEGER NOT NULL,
  pedido_id INTEGER REFERENCES pedidos(id),
  orcamento_id INTEGER REFERENCES orcamentos(id),
  valor_pedido REAL NOT NULL,
  percentual REAL NOT NULL,
  valor_comissao REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','pago','cancelado')),
  data_geracao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_pagamento TEXT,
  forma_pagamento TEXT
);

-- Metas
CREATE TABLE IF NOT EXISTS metas (
  id SERIAL PRIMARY KEY,
  vendedor_id INTEGER NOT NULL REFERENCES usuarios(id),
  mes INTEGER NOT NULL,
  ano INTEGER NOT NULL,
  valor_meta REAL NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(vendedor_id, mes, ano)
);

-- Renders / arquivos de projeto
CREATE TABLE IF NOT EXISTS renders (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER REFERENCES pedidos(id),
  cliente_id INTEGER REFERENCES clientes(id),
  nome TEXT NOT NULL,
  arquivo_path TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('imagem','pdf')),
  ambiente TEXT,
  aprovado INTEGER DEFAULT 0,
  data_aprovacao TEXT,
  token_publico TEXT UNIQUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Assistência técnica
CREATE TABLE IF NOT EXISTS assistencias (
  id SERIAL PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  pedido_id INTEGER REFERENCES pedidos(id),
  tipo_problema TEXT NOT NULL,
  descricao TEXT NOT NULL,
  urgencia TEXT NOT NULL DEFAULT 'medio' CHECK(urgencia IN ('baixo','medio','alto','critico')),
  status TEXT NOT NULL DEFAULT 'aberto' CHECK(status IN ('aberto','analise','agendado','execucao','concluido')),
  tecnico_id INTEGER REFERENCES usuarios(id),
  data_abertura TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_agendamento TEXT,
  data_conclusao TIMESTAMPTZ,
  resolucao TEXT,
  observacoes TEXT
);

-- Ordens de serviço
CREATE TABLE IF NOT EXISTS ordens_servico (
  id SERIAL PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  pedido_id INTEGER REFERENCES pedidos(id),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  tecnico_id INTEGER REFERENCES usuarios(id),
  tipo TEXT NOT NULL DEFAULT 'instalacao' CHECK(tipo IN ('instalacao','manutencao','visita','entrega')),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','em_andamento','concluido','cancelado')),
  data_agendada TEXT,
  descricao TEXT,
  itens_instalados TEXT,
  observacoes_tecnico TEXT,
  concluido_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fornecedores
CREATE TABLE IF NOT EXISTS fornecedores (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  cnpj TEXT,
  email TEXT,
  telefone TEXT,
  whatsapp TEXT,
  categoria TEXT,
  prazo_pagamento INTEGER DEFAULT 30,
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
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Produtos / estoque
CREATE TABLE IF NOT EXISTS produtos (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  codigo TEXT,
  categoria TEXT,
  unidade TEXT NOT NULL DEFAULT 'un',
  estoque_atual REAL NOT NULL DEFAULT 0,
  estoque_minimo REAL NOT NULL DEFAULT 0,
  valor_custo REAL NOT NULL DEFAULT 0,
  descricao TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Movimentos de estoque
CREATE TABLE IF NOT EXISTS movimentos_estoque (
  id SERIAL PRIMARY KEY,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  tipo TEXT NOT NULL CHECK(tipo IN ('entrada','saida','ajuste')),
  quantidade REAL NOT NULL,
  valor_unitario REAL,
  observacao TEXT,
  pedido_id INTEGER REFERENCES pedidos(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Atividades (log)
CREATE TABLE IF NOT EXISTS atividades (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  acao TEXT NOT NULL,
  modulo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  referencia_id INTEGER,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Configurações da loja
CREATE TABLE IF NOT EXISTS configuracoes_loja (
  id INTEGER PRIMARY KEY DEFAULT 1,
  nome_empresa TEXT NOT NULL DEFAULT 'GM MÓBILE',
  cnpj TEXT,
  telefone TEXT,
  whatsapp TEXT,
  email TEXT,
  site TEXT,
  cep TEXT,
  rua TEXT,
  numero TEXT,
  bairro TEXT,
  cidade TEXT,
  estado TEXT,
  logo_path TEXT,
  cor_primaria TEXT DEFAULT '#C4A24A',
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cobranças
CREATE TABLE IF NOT EXISTS cobrancas (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  observacao TEXT NOT NULL,
  data_cobranca TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Permissões por perfil
CREATE TABLE IF NOT EXISTS permissoes (
  id SERIAL PRIMARY KEY,
  perfil TEXT NOT NULL,
  modulo TEXT NOT NULL,
  nivel TEXT NOT NULL DEFAULT 'leitura' CHECK(nivel IN ('sem_acesso','leitura','edicao','total')),
  UNIQUE(perfil, modulo)
);

-- Permissões individuais por usuário
CREATE TABLE IF NOT EXISTS permissoes_usuario (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  modulo TEXT NOT NULL,
  nivel TEXT NOT NULL CHECK(nivel IN ('sem_acesso','leitura','edicao','total')),
  UNIQUE(usuario_id, modulo)
);

-- Anexos de pedidos
CREATE TABLE IF NOT EXISTS pedido_anexos (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  nome_arquivo TEXT NOT NULL,
  caminho TEXT NOT NULL,
  tamanho INTEGER,
  usuario_id INTEGER REFERENCES usuarios(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_leads_etapa ON leads(etapa);
CREATE INDEX IF NOT EXISTS idx_leads_vendedor ON leads(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_status ON lancamentos(status);
CREATE INDEX IF NOT EXISTS idx_lancamentos_vencimento ON lancamentos(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_assistencias_status ON assistencias(status);
CREATE INDEX IF NOT EXISTS idx_atividades_modulo ON atividades(modulo);
CREATE INDEX IF NOT EXISTS idx_extrato_conta ON extrato_bancario(conta_id);
CREATE INDEX IF NOT EXISTS idx_mov_produto ON movimentos_estoque(produto_id);
CREATE INDEX IF NOT EXISTS idx_cobrancas_pedido ON cobrancas(pedido_id);
