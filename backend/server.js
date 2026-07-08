require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Na Vercel (e outros proxies) o IP real vem no X-Forwarded-For;
// sem isto o rate limit trata todos os usuários como um só IP.
app.set('trust proxy', 1);

// ── Segurança ──
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições. Aguarde um momento.' },
}));

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.static(path.join(__dirname, '../frontend')));
// Serve arquivos locais em dev (no Vercel use Cloudinary para uploads)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Rotas ──
app.use('/api/auth',          require('./src/routes/auth'));
app.use('/api/dashboard',     require('./src/routes/dashboard'));
app.use('/api/clientes',      require('./src/routes/clientes'));
app.use('/api/leads',         require('./src/routes/leads'));
app.use('/api/comercial',     require('./src/routes/comercial'));
app.use('/api/financeiro',    require('./src/routes/financeiro'));
app.use('/api/radar',         require('./src/routes/radar'));
app.use('/api/assistencia',   require('./src/routes/assistencia'));
app.use('/api/parceiros',     require('./src/routes/parceiros'));
app.use('/api/comissoes',     require('./src/routes/comissoes'));
app.use('/api/metas',         require('./src/routes/metas'));
app.use('/api/renders',       require('./src/routes/renders'));
app.use('/api/usuarios',      require('./src/routes/usuarios'));
app.use('/api/admin',         require('./src/routes/admin'));
app.use('/api/cobrancas',     require('./src/routes/cobrancas'));
app.use('/api/conciliacao',   require('./src/routes/conciliacao'));
app.use('/api/notas-fiscais', require('./src/routes/notas-fiscais'));
app.use('/api/estoque',       require('./src/routes/estoque'));
app.use('/api/orcamentos',    require('./src/routes/orcamentos'));
app.use('/api/kanban',        require('./src/routes/kanban'));
app.use('/api/ordens-servico',require('./src/routes/ordens-servico'));
app.use('/api/fornecedores',  require('./src/routes/fornecedores'));
app.use('/api/notificacoes',  require('./src/routes/notificacoes'));
app.use('/api/contratos',     require('./src/routes/contratos'));
app.use('/portal',            require('./src/routes/portal'));
app.use('/api/chatbot',       require('./src/routes/chatbot'));
app.use('/api/relatorios',    require('./src/routes/relatorios'));
app.use('/api/ranking',       require('./src/routes/ranking'));
app.use('/api/tesouraria',    require('./src/routes/tesouraria'));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ erro: 'Rota não encontrada' });
  }
  res.redirect('/');
});

app.use((err, req, res, next) => {
  console.error('[ERRO]', req.method, req.path, err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ erro: 'Arquivo muito grande (máximo 2MB)' });
  if (err.type === 'entity.too.large') return res.status(400).json({ erro: 'Requisição muito grande' });
  res.status(500).json({ erro: err.message || 'Erro interno do servidor' });
});

