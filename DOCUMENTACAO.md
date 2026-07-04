# SISTEMA DE GESTÃO — MÓVEIS PLANEJADOS
## Documentação Completa do Sistema

---

## ÍNDICE

1. [Stack Técnica](#1-stack-técnica)
2. [Credenciais de Acesso](#2-credenciais-de-acesso)
3. [Estrutura de Arquivos](#3-estrutura-de-arquivos)
4. [Banco de Dados — Tabelas](#4-banco-de-dados--tabelas)
5. [Backend — Rotas da API](#5-backend--rotas-da-api)
6. [Frontend — Páginas](#6-frontend--páginas)
7. [Funcionalidades Implementadas](#7-funcionalidades-implementadas)
8. [Perfis e Permissões](#8-perfis-e-permissões)
9. [Como Iniciar o Sistema](#9-como-iniciar-o-sistema)

---

## 1. STACK TÉCNICA

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML5 + CSS3 + JavaScript Vanilla |
| Backend | Node.js + Express |
| Banco de dados | SQLite (better-sqlite3, modo WAL) |
| Autenticação | JWT (localStorage) |
| PDF | jsPDF + jspdf-autotable (CDN) |
| Upload de arquivos | Multer |
| Ícones | Lucide Icons (CDN) |
| Gráficos | Chart.js (CDN) |

---

## 2. CREDENCIAIS DE ACESSO

| Campo | Valor |
|-------|-------|
| Email | `admin@sistema.com` |
| Senha | `admin123` |
| Perfil | Gestor (acesso total) |

---

## 3. ESTRUTURA DE ARQUIVOS

```
SISTEMA COMPLETO/
├── backend/
│   ├── server.js                    ← Ponto de entrada, migrações, config Express
│   ├── database.js                  ← Conexão SQLite
│   ├── uploads/
│   │   ├── logo/                    ← Logo da empresa
│   │   ├── fotos/                   ← Fotos de usuários
│   │   └── renders/                 ← Renders e projetos
│   └── src/routes/
│       ├── auth.js
│       ├── usuarios.js
│       ├── clientes.js
│       ├── comercial.js
│       ├── financeiro.js
│       ├── dashboard.js
│       ├── leads.js
│       ├── radar.js
│       ├── assistencia.js
│       ├── parceiros.js
│       ├── comissoes.js
│       ├── metas.js
│       ├── renders.js
│       ├── admin.js
│       ├── cobrancas.js
│       ├── conciliacao.js
│       ├── estoque.js
│       ├── orcamentos.js
│       ├── kanban.js
│       ├── ordens-servico.js
│       ├── fornecedores.js
│       ├── notificacoes.js          ← NOVO
│       └── portal.js                ← NOVO (rota pública)
└── frontend/
    ├── assets/
    │   ├── css/
    │   │   ├── global.css           ← Variáveis, tema claro/escuro, reset
    │   │   └── layout.css           ← Sidebar, topbar, grids, mobile
    │   └── js/
    │       └── layout.js            ← Sidebar, topbar, tema, notificações
    └── pages/
        ├── index.html               ← Login
        ├── dashboard.html
        ├── clientes.html
        ├── comercial.html
        ├── leads.html
        ├── radar.html
        ├── orcamentos.html
        ├── assistencia.html
        ├── estoque.html
        ├── financeiro.html
        ├── conciliacao.html
        ├── parceiros.html
        ├── comissoes.html
        ├── metas.html
        ├── renders.html
        ├── kanban.html
        ├── ordens-servico.html
        ├── fornecedores.html
        ├── usuarios.html
        ├── configuracoes.html
        ├── contas.html
        ├── categorias.html
        ├── notas-fiscais.html
        ├── agenda.html
        ├── ranking.html
        ├── relatorios.html
        ├── crm.html
        └── portal-cliente.html      ← NOVO (página pública)
```

---

## 4. BANCO DE DADOS — TABELAS

### `usuarios`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| nome | TEXT | Nome completo |
| email | TEXT UNIQUE | E-mail de login |
| senha_hash | TEXT | bcrypt |
| perfil | TEXT | gestor / vendedor / tecnico / financeiro |
| foto | TEXT | Caminho do arquivo |
| ativo | INTEGER | 1 = ativo, 0 = excluído |
| criado_em | TEXT | Data/hora |

### `clientes`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| nome | TEXT NOT NULL | — |
| cpf_cnpj | TEXT | — |
| email | TEXT | — |
| telefone | TEXT | — |
| whatsapp | TEXT | Número para WhatsApp |
| cep, rua, numero, bairro, cidade, estado | TEXT | Endereço completo |
| data_nascimento | TEXT | — |
| origem | TEXT | Como chegou (indicação, google, etc.) |
| vendedor_id | INTEGER FK | Vendedor responsável |
| tipo_servico | TEXT | Tipo de projeto |
| comodos | TEXT | JSON com lista de cômodos |
| ativo | INTEGER | Soft delete |

### `orcamentos`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| numero | TEXT UNIQUE | Ex: ORC-2025-001 |
| cliente_id | INTEGER FK | — |
| vendedor_id | INTEGER FK | — |
| status | TEXT | rascunho / enviado / aprovado / recusado / expirado |
| validade | TEXT | Data de validade |
| valor_total | REAL | Sem desconto |
| desconto | REAL | Valor de desconto |
| observacoes | TEXT | — |

### `itens_orcamento`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| orcamento_id | INTEGER FK | — |
| ambiente | TEXT | Ex: Cozinha, Quarto |
| descricao | TEXT NOT NULL | — |
| material | TEXT | — |
| quantidade | INTEGER | — |
| valor_unitario | REAL | — |
| valor_total | REAL | — |

### `pedidos`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| numero | TEXT UNIQUE | Ex: PED-2025-001 |
| orcamento_id | INTEGER FK | Origem |
| cliente_id | INTEGER FK | — |
| vendedor_id | INTEGER FK | — |
| status | TEXT | Em aberto / produção / entregue / concluído / cancelado |
| valor_total | REAL | — |
| desconto | REAL | — |
| valor_final | REAL | Total menos desconto |
| condicao_pagamento | TEXT | Ex: 50% entrada + saldo na entrega |
| data_prevista_entrega | TEXT | — |
| data_entrega_real | TEXT | — |
| etapa_producao | TEXT | medicao / projeto / aprovacao / producao / entrega / instalacao |
| token | TEXT UNIQUE | Token para Portal do Cliente |
| prazo_garantia_meses | INTEGER | Default: 12 meses |

### `itens_pedido`
Mesmo esquema de `itens_orcamento`, com FK em `pedido_id`.

### `ordens_servico`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| numero | TEXT UNIQUE | — |
| pedido_id | INTEGER FK | Pedido relacionado |
| cliente_id | INTEGER FK | — |
| tecnico_id | INTEGER FK | Técnico responsável |
| tipo | TEXT | instalacao / manutencao / visita / entrega |
| status | TEXT | pendente / em_andamento / concluido / cancelado |
| data_agendada | TEXT | — |
| descricao | TEXT | Descrição do serviço |
| itens_instalados | TEXT | — |
| observacoes_tecnico | TEXT | — |
| concluido_em | TEXT | — |

### `assistencias`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| numero | TEXT UNIQUE | — |
| cliente_id | INTEGER FK | — |
| pedido_id | INTEGER FK | — |
| tecnico_id | INTEGER FK | — |
| tipo_problema | TEXT | — |
| descricao | TEXT NOT NULL | — |
| urgencia | TEXT | critico / alto / medio / baixo |
| status | TEXT | aberto / agendado / em_andamento / concluido |
| data_abertura | TEXT | — |
| data_agendamento | TEXT | — |
| data_conclusao | TEXT | — |
| resolucao | TEXT | Como foi resolvido |

### `leads`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| nome | TEXT NOT NULL | — |
| empresa | TEXT | — |
| telefone / whatsapp / email | TEXT | — |
| origem | TEXT | Como chegou |
| produto_interesse | TEXT | — |
| valor_estimado | REAL | — |
| vendedor_id | INTEGER FK | — |
| parceiro_id | INTEGER FK | Indicado por parceiro |
| etapa | TEXT | novo / contato / visita / proposta / negociacao / fechado / perdido |
| motivo_perda | TEXT | — |
| cliente_id | INTEGER FK | Após conversão |

### `lead_interacoes`
| Coluna | Tipo |
|--------|------|
| id | INTEGER PK |
| lead_id | INTEGER FK |
| tipo | TEXT (ligacao, email, visita, whatsapp) |
| descricao | TEXT NOT NULL |
| usuario_id | INTEGER FK |
| criado_em | TEXT |

### `parceiros`
Dados cadastrais completos (nome, CPF/CNPJ, endereço, dados bancários, PIX, observações).

### `fornecedores`
Dados cadastrais completos (nome, CNPJ, endereço, dados bancários, PIX, prazo de pagamento, categoria).

### `categorias`
| Coluna | Tipo |
|--------|------|
| id | INTEGER PK |
| nome | TEXT |
| tipo | TEXT (receita / despesa / produto) |
| cor | TEXT |
| ativa | INTEGER |

### `contas_correntes`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| nome | TEXT | Ex: Banco do Brasil, Caixa Físico |
| tipo | TEXT | corrente / poupança / caixa |
| banco | TEXT | — |
| saldo_inicial | REAL | — |
| cor | TEXT | Cor visual |
| ativa | INTEGER | — |

### `lancamentos`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| tipo | TEXT | receita / despesa |
| descricao | TEXT NOT NULL | — |
| valor | REAL NOT NULL | — |
| data_vencimento | TEXT | — |
| data_pagamento | TEXT | Quando pago |
| status | TEXT | pendente / pago / cancelado |
| forma_pagamento | TEXT | Pix, dinheiro, cartão… |
| conta_id | INTEGER FK | Conta bancária |
| categoria_id | INTEGER FK | — |
| pedido_id | INTEGER FK | Vinculo com pedido |
| parceiro_id | INTEGER FK | Vinculo com parceiro |

### `extrato_bancario`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| conta_id | INTEGER FK | — |
| data | TEXT | — |
| descricao | TEXT | — |
| valor | REAL | — |
| tipo | TEXT | credito / debito |
| conciliado | INTEGER | 0 = não / 1 = sim |
| lancamento_id | INTEGER FK | Vínculo de conciliação |

### `comissoes`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| tipo | TEXT | vendedor / parceiro |
| pessoa_id | INTEGER | ID do vendedor ou parceiro |
| pedido_id | INTEGER FK | — |
| valor_pedido | REAL | — |
| percentual | REAL | % de comissão |
| valor_comissao | REAL | — |
| status | TEXT | pendente / pago |
| data_pagamento | TEXT | — |
| forma_pagamento | TEXT | — |

### `metas`
| Coluna | Tipo |
|--------|------|
| id | INTEGER PK |
| vendedor_id | INTEGER FK |
| mes | INTEGER |
| ano | INTEGER |
| valor_meta | REAL |
| UNIQUE(vendedor_id, mes, ano) | — |

### `produtos`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| nome | TEXT NOT NULL | — |
| codigo | TEXT | Código/SKU |
| categoria | TEXT | — |
| unidade | TEXT | un, m², kg, etc. |
| estoque_atual | REAL | — |
| estoque_minimo | REAL | Alerta abaixo deste valor |
| valor_custo | REAL | — |
| ativo | INTEGER | — |

### `movimentos_estoque`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| produto_id | INTEGER FK | — |
| tipo | TEXT | entrada / saida / ajuste |
| quantidade | REAL | — |
| valor_unitario | REAL | — |
| observacao | TEXT | — |
| pedido_id | INTEGER FK | — |
| usuario_id | INTEGER FK | Quem registrou |

### `renders`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| nome | TEXT NOT NULL | — |
| arquivo_path | TEXT | Caminho do arquivo |
| tipo | TEXT | imagem / pdf |
| ambiente | TEXT | — |
| cliente_id | INTEGER FK | — |
| pedido_id | INTEGER FK | — |
| token_publico | TEXT | Link público para aprovação |
| aprovado | INTEGER | 0 / 1 |
| data_aprovacao | TEXT | — |

### `configuracoes_loja`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER (sempre 1) | Linha única |
| nome_empresa | TEXT | — |
| cnpj | TEXT | — |
| telefone / whatsapp / email / site | TEXT | — |
| cep, rua, numero, bairro, cidade, estado | TEXT | Endereço |
| logo_path | TEXT | Caminho do logo |
| cor_primaria | TEXT | Default: #6366f1 |

### `cobrancas`
| Coluna | Tipo |
|--------|------|
| id | INTEGER PK |
| pedido_id | INTEGER FK |
| observacao | TEXT NOT NULL |
| data_cobranca | TEXT |
| usuario_id | INTEGER FK |

### `historico_orcamentos` *(NOVO)*
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| orcamento_id | INTEGER FK | — |
| usuario_id | INTEGER FK | — |
| usuario_nome | TEXT | Snapshot do nome |
| descricao | TEXT NOT NULL | Evento registrado |
| criado_em | TEXT | — |

### `permissoes`
| Coluna | Tipo |
|--------|------|
| id | INTEGER PK |
| perfil | TEXT (gestor/vendedor/tecnico/financeiro) |
| modulo | TEXT |
| nivel | TEXT (sem_acesso / leitura / edicao / total) |
| UNIQUE(perfil, modulo) | — |

### `permissoes_usuario`
Mesmo esquema, mas por `usuario_id` — substitui as permissões do perfil para aquele usuário.

### `atividades`
Log de auditoria — todas as ações do sistema são registradas com acao, modulo, descricao, referencia_id e usuario_id.

---

## 5. BACKEND — ROTAS DA API

Base URL: `http://localhost:3000/api`

### AUTH `/api/auth`
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/login` | Login com e-mail e senha → JWT |
| GET | `/me` | Perfil do usuário autenticado |
| GET | `/usuarios` | Lista usuários (para selects) |
| POST | `/trocar-senha` | Troca senha do usuário logado |

### USUÁRIOS `/api/usuarios`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Lista usuários ativos |
| GET | `/minhas-permissoes` | Permissões efetivas do usuário atual |
| GET | `/permissoes/:perfil` | Permissões de um perfil (gestor only) |
| PUT | `/permissoes/:perfil` | Atualiza permissões de perfil |
| GET | `/:id/permissoes` | Permissões individuais de um usuário |
| PUT | `/:id/permissoes` | Define overrides individuais |
| DELETE | `/:id/permissoes` | Remove overrides (volta ao padrão do perfil) |
| GET | `/:id` | Detalhes de um usuário |
| POST | `/` | Cria usuário (com upload de foto) |
| PUT | `/:id` | Atualiza usuário |
| PUT | `/:id/senha` | Troca senha de outro usuário |
| DELETE | `/:id` | Desativa usuário (soft delete) |

### CLIENTES `/api/clientes`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Lista clientes (busca por nome/email/telefone/CPF) |
| GET | `/:id` | Detalhes + pedidos do cliente |
| POST | `/` | Cadastra cliente |
| PUT | `/:id` | Atualiza cliente |
| POST | `/importar` | Importação em massa via CSV |
| DELETE | `/:id` | Desativa cliente (soft delete) |

### COMERCIAL `/api/comercial`
#### Orçamentos
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/orcamentos` | Lista orçamentos |
| GET | `/orcamentos/:id` | Detalhes com itens |
| POST | `/orcamentos` | Cria orçamento |
| PUT | `/orcamentos/:id` | Atualiza orçamento e itens |
| PUT | `/orcamentos/:id/status` | Atualiza status |
| GET | `/orcamentos/:id/historico` | Histórico de negociações *(NOVO)* |
| POST | `/orcamentos/:id/converter-pedido` | Converte em pedido |

#### Pedidos
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/pedidos` | Lista pedidos |
| GET | `/pedidos/:id` | Detalhes do pedido |
| PUT | `/pedidos/:id/status` | Atualiza status → gera link WhatsApp *(NOVO)* |
| PUT | `/pedidos/:id/prazo` | Atualiza prazo de entrega |

### FINANCEIRO `/api/financeiro`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/categorias` | Lista categorias |
| POST | `/categorias` | Cria categoria |
| PUT | `/categorias/:id` | Atualiza categoria |
| DELETE | `/categorias/:id` | Desativa categoria |
| GET | `/contas` | Lista contas bancárias com saldo calculado |
| POST | `/contas` | Cria conta |
| PUT | `/contas/:id` | Atualiza conta |
| GET | `/lancamentos` | Lista lançamentos (filtros: tipo, status, data, conta, cliente, atraso) |
| POST | `/lancamentos` | Cria lançamento |
| PUT | `/lancamentos/:id` | Atualiza lançamento |
| PUT | `/lancamentos/:id/pagar` | Registra pagamento |
| DELETE | `/lancamentos/:id` | Cancela lançamento |
| GET | `/fluxo` | Projeção de fluxo de caixa diário |
| GET | `/resumo` | Resumo financeiro do mês |
| GET | `/dre` | DRE por mês/ano |
| GET | `/projecao` | Projeção para os próximos N dias |
| GET | `/notas` | Lista notas fiscais |
| GET | `/notas/:id` | Detalhes da nota |
| POST | `/notas` | Cria nota |
| PUT | `/notas/:id` | Atualiza nota |

### DASHBOARD `/api/dashboard`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/kpis` | KPIs do mês (vendas, receita prevista, clientes, pedidos atrasados, leads, meta) |
| GET | `/radar` | Pedidos atrasados e com entrega nos próximos 7 dias |
| GET | `/grafico-vendas` | Dados do gráfico dos últimos 6 meses |
| GET | `/ranking` | Top 5 vendedores do mês |
| GET | `/atividades` | Atividades recentes (clientes, pedidos, leads) |

### LEADS `/api/leads`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Lista leads (filtros: etapa, vendedor, busca) |
| GET | `/:id` | Detalhes com interações |
| POST | `/` | Cria lead |
| PUT | `/:id` | Atualiza lead |
| PUT | `/:id/etapa` | Avança/retrocede etapa |
| POST | `/:id/interacoes` | Registra interação |
| POST | `/:id/converter` | Converte lead em cliente |

### RADAR `/api/radar`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Painel de pedidos e OS por situação (atrasado/urgente/ok) |
| GET | `/calendario` | Visão de calendário por mês/ano |

### ASSISTÊNCIA `/api/assistencia`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Lista chamados (filtros: status, urgência, busca) |
| GET | `/:id` | Detalhes do chamado |
| POST | `/` | Abre chamado |
| PUT | `/:id/status` | Atualiza status |
| PUT | `/:id/tecnico` | Atribui técnico e agenda |
| PUT | `/:id` | Atualiza chamado |

### PARCEIROS `/api/parceiros`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Lista parceiros com estatísticas (indicações, conversões, comissões) |
| GET | `/:id` | Detalhes com lista de indicações |
| POST | `/` | Cadastra parceiro |
| PUT | `/:id` | Atualiza parceiro |
| DELETE | `/:id` | Desativa parceiro |

### COMISSÕES `/api/comissoes`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Lista comissões (filtros: status, tipo) |
| POST | `/` | Cria comissão |
| PUT | `/:id/pagar` | Paga comissão (cria lançamento de despesa) |

### METAS `/api/metas`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/ranking` | Ranking de vendedores com metas por mês/ano |
| GET | `/` | Metas por mês/ano |
| POST | `/` | Define/atualiza meta de vendedor |
| GET | `/vendedores` | Lista vendedores ativos |

### RENDERS `/api/renders`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Lista renders (filtro por cliente) |
| GET | `/:id` | Detalhes |
| POST | `/` | Upload de render (imagem/PDF, até 10MB) |
| PUT | `/:id/aprovar` | Aprova render |
| DELETE | `/:id` | Remove render |

### ADMIN `/api/admin`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/atividades` | Log de auditoria (filtro por módulo) |
| GET | `/configuracoes-loja` | Dados da empresa |
| PUT | `/configuracoes-loja` | Atualiza dados + logo da empresa |
| GET | `/backup` | Download do banco SQLite |

### COBRANÇAS `/api/cobrancas`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Log de cobranças de um pedido |
| POST | `/` | Registra tentativa de cobrança |
| DELETE | `/:id` | Remove registro |

### CONCILIAÇÃO `/api/conciliacao`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Lista linhas do extrato bancário |
| GET | `/lancamentos-pendentes` | Lançamentos não conciliados |
| POST | `/` | Adiciona linha do extrato |
| POST | `/importar` | Importação em massa |
| PATCH | `/:id/conciliar` | Vincula extrato a lançamento |
| PATCH | `/:id/desconciliar` | Remove vínculo |
| DELETE | `/:id` | Remove linha |
| GET | `/resumo` | Resumo de conciliação |

### ESTOQUE `/api/estoque`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/produtos` | Lista produtos (busca, categoria, alertas de estoque) |
| GET | `/produtos/:id` | Detalhes do produto |
| POST | `/produtos` | Cadastra produto |
| PUT | `/produtos/:id` | Atualiza produto |
| DELETE | `/produtos/:id` | Desativa produto |
| GET | `/movimentos` | Lista movimentos (filtros: produto, tipo, data) |
| POST | `/movimentos` | Registra entrada/saída/ajuste |
| GET | `/alertas` | Produtos abaixo do estoque mínimo |
| GET | `/categorias` | Categorias de produtos |
| GET | `/resumo` | Totais (quantidade, alertas, valor total) |

### ORÇAMENTOS `/api/orcamentos`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Lista orçamentos |
| GET | `/:id` | Detalhes com itens |
| POST | `/` | Cria orçamento |
| PUT | `/:id` | Atualiza orçamento e itens |
| PATCH | `/:id/status` | Atualiza status |
| POST | `/:id/converter` | Converte em pedido |
| DELETE | `/:id` | Remove orçamento |

### KANBAN `/api/kanban`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Pedidos agrupados por etapa de produção |
| PATCH | `/:id/etapa` | Move pedido de etapa |
| GET | `/resumo` | Contagem por etapa |

### ORDENS DE SERVIÇO `/api/ordens-servico`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Lista OS (filtros: status, tipo, técnico, busca) |
| GET | `/:id` | Detalhes |
| POST | `/` | Cria OS |
| PUT | `/:id` | Atualiza OS |
| PATCH | `/:id/status` | Atualiza status (registra conclusão) |
| DELETE | `/:id` | Remove OS |
| GET | `/resumo/stats` | Estatísticas gerais |

### FORNECEDORES `/api/fornecedores`
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Lista fornecedores ativos |
| GET | `/categorias` | Categorias de fornecedores |
| GET | `/:id` | Detalhes |
| POST | `/` | Cadastra fornecedor |
| PUT | `/:id` | Atualiza fornecedor |
| DELETE | `/:id` | Desativa fornecedor |

### NOTIFICAÇÕES `/api/notificacoes` *(NOVO)*
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Retorna alertas: pedidos atrasados, cobranças vencidas, estoque baixo |

### PORTAL (PÚBLICO) `/portal` *(NOVO)*
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/pedido/:token` | Dados do pedido para o cliente (sem autenticação) |

---

## 6. FRONTEND — PÁGINAS

### `index.html` — Login
- Formulário de e-mail e senha
- JWT armazenado em `localStorage`
- Redirecionamento para `dashboard.html` após login

### `dashboard.html` — Painel Principal
- KPIs do mês: vendas realizadas, receita prevista, novos clientes, pedidos atrasados, leads abertos, % da meta
- Gráfico de barras: vendas dos últimos 6 meses
- Radar de prazos: pedidos com entrega nos próximos dias
- Ranking dos top 5 vendedores
- Feed de atividades recentes

### `clientes.html` — Gestão de Clientes
- Listagem com busca por nome, e-mail, telefone, CPF/CNPJ
- CRUD completo de clientes
- Badge "Inadimplente" para clientes com cobranças em atraso
- Filtro rápido para exibir só inadimplentes
- **Importação de CSV**: modal com preview, mapeamento automático de colunas, importação em lote

### `comercial.html` — Orçamentos e Pedidos
- Abas: Orçamentos / Pedidos
- Criação de orçamentos com múltiplos itens (ambiente, descrição, material, qtd, valor)
- Conversão de orçamento aprovado em pedido
- Atualização de status com notificação WhatsApp automática para o cliente *(NOVO)*
- Botão de link do Portal do Cliente por pedido *(NOVO)*
- Cópia do link do portal para área de transferência

### `orcamentos.html` — Módulo de Orçamentos
- Listagem e gestão de orçamentos
- Edição de itens por ambiente
- **PDF de Proposta**: exportação com logo, cor da empresa, tabela de itens, totais *(NOVO)*
- **Histórico de Negociações**: timeline de eventos do orçamento *(NOVO)*

### `leads.html` — CRM / Pipeline de Leads
- Pipeline Kanban visual por etapa (novo, contato, visita, proposta, negociação, fechado, perdido)
- Registro de interações (ligação, e-mail, visita, WhatsApp)
- Conversão de lead em cliente

### `radar.html` — Radar de Prazos
- Painel com pedidos agrupados por situação: atrasado, urgente (até 7 dias), em dia
- Ordens de serviço agendadas
- Calendário mensal de entregas e instalações

### `assistencia.html` — Assistência Técnica
- Abertura e gestão de chamados
- Atribuição de técnico e agendamento
- Controle de urgência (crítico, alto, médio, baixo)
- Histórico de atendimento e resolução

### `estoque.html` — Controle de Estoque
- Cadastro de produtos com código, categoria, unidade
- Entrada, saída e ajuste de estoque
- Alertas visuais de estoque mínimo
- Resumo com valor total do estoque

### `financeiro.html` — Financeiro
- Lançamentos de receita e despesa
- Filtros: tipo, status, data, conta, inadimplência
- Baixa de pagamento com seleção de conta e forma de pagamento
- **Recibo de Pagamento em PDF**: gerado automaticamente após baixa *(NOVO)*
- DRE mensal
- Fluxo de caixa com projeção

### `conciliacao.html` — Conciliação Bancária
- Importação de extrato bancário
- Vinculação linha-a-linha entre extrato e lançamentos
- Resumo de itens conciliados vs. pendentes

### `kanban.html` — Kanban de Produção
- Board visual das etapas: Medição → Projeto → Aprovação → Produção → Entrega → Instalação
- Arraste cards entre etapas
- Contagem por etapa

### `ordens-servico.html` — Ordens de Serviço
- Criação e gestão de OS (instalação, manutenção, visita, entrega)
- Atribuição de técnico
- Controle de status e agendamento

### `parceiros.html` — Parceiros / Indicadores
- Cadastro de parceiros com dados bancários e PIX
- Acompanhamento de indicações e conversões
- Total de comissões geradas

### `comissoes.html` — Comissões
- Listagem de comissões de vendedores e parceiros
- Registro de pagamento (gera lançamento de despesa automaticamente)

### `metas.html` — Metas de Vendas
- Definição de meta mensal por vendedor
- Ranking com % atingido da meta
- Gráfico comparativo

### `renders.html` — Renders e Projetos
- Upload de imagens e PDFs de renders
- Vinculação por cliente/pedido
- Link público para aprovação pelo cliente
- Controle de aprovação

### `fornecedores.html` — Fornecedores
- Cadastro completo com dados bancários
- Filtro por categoria
- Prazo de pagamento por fornecedor

### `usuarios.html` — Gestão de Usuários
- Cadastro com foto, e-mail, perfil
- Troca de senha
- Gestão de permissões por perfil e por usuário individual

### `configuracoes.html` — Configurações da Empresa
- Nome, CNPJ, endereço, telefones, e-mail, site
- Upload de logo
- Cor primária da empresa (usada em PDFs e interface)

### `contas.html` — Contas Bancárias
- Cadastro de contas (corrente, poupança, caixa físico)
- Saldo calculado em tempo real

### `categorias.html` — Categorias
- Categorias de receita e despesa para classificação de lançamentos
- Categorias de produtos para o estoque

### `notas-fiscais.html` — Notas Fiscais
- Registro e controle de notas emitidas e recebidas

### `agenda.html` — Agenda
- Calendário de compromissos, entregas e instalações

### `ranking.html` — Ranking de Vendedores
- Ranking mensal/anual com volume de vendas
- Comparativo de metas

### `relatorios.html` — Relatórios
- Relatórios gerenciais e exportações

### `crm.html` — CRM
- Visão de relacionamento com clientes
- Histórico de interações

### `portal-cliente.html` — Portal do Cliente *(NOVO)*
- Página **pública** (sem login)
- Acessada via link único: `http://localhost:3000/portal-cliente.html?token=XXXXXX`
- Exibe: logo e nome da empresa, número do pedido, timeline visual de produção
- Etapas: Medição → Produção → Instalação → Entregue → Concluído
- Informações: previsão de entrega, data real, valor, condição de pagamento
- **Controle de garantia**: exibe se está dentro ou fora da garantia com data de vencimento
- Tabela de itens do pedido
- Botão de WhatsApp direto para a empresa

---

## 7. FUNCIONALIDADES IMPLEMENTADAS

### Interface
| Funcionalidade | Descrição |
|---------------|-----------|
| **Tema claro/escuro** | Toggle no topbar, persistido em `localStorage`, sem flash na recarga |
| **Layout responsivo (mobile)** | Sidebar colapsa para 48px com ícones; todas as páginas compactas em telas menores |
| **Notificações in-app** | Sino no topbar com badge de contagem; dropdown com pedidos atrasados, cobranças vencidas, estoque baixo |
| **Sidebar expansível** | Em mobile: toggle por botão hamburguer; em desktop: colapsa com ícones |

### Comercial / Vendas
| Funcionalidade | Descrição |
|---------------|-----------|
| **WhatsApp automático** | Ao mudar status do pedido, sistema gera link WhatsApp com mensagem pré-formatada para notificar o cliente |
| **Portal do Cliente** | Link único por pedido para o cliente acompanhar o status de produção sem login |
| **Histórico de negociações** | Timeline de eventos de cada orçamento (criação, status, conversão) |
| **PDF de Proposta** | Exportação de orçamento em PDF com logo e cor da empresa |

### Financeiro
| Funcionalidade | Descrição |
|---------------|-----------|
| **Recibo de pagamento PDF** | Gerado automaticamente ao registrar pagamento de lançamento |
| **Previsão de inadimplência** | Badge "Inadimplente" nos clientes com cobranças vencidas; filtro rápido na listagem |

### Operacional
| Funcionalidade | Descrição |
|---------------|-----------|
| **Importação de clientes via CSV** | Upload de arquivo CSV com preview e mapeamento automático de colunas |
| **Controle de garantia** | Campo `prazo_garantia_meses` no pedido; portal do cliente exibe status da garantia |

### Sistema
| Funcionalidade | Descrição |
|---------------|-----------|
| **Permissões granulares** | Por perfil (gestor/vendedor/tecnico/financeiro) + overrides individuais por usuário |
| **Log de auditoria** | Todas as ações são registradas na tabela `atividades` |
| **Backup do banco** | Download direto do arquivo SQLite via painel de admin |
| **Upload de logo** | Logo da empresa salvo no servidor e exibido em PDFs e portal |
| **Soft delete** | Usuários e clientes são apenas desativados, nunca apagados |

---

## 8. PERFIS E PERMISSÕES

| Módulo | Gestor | Vendedor | Técnico | Financeiro |
|--------|--------|----------|---------|------------|
| Dashboard | Total | Leitura | Leitura | Leitura |
| Clientes | Total | Edição | Leitura | Leitura |
| Comercial | Total | Edição | Leitura | Leitura |
| CRM / Leads | Total | Edição | Sem acesso | Leitura |
| Financeiro | Total | Sem acesso | Sem acesso | Total |
| Notas Fiscais | Total | Sem acesso | Sem acesso | Total |
| Contas | Total | Sem acesso | Sem acesso | Total |
| Categorias | Total | Sem acesso | Sem acesso | Total |
| Estoque | Total | Leitura | Leitura | Total |
| Assistência | Total | Leitura | Total | Sem acesso |
| Renders | Total | Edição | Leitura | Sem acesso |
| Parceiros | Total | Leitura | Sem acesso | Leitura |
| Comissões | Total | Leitura | Sem acesso | Total |
| Metas / Ranking | Total | Leitura | Sem acesso | Leitura |
| Usuários | Total | Sem acesso | Sem acesso | Sem acesso |
| Configurações | Total | Sem acesso | Sem acesso | Sem acesso |

> Permissões podem ser sobrescritas individualmente por usuário pelo gestor.

---

## 9. COMO INICIAR O SISTEMA

```bash
# 1. Instalar dependências do backend (apenas na primeira vez)
cd backend
npm install

# 2. Iniciar o servidor
node server.js

# O servidor sobe em http://localhost:3000
# O frontend é servido automaticamente na mesma porta
```

**Primeiro acesso:**
- Abra `http://localhost:3000`
- Login: `admin@sistema.com` / `123456`

**Configuração inicial recomendada:**
1. Ir em **Configurações** e preencher dados da empresa + logo
2. Ir em **Usuários** e criar os usuários da equipe
3. Ir em **Contas** e cadastrar as contas bancárias
4. Ir em **Categorias** e ajustar as categorias de receita/despesa

---

*Documento gerado em 14/06/2026*