async function inicializar() {
  const db = require('./src/utils/db');

  // Garante linha de configurações da loja
  await db.run(`
    INSERT INTO configuracoes_loja (id, nome_empresa, cor_primaria)
    VALUES (1,'GM MÓBILE','#C4A24A')
    ON CONFLICT (id) DO NOTHING
  `);

  // Migrações de colunas novas no orcamentos
  const migracoes = [
    `ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS frete REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS montagem REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS tipo_projeto TEXT`,
    `ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS valor_entrada REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS num_parcelas INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS data_primeira_parcela TEXT`,
    `ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS dias_projeto INTEGER NOT NULL DEFAULT 7`,
    `ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS dias_producao INTEGER NOT NULL DEFAULT 20`,
    `ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS dias_montagem INTEGER NOT NULL DEFAULT 2`,
    `ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS brindes TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS campanha TEXT`,
    `ALTER TABLE itens_pedido ADD COLUMN IF NOT EXISTS cor TEXT`,
    `ALTER TABLE itens_pedido ADD COLUMN IF NOT EXISTS imagem_url TEXT`,
    `ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE pedidos    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,

    // ── Módulo Financeiro Fase 1 ──
    `ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS cliente_id     INTEGER`,
    `ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS fornecedor_id  INTEGER`,
    `ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS orcamento_id   INTEGER`,
    `ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS centro_custo_id INTEGER`,
    `ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS grupo_parcela_id UUID`,
    `ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS parcela_num    INTEGER DEFAULT 1`,
    `ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS parcela_total  INTEGER DEFAULT 1`,
    `ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS recorrencia    TEXT DEFAULT 'unica'`,
    `ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS origem         TEXT DEFAULT 'manual'`,
    `ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS competencia    DATE`,
    `ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS conciliado     BOOLEAN DEFAULT false`,
    `ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS num_documento  TEXT`,
    `ALTER TABLE categorias  ADD COLUMN IF NOT EXISTS centro_custo_id INTEGER`,
    `ALTER TABLE categorias  ADD COLUMN IF NOT EXISTS icone          TEXT`,
    `ALTER TABLE contas_correntes ADD COLUMN IF NOT EXISTS pix       TEXT`,
    `ALTER TABLE contas_correntes ADD COLUMN IF NOT EXISTS saldo_inicial REAL DEFAULT 0`,
    // ── Central de Tesouraria ──
    `ALTER TABLE contas_correntes ADD COLUMN IF NOT EXISTS saldo_minimo REAL DEFAULT 0`,
    `ALTER TABLE contas_correntes ADD COLUMN IF NOT EXISTS responsavel_id INTEGER`,
    `ALTER TABLE contas_correntes ADD COLUMN IF NOT EXISTS observacoes TEXT`,
    `CREATE TABLE IF NOT EXISTS fin_reservas (
      id SERIAL PRIMARY KEY,
      conta_id INTEGER NOT NULL,
      pedido_id INTEGER,
      descricao TEXT NOT NULL,
      valor NUMERIC(14,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'ativa',
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      liberado_em TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS fin_centros_custo (
      id    SERIAL PRIMARY KEY,
      nome  TEXT NOT NULL,
      cor   TEXT DEFAULT '#6366f1',
      ativo BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS fin_comissoes (
      id             SERIAL PRIMARY KEY,
      pedido_id      INTEGER,
      lancamento_id  INTEGER,
      usuario_id     INTEGER,
      tipo           TEXT,
      percentual     NUMERIC(5,2),
      valor_base     NUMERIC(14,2),
      valor_comissao NUMERIC(14,2),
      status         TEXT DEFAULT 'pendente',
      data_pagamento DATE,
      criado_em      TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS fin_custo_projeto (
      id            SERIAL PRIMARY KEY,
      pedido_id     INTEGER,
      categoria     TEXT,
      descricao     TEXT,
      valor         NUMERIC(14,2),
      lancamento_id INTEGER,
      criado_em     TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS fin_transferencias (
      id               SERIAL PRIMARY KEY,
      conta_origem_id  INTEGER,
      conta_destino_id INTEGER,
      valor            NUMERIC(14,2),
      data             DATE,
      descricao        TEXT,
      criado_em        TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS fin_log (
      id            SERIAL PRIMARY KEY,
      lancamento_id INTEGER,
      usuario_id    INTEGER,
      acao          TEXT,
      detalhe       JSONB,
      criado_em     TIMESTAMP DEFAULT NOW()
    )`,
    `ALTER TABLE fin_transferencias ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'concluida'`,
    `ALTER TABLE fin_transferencias ADD COLUMN IF NOT EXISTS criado_por INTEGER`,

    // ── Módulo Conciliação Bancária v2 ──
    `ALTER TABLE extrato_bancario ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'nao_analisado'`,
    `ALTER TABLE extrato_bancario ADD COLUMN IF NOT EXISTS fitid TEXT`,
    `ALTER TABLE extrato_bancario ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT 'manual'`,
    `ALTER TABLE extrato_bancario ADD COLUMN IF NOT EXISTS score_sugestao REAL`,
    `ALTER TABLE extrato_bancario ADD COLUMN IF NOT EXISTS divergencia_valor REAL`,
    `ALTER TABLE extrato_bancario ADD COLUMN IF NOT EXISTS observacoes TEXT`,
    `ALTER TABLE extrato_bancario ADD COLUMN IF NOT EXISTS memo TEXT`,
    `CREATE TABLE IF NOT EXISTS conciliacao_log (
      id            SERIAL PRIMARY KEY,
      extrato_id    INTEGER REFERENCES extrato_bancario(id) ON DELETE CASCADE,
      lancamento_id INTEGER,
      usuario_id    INTEGER,
      acao          TEXT NOT NULL,
      dados_antes   JSONB,
      dados_depois  JSONB,
      ip            TEXT,
      criado_em     TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_extrato_status ON extrato_bancario(status)`,
    `CREATE INDEX IF NOT EXISTS idx_extrato_fitid  ON extrato_bancario(fitid)`,
    `CREATE INDEX IF NOT EXISTS idx_conclog_extrato ON conciliacao_log(extrato_id)`,

    // ── Módulo Fornecedores v2 (central de relacionamento) ──
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS razao_social   TEXT`,
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS nome_fantasia  TEXT`,
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS ie             TEXT`,
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS website        TEXT`,
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS responsavel    TEXT`,
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS tipo           TEXT DEFAULT 'materiais'`,
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS favorito       BOOLEAN DEFAULT false`,
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS homologado     BOOLEAN DEFAULT false`,
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS logo_url       TEXT`,
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS categoria_id   INTEGER`,
    `CREATE TABLE IF NOT EXISTS forn_categorias (
      id     SERIAL PRIMARY KEY,
      nome   TEXT NOT NULL UNIQUE,
      cor    TEXT DEFAULT '#818cf8',
      ativo  BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS forn_produtos (
      id                  SERIAL PRIMARY KEY,
      fornecedor_id       INTEGER NOT NULL REFERENCES fornecedores(id) ON DELETE CASCADE,
      nome                TEXT NOT NULL,
      unidade             TEXT DEFAULT 'un',
      preco_atual         NUMERIC(14,2) DEFAULT 0,
      preco_anterior      NUMERIC(14,2),
      prazo_entrega_dias  INTEGER,
      principal           BOOLEAN DEFAULT false,
      ativo               BOOLEAN DEFAULT true,
      criado_em           TIMESTAMPTZ DEFAULT NOW(),
      atualizado_em       TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS forn_compras (
      id                    SERIAL PRIMARY KEY,
      fornecedor_id         INTEGER NOT NULL REFERENCES fornecedores(id) ON DELETE CASCADE,
      numero                TEXT,
      data_pedido           DATE NOT NULL DEFAULT CURRENT_DATE,
      data_entrega_prevista DATE,
      data_entrega_real     DATE,
      status                TEXT NOT NULL DEFAULT 'aberto',
      valor_total           NUMERIC(14,2) NOT NULL DEFAULT 0,
      itens                 JSONB DEFAULT '[]',
      forma_pagamento       TEXT,
      num_parcelas          INTEGER DEFAULT 1,
      grupo_parcela_id      UUID,
      observacoes           TEXT,
      criado_por            INTEGER,
      criado_em             TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS forn_documentos (
      id             SERIAL PRIMARY KEY,
      fornecedor_id  INTEGER NOT NULL REFERENCES fornecedores(id) ON DELETE CASCADE,
      tipo           TEXT NOT NULL DEFAULT 'anexo',
      nome           TEXT NOT NULL,
      url            TEXT NOT NULL,
      data_inicio    DATE,
      data_fim       DATE,
      valor_contrato NUMERIC(14,2),
      criado_por     INTEGER,
      criado_em      TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS forn_avaliacoes (
      id                  SERIAL PRIMARY KEY,
      fornecedor_id       INTEGER NOT NULL REFERENCES fornecedores(id) ON DELETE CASCADE,
      nota_preco          INTEGER NOT NULL CHECK(nota_preco BETWEEN 1 AND 5),
      nota_qualidade      INTEGER NOT NULL CHECK(nota_qualidade BETWEEN 1 AND 5),
      nota_prazo          INTEGER NOT NULL CHECK(nota_prazo BETWEEN 1 AND 5),
      nota_atendimento    INTEGER NOT NULL CHECK(nota_atendimento BETWEEN 1 AND 5),
      nota_pontualidade   INTEGER NOT NULL CHECK(nota_pontualidade BETWEEN 1 AND 5),
      nota_confiabilidade INTEGER NOT NULL CHECK(nota_confiabilidade BETWEEN 1 AND 5),
      comentario          TEXT,
      criado_por          INTEGER,
      criado_em           TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS forn_historico (
      id             SERIAL PRIMARY KEY,
      fornecedor_id  INTEGER NOT NULL REFERENCES fornecedores(id) ON DELETE CASCADE,
      tipo           TEXT NOT NULL,
      descricao      TEXT NOT NULL,
      criado_em      TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_forn_produtos_forn  ON forn_produtos(fornecedor_id)`,
    `CREATE INDEX IF NOT EXISTS idx_forn_compras_forn   ON forn_compras(fornecedor_id)`,
    `CREATE INDEX IF NOT EXISTS idx_forn_documentos_forn ON forn_documentos(fornecedor_id)`,
    `CREATE INDEX IF NOT EXISTS idx_forn_avaliacoes_forn ON forn_avaliacoes(fornecedor_id)`,
    `CREATE INDEX IF NOT EXISTS idx_forn_historico_forn  ON forn_historico(fornecedor_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lancamentos_fornecedor ON lancamentos(fornecedor_id)`,

    // ── Módulo Parceiros v2 (plataforma de gestão de relacionamento comercial) ──
    `ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS empresa             TEXT`,
    `ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS categoria_id        INTEGER`,
    `ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS percentual_comissao NUMERIC(5,2) DEFAULT 0`,
    `ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS instagram           TEXT`,
    `ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS website             TEXT`,
    `ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS responsavel         TEXT`,
    `ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS foto_url            TEXT`,
    `ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS vip                 BOOLEAN DEFAULT false`,
    `ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS premium             BOOLEAN DEFAULT false`,
    `ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS homologado          BOOLEAN DEFAULT false`,
    `CREATE TABLE IF NOT EXISTS parc_categorias (
      id     SERIAL PRIMARY KEY,
      nome   TEXT NOT NULL UNIQUE,
      cor    TEXT DEFAULT '#818cf8',
      ativo  BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS parc_documentos (
      id             SERIAL PRIMARY KEY,
      parceiro_id    INTEGER NOT NULL REFERENCES parceiros(id) ON DELETE CASCADE,
      tipo           TEXT NOT NULL DEFAULT 'anexo',
      nome           TEXT NOT NULL,
      url            TEXT NOT NULL,
      data_inicio    DATE,
      data_fim       DATE,
      valor_contrato NUMERIC(14,2),
      criado_por     INTEGER,
      criado_em      TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS parc_avaliacoes (
      id                          SERIAL PRIMARY KEY,
      parceiro_id                 INTEGER NOT NULL REFERENCES parceiros(id) ON DELETE CASCADE,
      nota_qualidade_indicacoes   INTEGER NOT NULL CHECK(nota_qualidade_indicacoes BETWEEN 1 AND 5),
      nota_relacionamento         INTEGER NOT NULL CHECK(nota_relacionamento BETWEEN 1 AND 5),
      nota_comprometimento        INTEGER NOT NULL CHECK(nota_comprometimento BETWEEN 1 AND 5),
      nota_comunicacao            INTEGER NOT NULL CHECK(nota_comunicacao BETWEEN 1 AND 5),
      nota_volume_vendas          INTEGER NOT NULL CHECK(nota_volume_vendas BETWEEN 1 AND 5),
      nota_pontualidade           INTEGER NOT NULL CHECK(nota_pontualidade BETWEEN 1 AND 5),
      comentario                  TEXT,
      criado_por                  INTEGER,
      criado_em                   TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS parc_historico (
      id           SERIAL PRIMARY KEY,
      parceiro_id  INTEGER NOT NULL REFERENCES parceiros(id) ON DELETE CASCADE,
      tipo         TEXT NOT NULL,
      descricao    TEXT NOT NULL,
      criado_em    TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS parceiro_id INTEGER REFERENCES parceiros(id)`,
    `ALTER TABLE pedidos    ADD COLUMN IF NOT EXISTS parceiro_id INTEGER REFERENCES parceiros(id)`,
    `CREATE INDEX IF NOT EXISTS idx_parc_documentos_parc ON parc_documentos(parceiro_id)`,
    `CREATE INDEX IF NOT EXISTS idx_parc_avaliacoes_parc ON parc_avaliacoes(parceiro_id)`,
    `CREATE INDEX IF NOT EXISTS idx_parc_historico_parc  ON parc_historico(parceiro_id)`,
    `CREATE INDEX IF NOT EXISTS idx_leads_parceiro       ON leads(parceiro_id)`,
    `CREATE INDEX IF NOT EXISTS idx_orcamentos_parceiro  ON orcamentos(parceiro_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_parceiro     ON pedidos(parceiro_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lancamentos_parceiro ON lancamentos(parceiro_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comissoes_pessoa_tipo ON comissoes(tipo, pessoa_id)`,

    // ── Corrige leads.etapa: a constraint original só aceitava o vocabulário
    // antigo (novo/contato/visita/proposta/negociacao/fechado/perdido), mas o
    // código (leads.js ETAPAS_VALIDAS) já usa o vocabulário novo do funil de
    // 13 etapas — toda criação de lead vinha falhando por violar a constraint.
    `ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_etapa_check`,
    `ALTER TABLE leads ADD CONSTRAINT leads_etapa_check CHECK (etapa IN (
      'novo','contato','visita','proposta','negociacao','fechado','perdido',
      'novo_lead','primeiro_contato','qualificacao','visita_agendada',
      'projeto','orcamento_enviado','contrato','pedido_confirmado',
      'producao','entrega','pos_venda'
    ))`,

    // ── Módulo Ordens de Serviço v2 (centro operacional) ──
    // Amplia o workflow de status (era só pendente/em_andamento/concluido/cancelado)
    `ALTER TABLE ordens_servico DROP CONSTRAINT IF EXISTS ordens_servico_status_check`,
    `ALTER TABLE ordens_servico ADD CONSTRAINT ordens_servico_status_check CHECK (status IN (
      'pendente','agendada','separando_materiais','em_producao','pronta_instalacao',
      'em_deslocamento','em_andamento','pausada','aguardando_cliente','aguardando_material',
      'concluido','cancelado'
    ))`,
    `ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS prioridade            TEXT DEFAULT 'normal'`,
    `ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS tempo_previsto_min    INTEGER`,
    `ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS hora_chegada          TIMESTAMPTZ`,
    `ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS hora_saida            TIMESTAMPTZ`,
    `ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS latitude_chegada      NUMERIC(10,6)`,
    `ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS longitude_chegada     NUMERIC(10,6)`,
    `ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS latitude_saida        NUMERIC(10,6)`,
    `ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS longitude_saida       NUMERIC(10,6)`,
    `ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS assinatura_cliente_url TEXT`,
    `ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS assinatura_tecnico_url TEXT`,
    `ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS avaliacao_nota        INTEGER CHECK(avaliacao_nota BETWEEN 1 AND 5)`,
    `ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS avaliacao_comentario  TEXT`,
    `ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS checklist_progresso   INTEGER DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS os_checklist (
      id             SERIAL PRIMARY KEY,
      os_id          INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
      categoria      TEXT NOT NULL DEFAULT 'geral',
      item           TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','em_andamento','concluido')),
      ordem          INTEGER DEFAULT 0,
      concluido_por  INTEGER,
      concluido_em   TIMESTAMPTZ,
      criado_em      TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS os_equipe (
      id          SERIAL PRIMARY KEY,
      os_id       INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
      usuario_id  INTEGER REFERENCES usuarios(id),
      nome        TEXT NOT NULL,
      funcao      TEXT NOT NULL DEFAULT 'montador',
      telefone    TEXT,
      status      TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','confirmado','concluido')),
      criado_em   TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS os_materiais (
      id           SERIAL PRIMARY KEY,
      os_id        INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
      produto_id   INTEGER REFERENCES produtos(id),
      nome         TEXT NOT NULL,
      quantidade   NUMERIC(14,2) NOT NULL DEFAULT 1,
      status       TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','reservado','separado','utilizado')),
      criado_em    TIMESTAMPTZ DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS os_fotos (
      id          SERIAL PRIMARY KEY,
      os_id       INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
      categoria   TEXT NOT NULL DEFAULT 'durante' CHECK(categoria IN ('antes','durante','depois','garantia','cliente')),
      url         TEXT NOT NULL,
      criado_por  INTEGER,
      criado_em   TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS os_historico (
      id          SERIAL PRIMARY KEY,
      os_id       INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
      tipo        TEXT NOT NULL,
      descricao   TEXT NOT NULL,
      criado_em   TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_os_checklist_os  ON os_checklist(os_id)`,
    `CREATE INDEX IF NOT EXISTS idx_os_equipe_os     ON os_equipe(os_id)`,
    `CREATE INDEX IF NOT EXISTS idx_os_materiais_os  ON os_materiais(os_id)`,
    `CREATE INDEX IF NOT EXISTS idx_os_fotos_os      ON os_fotos(os_id)`,
    `CREATE INDEX IF NOT EXISTS idx_os_historico_os  ON os_historico(os_id)`,
    `CREATE INDEX IF NOT EXISTS idx_os_cliente        ON ordens_servico(cliente_id)`,
    `CREATE INDEX IF NOT EXISTS idx_os_pedido         ON ordens_servico(pedido_id)`,
    `CREATE INDEX IF NOT EXISTS idx_os_tecnico        ON ordens_servico(tecnico_id)`,
    `CREATE INDEX IF NOT EXISTS idx_os_status         ON ordens_servico(status)`,

    // ── Módulo Notas Fiscais ──
    `CREATE TABLE IF NOT EXISTS notas_fiscais (
      id                      SERIAL PRIMARY KEY,
      numero                  INTEGER,
      serie                   TEXT DEFAULT '1',
      modelo                  TEXT DEFAULT '55',
      tipo                    TEXT NOT NULL DEFAULT 'saida'
                              CHECK(tipo IN ('saida','entrada','ajuste','devolucao')),
      natureza_operacao       TEXT DEFAULT 'Venda de Mercadoria',
      cfop                    TEXT,
      finalidade              TEXT DEFAULT '1',
      status                  TEXT NOT NULL DEFAULT 'rascunho'
                              CHECK(status IN ('rascunho','pendente','transmitindo',
                                               'autorizada','cancelada','rejeitada',
                                               'denegada','inutilizada')),
      chave_acesso            TEXT,
      protocolo               TEXT,
      xml                     TEXT,
      pdf_url                 TEXT,
      qrcode                  TEXT,
      motivo_rejeicao         TEXT,
      pedido_id               INTEGER REFERENCES pedidos(id),
      cliente_id              INTEGER REFERENCES clientes(id),
      fornecedor_id           INTEGER,
      lancamento_id           INTEGER,
      data_emissao            TEXT,
      data_saida              TEXT,
      hora_saida              TEXT,
      valor_produtos          REAL DEFAULT 0,
      valor_frete             REAL DEFAULT 0,
      valor_seguro            REAL DEFAULT 0,
      valor_desconto          REAL DEFAULT 0,
      valor_outros            REAL DEFAULT 0,
      valor_total             REAL DEFAULT 0,
      valor_icms              REAL DEFAULT 0,
      valor_ipi               REAL DEFAULT 0,
      valor_pis               REAL DEFAULT 0,
      valor_cofins            REAL DEFAULT 0,
      valor_iss               REAL DEFAULT 0,
      aliquota_iss            REAL DEFAULT 0,
      forma_pagamento         TEXT DEFAULT 'outros',
      transportadora          TEXT,
      placa_veiculo           TEXT,
      uf_veiculo              TEXT,
      observacoes             TEXT,
      informacoes_adicionais  TEXT,
      usuario_id              INTEGER,
      criado_em               TIMESTAMPTZ DEFAULT NOW(),
      atualizado_em           TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS nf_itens (
      id                SERIAL PRIMARY KEY,
      nota_id           INTEGER NOT NULL REFERENCES notas_fiscais(id) ON DELETE CASCADE,
      produto_id        INTEGER,
      codigo            TEXT,
      descricao         TEXT NOT NULL,
      ncm               TEXT,
      cfop              TEXT,
      unidade           TEXT DEFAULT 'UN',
      quantidade        REAL DEFAULT 1,
      valor_unitario    REAL DEFAULT 0,
      valor_desconto    REAL DEFAULT 0,
      valor_total       REAL DEFAULT 0,
      valor_icms        REAL DEFAULT 0,
      valor_ipi         REAL DEFAULT 0,
      valor_pis         REAL DEFAULT 0,
      valor_cofins      REAL DEFAULT 0,
      aliquota_icms     REAL DEFAULT 0,
      aliquota_ipi      REAL DEFAULT 0,
      aliquota_pis      REAL DEFAULT 0,
      aliquota_cofins   REAL DEFAULT 0,
      cst_icms          TEXT DEFAULT '00',
      cst_pis           TEXT DEFAULT '01',
      cst_cofins        TEXT DEFAULT '01',
      csosn             TEXT,
      ordem             INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS nf_eventos (
      id          SERIAL PRIMARY KEY,
      nota_id     INTEGER NOT NULL REFERENCES notas_fiscais(id) ON DELETE CASCADE,
      tipo        TEXT NOT NULL,
      descricao   TEXT,
      xml         TEXT,
      protocolo   TEXT,
      status      TEXT DEFAULT 'pendente',
      usuario_id  INTEGER,
      criado_em   TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS nf_log (
      id          SERIAL PRIMARY KEY,
      nota_id     INTEGER REFERENCES notas_fiscais(id) ON DELETE CASCADE,
      usuario_id  INTEGER,
      acao        TEXT NOT NULL,
      detalhes    JSONB,
      ip          TEXT,
      criado_em   TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_nf_status    ON notas_fiscais(status)`,
    `CREATE INDEX IF NOT EXISTS idx_nf_cliente   ON notas_fiscais(cliente_id)`,
    `CREATE INDEX IF NOT EXISTS idx_nf_pedido    ON notas_fiscais(pedido_id)`,
    `CREATE INDEX IF NOT EXISTS idx_nf_emissao   ON notas_fiscais(data_emissao)`,
    `CREATE INDEX IF NOT EXISTS idx_nf_itens_nota ON nf_itens(nota_id)`,

    // ── CRM v2 — novas colunas em leads ──
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS cidade           TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS cpf              TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS endereco         TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS projeto_desejado TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS ultimo_contato   TIMESTAMPTZ`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS temperatura      TEXT DEFAULT 'morno'`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS probabilidade    INTEGER DEFAULT 30`,

    // Garantir tabela de interações
    `CREATE TABLE IF NOT EXISTS lead_interacoes (
      id         SERIAL PRIMARY KEY,
      lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      tipo       TEXT NOT NULL DEFAULT 'nota',
      descricao  TEXT,
      usuario_id INTEGER,
      criado_em  TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_lead_inter_lead ON lead_interacoes(lead_id)`,

    // Migrar etapas antigas para novas nomenclaturas
    `UPDATE leads SET etapa='novo_lead'         WHERE etapa='novo'`,
    `UPDATE leads SET etapa='primeiro_contato'  WHERE etapa='contato'`,
    `UPDATE leads SET etapa='visita_agendada'   WHERE etapa='visita'`,
    `UPDATE leads SET etapa='orcamento_enviado' WHERE etapa='proposta'`,
    `UPDATE leads SET etapa='pedido_confirmado' WHERE etapa='fechado'`,

    // ── Rastreabilidade: Lead → Cliente → Orçamento → Pedido ──
    `ALTER TABLE clientes  ADD COLUMN IF NOT EXISTS lead_id  INTEGER`,
    `ALTER TABLE pedidos   ADD COLUMN IF NOT EXISTS lead_id  INTEGER`,
    `ALTER TABLE pedidos   ADD COLUMN IF NOT EXISTS origem   TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_clientes_lead ON clientes(lead_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_lead  ON pedidos(lead_id)`,

    // ── Kanban de Produção v2 ──
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS prioridade              TEXT    DEFAULT 'media'`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS responsavel_producao_id INTEGER`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS progresso               INTEGER DEFAULT 0`,
    `ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS projetista_id           INTEGER`,
    `CREATE TABLE IF NOT EXISTS kanban_timeline (
      id         SERIAL PRIMARY KEY,
      pedido_id  INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      tipo       TEXT    NOT NULL DEFAULT 'etapa',
      descricao  TEXT,
      usuario_id INTEGER,
      criado_em  TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS kanban_checklist (
      id         SERIAL PRIMARY KEY,
      pedido_id  INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      etapa      TEXT    NOT NULL,
      item       TEXT    NOT NULL,
      concluido  BOOLEAN DEFAULT FALSE,
      ordem      INTEGER DEFAULT 0,
      criado_em  TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ktl_pedido ON kanban_timeline(pedido_id)`,
    `CREATE INDEX IF NOT EXISTS idx_kch_pedido ON kanban_checklist(pedido_id, etapa)`,
    // Migrar etapas antigas para nomenclatura nova do kanban v2
    `UPDATE pedidos SET etapa_producao='novo_pedido'          WHERE etapa_producao IS NULL OR etapa_producao=''`,
    `UPDATE pedidos SET etapa_producao='aguardando_medicao'   WHERE etapa_producao='medicao'`,
    `UPDATE pedidos SET etapa_producao='projeto_3d'           WHERE etapa_producao='projeto'`,
    `UPDATE pedidos SET etapa_producao='aguardando_aprovacao' WHERE etapa_producao='aprovacao'`,
    `UPDATE pedidos SET etapa_producao='entrega_agendada'     WHERE etapa_producao='entrega'`,
    `UPDATE pedidos SET etapa_producao='montagem'             WHERE etapa_producao='instalacao'`,
    `UPDATE pedidos SET etapa_producao='concluido'            WHERE etapa_producao='pronto' OR etapa_producao='concluido'`,
  ];
  for (const sql of migracoes) {
    await db.run(sql).catch(() => {});
  }

  // Limpeza automática de registros excluídos há mais de 15 dias
  setInterval(async () => {
    try {
      await db.run(`DELETE FROM orcamentos WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '15 days'`);
      await db.run(`DELETE FROM pedidos    WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '15 days'`);
    } catch (e) { console.error('[lixeira-cleanup]', e.message); }
  }, 6 * 60 * 60 * 1000); // a cada 6h

  // Seed permissões padrão (não sobrescreve customizações)
  const DEFAULTS = {
    vendedor: {
      dashboard:'leitura', ranking:'leitura', agenda:'leitura', relatorios:'leitura',
      clientes:'edicao', crm:'edicao', comercial:'edicao', renders:'edicao',
      radar:'leitura', assistencia:'leitura', estoque:'leitura',
      financeiro:'sem_acesso', notas_fiscais:'sem_acesso', contas:'sem_acesso',
      categorias:'sem_acesso', comissoes:'leitura', parceiros:'leitura',
      usuarios:'sem_acesso', configuracoes:'sem_acesso',
    },
    tecnico: {
      dashboard:'leitura', ranking:'sem_acesso', agenda:'leitura', relatorios:'sem_acesso',
      clientes:'leitura', crm:'sem_acesso', comercial:'leitura', renders:'leitura',
      radar:'leitura', assistencia:'total', estoque:'leitura',
      financeiro:'sem_acesso', notas_fiscais:'sem_acesso', contas:'sem_acesso',
      categorias:'sem_acesso', comissoes:'sem_acesso', parceiros:'sem_acesso',
      usuarios:'sem_acesso', configuracoes:'sem_acesso',
    },
    financeiro: {
      dashboard:'leitura', ranking:'leitura', agenda:'leitura', relatorios:'total',
      clientes:'leitura', crm:'leitura', comercial:'leitura', renders:'sem_acesso',
      radar:'leitura', assistencia:'sem_acesso', estoque:'total',
      financeiro:'total', notas_fiscais:'total', contas:'total',
      categorias:'total', comissoes:'total', parceiros:'leitura',
      usuarios:'sem_acesso', configuracoes:'sem_acesso',
    },
  };

  for (const [perfil, mods] of Object.entries(DEFAULTS)) {
    for (const [modulo, nivel] of Object.entries(mods)) {
      await db.run(
        'INSERT INTO permissoes (perfil, modulo, nivel) VALUES ($1,$2,$3) ON CONFLICT (perfil, modulo) DO NOTHING',
        [perfil, modulo, nivel]
      );
    }
  }

}

if (process.env.VERCEL) {
  // Serverless: sem listen (a Vercel invoca o app exportado) e sem rodar
  // as ~300 migrações a cada cold start — o banco Neon já está migrado
  // pelas execuções locais. Para forçar migração em produção, faça um
  // deploy com a env RUN_MIGRATIONS=1 e depois remova.
  if (process.env.RUN_MIGRATIONS === '1') {
    inicializar().catch(err => console.error('[migracoes]', err.message));
  }
} else {
  inicializar()
    .then(() => {
      const PORT = process.env.PORT || 3000;
      app.listen(PORT, () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`);
      });
    })
    .catch(err => {
      console.error('[FATAL] Erro ao inicializar servidor:', err);
      process.exit(1);
    });
}

module.exports = app;
