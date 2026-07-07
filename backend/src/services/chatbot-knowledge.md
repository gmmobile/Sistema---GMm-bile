# GM MÓBILE — Base de Conhecimento do Assistente
# INSTRUÇÕES PARA DESENVOLVEDOR:
# Sempre que adicionar uma funcionalidade nova ao sistema, adicione aqui:
# 1. O nome do módulo/feature
# 2. Como acessar na interface (sidebar, botão, menu)
# 3. Passo a passo das ações principais
# O bot lerá este arquivo automaticamente sem precisar reiniciar o servidor.

---

## MÓDULOS ATIVOS

### Dashboard
- Acesso: primeiro ícone da sidebar (casa)
- Exibe: KPIs do mês (faturamento, pedidos ativos, leads, orçamentos pendentes, alertas de estoque e assistência técnica), gráfico de evolução mensal e próximas entregas
- Filtro de período: seletor no topo direito

### CRM / Leads (v2 — redesenhado)
- Acesso: ícone de funil na sidebar
- Visualização: **Kanban com 13 etapas** — Novo Lead | Primeiro Contato | Qualificação | Visita Agendada | Em Projeto | Orçamento Enviado | Negociação | Contrato | Pedido Confirmado | Em Produção | Entrega | Pós-venda | Perdido
- **Criar lead:** botão **"+ Novo Lead"** (topo direito) → nome, WhatsApp, origem, cidade, valor estimado, projeto, responsável → Criar Lead
- **Mover lead:** arraste o card entre colunas OU clique no card → dropdown "Mover" no drawer → botão Mover
- **Abrir perfil completo:** clique no card → abre drawer lateral direito com 3 abas: **Dados | Timeline | + Interação**
  - Aba Dados: todos os campos do lead editáveis + botão Salvar
  - Aba Timeline: histórico cronológico de todas as interações (ligações, WhatsApp, visitas, notas)
  - Aba Interação: registrar nova interação escolhendo tipo (Ligação / WhatsApp / Email / Visita Agendada / Visita Feita / Nota)
- **Ações rápidas no drawer:** botões WhatsApp (abre wa.me), Ligar, Email, Visita, Nota
- **Temperatura automática:** calculada por dias sem contato — 🔥 Muito Quente (≤1 dia) | 🟢 Quente (≤3 dias) | 🟡 Morno (≤7 dias) | 🔵 Frio (>7 dias)
- **Converter em cliente:** dentro do drawer → aba Dados → botão "Converter em Cliente"
- **Marcar perdido:** dentro do drawer → aba Dados → botão "Marcar como Perdido"
- **Filtros:** busca por nome/telefone/cidade + filtro por vendedor + filtro por origem + filtro por temperatura
- **Card exibe:** nome, temperatura, telefone, origem, cidade, valor estimado, avatar do responsável, dias desde último contato

### Clientes
- Acesso: ícone de pessoas na sidebar
- Lista com busca por nome, CPF, telefone, cidade
- **Novo cliente:** botão **"+ Novo Cliente"** → nome, CPF/CNPJ, telefone, email, endereço, cidade, origem → Salvar
- **Ver histórico:** clique no cliente → abas: **Dados | Orçamentos | Pedidos | Assistências | Renders**
- **Carnê de parcelas:** ícone de carnê (dourado) na coluna Ações → abre o carnê completo do cliente com resumo (total do contrato, pago, em aberto, vencido) e parcelas agrupadas em **Vencidas / Próximas / Quitadas**; cada parcela pendente tem botão **"Receber"** que pede data, forma de pagamento e **conta de destino (obrigatória)** — o valor entra automaticamente na Central de Tesouraria, fluxo de caixa e dashboard
- **Editar:** botão de lápis no card ou dentro do cadastro
- **Inativar:** botão de três pontos → "Inativar cliente"
- **Importante:** ao marcar qualquer parcela/lançamento como pago (aqui ou no Financeiro), a **conta é obrigatória** — é ela que faz o valor aparecer em Contas Correntes

### Comercial / Orçamentos
- Acesso: ícone de documento na sidebar
- Lista com filtro por status: rascunho | enviado | aprovado | recusado | expirado
- **Novo orçamento:** botão **"+ Novo Orçamento"** → selecione cliente → adicione itens (produto, qtd, valor unitário) → defina frete, montagem, desconto, entrada, nº de parcelas → Salvar
- **Enviar ao cliente:** abra o orçamento → botão **"Enviar"** → status muda para "enviado"
- **Aprovar:** botão **"Aprovar"** → pergunta se deseja gerar pedido automaticamente
- **Recusar:** botão **"Recusar"** → registra motivo
- **Gerar pedido:** botão **"Gerar Pedido"** (visível quando status = aprovado)
- **Duplicar orçamento:** botão de três pontos → "Duplicar"
- **Imprimir/PDF:** botão de impressora no orçamento aberto

### Central de Produção (Kanban v2)
- Acesso: ícone de produção na sidebar
- **12 etapas do ciclo completo:** Novo Pedido → Aguardando Medição → Projeto 3D → Aguardando Aprovação → Compra de Materiais → Produção → Montagem → Qualidade → Entrega Agendada → Entregue → Assistência Técnica → Concluído
- **Cards mostram:** número do pedido, cliente, valor, projetista, prioridade (🔴🟠🟡🟢), barra de progresso %, dias restantes/atrasado, avatars da equipe, badge de checklist
- **Mover etapa:** arraste o card entre colunas OU clique no card → dropdown "Mover" no drawer → botão Mover
- **Drawer lateral (clicar no card):** 4 abas — Geral | Checklist | Timeline | Financeiro
  - Aba Geral: dados do cliente, equipe (projetista, responsável produção, vendedor), prazo, observações, itens do pedido, botão Salvar
  - Aba Checklist: itens automáticos ao entrar em Produção/Montagem/Qualidade (cortar MDF, furar, colar fita, etc.) com checkbox interativo e barra de progresso
  - Aba Timeline: histórico automático de todas as movimentações + campo para registrar observação manual
  - Aba Financeiro: valor total, desconto, valor final, origem/canal, link para lançamentos
- **Prioridade:** 4 botões no drawer — Urgente / Alta / Média / Baixa (altera cor do ponto no card)
- **Stats no topo:** Em andamento | Em produção | Em montagem | Entregues | Atrasados | Entrega hoje
- **Alertas automáticos:** banner vermelho se há pedidos atrasados, banner amarelo se tem entrega hoje
- **Filtros:** busca por cliente/número/vendedor + filtro por prioridade + filtro por responsável de produção
- **Botão "Concluídos":** alterna exibição da coluna "Concluído" (oculta por padrão)
- **Integração automática:** quando orçamento vira pedido, entra automaticamente em "Novo Pedido"; cada movimentação registra na timeline automaticamente; checklist é criado automaticamente nas etapas de Produção/Montagem/Qualidade

### Financeiro
- Acesso: ícone de cifrão na sidebar
- Abas: **Lançamentos | Contas | DRE | Conciliação**
- **Novo lançamento:** botão **"+ Novo Lançamento"** → tipo (receita/despesa) → categoria → valor → data vencimento → conta → Salvar
- **Marcar como pago:** na lista, clique no lançamento → botão **"Marcar como Pago"** → data pagamento + conta
- **Lançamento recorrente:** ao criar, marque "Recorrente" → defina frequência e nº de repetições
- **DRE:** aba "DRE" → selecione período → receitas vs despesas por categoria
- **Contas correntes:** aba "Contas" → "+ Nova Conta" → nome, banco, saldo inicial
- **Conciliação:** aba "Conciliação" → importe extrato OFX/CSV → sistema sugere match automático por valor/data → confirme ou ignore cada item

### Comissões
- Acesso: ícone de porcentagem na sidebar (ou menu Financeiro → Comissões)
- Lista com filtro por tipo (vendedor/parceiro), status (pendente/pago), período
- **Pagar comissão:** clique na comissão → botão **"Marcar como Pago"** → confirme
- **Ver por vendedor:** filtro "Vendedor" → selecione o nome
- Comissões são geradas automaticamente quando um pedido é criado

### Metas
- Acesso: sidebar → Ranking → aba **"Metas"**
- Exibe cards por vendedor com barra de progresso: verde (≥100%), amarelo (≥70%), vermelho (<70%)
- **Nova meta:** botão **"+ Nova Meta"** → selecione vendedor → mês/ano → valor em R$ → Salvar
- **Editar meta:** ícone de lápis no card da meta
- **Excluir meta:** ícone de lixeira no card
- Filtro de período: seletor de mês/ano no topo

### Ranking & Performance (Centro de Performance Comercial — v3 premium)
- Acesso: ícone de troféu na sidebar
- Abas: **Dashboard | Ranking | Metas | Conquistas | IA Performance | Relatórios** (a aba Relatórios leva ao módulo Relatórios)
- **Dashboard (visão única do gestor):**
  - **6 KPI cards premium:** Faturamento, Pedidos, Meta Atingida, Conversão, Ticket Médio e Comissão Prevista — cada um com ícone colorido, comparação vs mês anterior, mini-gráfico sparkline dos últimos 6 meses, barra de progresso e meta
  - **Resumo Executivo:** painel com mini-cards (pedidos vendidos, ticket médio, conversão, comissão prevista, melhor vendedor, melhor projetista)
  - **Insights IA:** painel com análises automáticas resumidas (crescimento, previsão do mês, alertas de conversão etc.) — botão "Ver análise" abre a aba IA Performance completa
  - **Faturamento por Vendedor:** barras horizontais douradas com avatar, nome e valor
  - **Tendência de Faturamento:** gráfico de linha dos últimos 6 meses + nota de crescimento/queda dos últimos 3 meses
  - **Funil Comercial:** Novos Leads → Em Contato → Orçamentos → Negociação → Pedidos, com quantidades e percentuais
  - **Painel lateral direito:** Próximas Ações (entregas e follow-ups por data), Top Performers (melhor vendedor, projetista, maior conversão, maior ticket), Alertas (leads sem contato 7+ dias, orçamentos aguardando, negociações paradas, pedidos atrasados, entregas hoje) e Conquistas do Mês
  - **Tabela Top Vendedores:** posição com medalhas, avatar, cargo, meta, realizado, % com barra de progresso, pedidos, conversão, ticket médio, comissão e status (🟢 Meta batida / 🟡 Atenção / 🔴 Abaixo da meta / dourado "Meta em ~Nd" quando a projeção indica que vai bater)
- **Ranking:** leaderboard de vendedores e projetistas com score, badges e podium (1º, 2º, 3º)
- **Conquistas:** badges automáticos do período (Campeão, Meta Batida, Maior Ticket, etc.)
- **IA Performance:** análise automática com insights e alertas gerados por IA
- **Filtro de período:** seletor mês/ano no topo — atualiza automaticamente ao mudar o mês ou ano (sem botão)
- **Modo Intervalo:** botão "Intervalo" ao lado do seletor — ativa seletores De/Até para selecionar múltiplos meses (ex: Jan/2026 – Jun/2026); todos os dados agregados para o período inteiro
- **Exportar PDF:** botão "Exportar PDF" no topo direito → abre diálogo de impressão com cabeçalho profissional "GM MÓBILE — Relatório de Performance" e data do período
- Ver perfil individual: clique no vendedor (tabela ou ranking) → abre drawer lateral com histórico e gráficos
- **Metas no modo intervalo:** exibe totais somados por vendedor no período (edição de metas disponível apenas em modo mês único)

### Estoque
- Acesso: ícone de grade na sidebar
- Lista com estoque atual vs mínimo, valor em estoque, situação (ok/crítico)
- **Novo produto:** botão **"+ Novo Produto"** → nome, código, categoria, unidade, estoque mínimo, custo unitário → Salvar
- **Registrar entrada:** clique no produto → botão **"Entrada"** → quantidade → Salvar
- **Registrar saída:** clique no produto → botão **"Saída"** → quantidade + motivo → Salvar
- **Filtro críticos:** toggle **"Apenas Críticos"** → mostra só produtos abaixo do mínimo

### Fornecedores (Central de Relacionamento — v2 enterprise)
- Acesso: ícone de caminhão na sidebar
- Cadastro completo de fornecedores (razão social, nome fantasia, CNPJ, IE, contato, responsável, categoria, tipo — materiais/serviços/ferragens/etc., dados bancários, endereço, favorito, homologado, logo) com CRM completo integrado ao restante do ERP
- **10 KPIs automáticos no topo:** Total de Fornecedores, Ativos, Inativos, Compras no Mês (com variação e mini-gráfico), Valor em Aberto, Valor Pago, Economia no Mês (calculada automaticamente quando o preço de um item cai em relação à compra anterior), Avaliação Média (com mini-gráfico), Prazo Médio de Entrega e Pedidos Atrasados
- **Busca e filtros:** por nome, CNPJ, cidade, estado, responsável, telefone, e-mail ou produto fornecido + filtros por categoria, status, homologado e toggles de Favoritos/Pendentes/Homologados
- **Tabela principal:** logo, nome+CNPJ, categoria, contato, compras/mês, valor em aberto, última compra, prazo médio, avaliação em estrelas, status e ações (favoritar, inativar/reativar, excluir) — os mesmos botões também aparecem no cabeçalho do drawer
- **Foto/logo do fornecedor:** ícone de câmera no avatar do drawer permite enviar uma foto, salva no Cloudinary
- **Inativar / Reativar:** botão de energia — alterna o status sem apagar nada; o fornecedor sai da lista de "Ativos" e vai para "Inativos" (compras, documentos e histórico continuam intactos, reversível a qualquer momento)
- **Excluir:** botão de lixeira — exclusão definitiva e permanente, só permitida quando o fornecedor **não tem nenhuma compra, lançamento ou documento vinculado**; se tiver, o sistema bloqueia e sugere inativar em vez de excluir
- **Painel lateral:** Top 5 Fornecedores por volume de compra, gráfico de Compras por Categoria (rosca), Alertas (preços que subiram, atrasos recorrentes) e Insights de IA (sugestão de fornecedor alternativo mais barato para o mesmo produto, aumento de preço acima de 5%, etc.)
- **Drawer do fornecedor (clicar na linha), com 7 abas:**
  - **Dados:** cadastro completo, editável
  - **Produtos:** catálogo de produtos/materiais fornecidos, com preço atual, preço anterior, prazo de entrega e produto principal
  - **Compras:** histórico de pedidos de compra; **"+ Compra"** abre modal com itens dinâmicos (produto, quantidade, preço unitário — total calculado em tempo real), data do pedido/entrega, forma de pagamento e número de parcelas
    - Ao registrar uma compra, o sistema **gera automaticamente os lançamentos (parcelas) em Contas a Pagar**, atualiza o preço atual/anterior do produto (para cálculo de economia) e registra no histórico do fornecedor
    - **Editar compra:** botão de lápis no item da compra → reabre o modal preenchido, permite alterar itens/valores/parcelas — só é possível enquanto nenhuma parcela da compra já tiver sido paga
    - **Excluir compra:** botão de lixeira → remove a compra e os lançamentos pendentes vinculados — mesma trava: não é possível excluir se já houve pagamento
    - **Marcar entregue / Cancelar:** botões rápidos em compras em aberto
  - **Financeiro:** todos os lançamentos (parcelas) desse fornecedor, com status pendente/pago/atrasado — é o mesmo Contas a Pagar do módulo Financeiro, filtrado por fornecedor
  - **Documentos:** upload de contrato, cartão CNPJ, certidão, tabela de preços, nota fiscal ou anexo geral, com data de vigência (para contratos) e alerta de vencimento
  - **Avaliação:** avalia o fornecedor em 6 critérios (preço, qualidade, prazo, atendimento, pontualidade, confiabilidade) de 1 a 5 estrelas + comentário — a média entra automaticamente na KPI "Avaliação Média"
  - **Histórico:** linha do tempo automática com tudo que aconteceu (criação, compras, avaliações, documentos, alterações)
- **Relatórios (botão "Relatórios" na barra superior):** 8 tipos — Compras por Fornecedor, Compras por Categoria, Ranking de Fornecedores, Histórico de Preços, Avaliações, Pagamentos, Entregas e Economia Gerada; escolha o período e exporte em **PDF** ou **Excel (CSV)**
- Toda compra registrada aqui já integra automaticamente com Financeiro, Contas a Pagar, Contas Correntes e Fluxo de Caixa — não é preciso lançar nada manualmente em outro módulo

### Parceiros (Plataforma de Gestão de Relacionamento Comercial — v2)
- Acesso: ícone de aperto de mão na sidebar
- Controla toda a relação comercial com parceiros externos — arquitetos, designers, corretores, construtoras, empresas de reforma, lojas parceiras, influenciadores, afiliados, empresas indicadoras e profissionais autônomos — rastreando cada indicação até a venda e a comissão
- **10 KPIs automáticos:** Total de Parceiros, Ativos, Inativos, Indicações no Mês (com mini-gráfico), Vendas Geradas, Valor Vendido (com mini-gráfico), Comissões Pendentes, Comissões Pagas (com mini-gráfico), Conversão (indicação → venda) e Ticket Médio
- **Busca e filtros:** por nome, empresa, CPF/CNPJ, cidade, telefone, e-mail, categoria ou responsável + filtros por categoria, status e toggles de VIP/Premium/Homologado/Comissão Pendente
- **Tabela principal:** parceiro, categoria, contato, indicações, vendas, conversão, valor gerado, comissões, última venda, status e ações (VIP, inativar/reativar, excluir)
- **Painel lateral:** Top Parceiros por vendas, gráfico de Vendas por Categoria (rosca), Alertas (comissões pendentes há +90 dias, contratos/documentos vencendo, sem vendas ou sem indicar há 90 dias, conversão baixa) e Insights de IA
- **Ranking (botão "Ranking" na barra superior):** Top 10 parceiros por critério escolhido — mais vendas, mais indicações, maior faturamento, maior conversão, maior ticket médio ou maior comissão
- **Drawer do parceiro (clicar na linha), com 7 abas:**
  - **Dados:** cadastro completo (empresa, CPF/CNPJ, tipo, % de comissão, contato, Instagram, website, endereço, dados bancários), editável
  - **Indicações:** lista todos os clientes/leads indicados por esse parceiro (vem direto do CRM), com etapa do funil e taxa de conversão
  - **Comissões:** histórico de comissões geradas para esse parceiro — pedido, cliente, valor, percentual, status (pendente/pago) e data
  - **Vendas:** todos os pedidos fechados originados por esse parceiro, com valor e status
  - **Documentos:** upload de contrato, tabela de comissão, certificado, foto, portfólio ou anexo geral, com vigência e alerta de vencimento
  - **Avaliação:** avalia o parceiro em 6 critérios (qualidade das indicações, relacionamento, comprometimento, comunicação, volume de vendas, pontualidade) de 1 a 5 estrelas + comentário
  - **Histórico:** linha do tempo automática (criação, venda gerada, comissão paga, avaliação, documento, alterações)
- **Foto do parceiro:** ícone de câmera no avatar do drawer permite enviar uma foto
- **Rastreio automático indicação → venda → comissão:** ao criar um orçamento vinculado a um parceiro (herdado automaticamente do lead indicado, ou selecionado manualmente) e esse orçamento virar pedido, o sistema **gera automaticamente a comissão do parceiro** (% cadastrado × valor da venda) e atualiza Vendas, Comissões, Histórico e o Dashboard do parceiro — sem nenhum lançamento manual
- **Pagamento de comissão:** feito na tela de Comissões (mesmo fluxo usado para vendedores) — ao marcar como paga, atualiza automaticamente Financeiro, Contas Correntes e o Histórico do parceiro
- **Relatórios (botão "Relatórios" na barra superior):** 8 tipos — Ranking, Comissões, Vendas, Conversão, Parceiros Ativos, Parceiros Inativos, Indicações e Faturamento; escolha o período e exporte em **PDF** ou **Excel (CSV)**

### Assistência Técnica
- Acesso: ícone de chave/ferramenta na sidebar
- Lista com filtro por status: aberto | em andamento | concluído
- **Novo chamado:** botão **"+ Nova Assistência"** → selecione cliente → pedido relacionado (opcional) → tipo de problema → descrição → prioridade (baixa/média/alta/urgente) → Salvar
- **Atualizar status:** abra o chamado → botão **"Em Andamento"** ou **"Concluído"**
- **Registrar resolução:** campo "Solução aplicada" ao concluir

### Agenda
- Acesso: ícone de calendário na sidebar
- Calendário mensal com eventos automáticos: **Entregas de pedidos** (azul), **Assistências técnicas** (vermelho) e **Visitas de leads** (verde)
- Navegação: setas ‹ › para trocar de mês, ícone de calendário para voltar a hoje
- **Ver eventos do dia:** clique no dia → lista no painel lateral direito
- **Expandir evento (clicar no evento no painel):** abre os detalhes inline —
  - Pedido: cliente, valor, etapa de produção, prioridade, entrega prevista (com chip Atrasado/Hoje/Em X dias), vendedor, projetista, endereço, itens, barra de progresso + botões **WhatsApp** do cliente e **Abrir no Kanban**
  - Assistência: atalho para o módulo Assistência Técnica
  - Lead: atalho para o CRM
- Clicar em outro evento fecha o anterior (acordeão)

### Radar de Prazos
- Acesso: ícone de radar/alvo na sidebar
- Exibe pedidos com prazo vencido (vermelho) ou próximo de vencer (amarelo)
- **Filtro de janela:** campo "Dias" → define quantos dias à frente exibir (padrão: 7)
- Clique no pedido para abrir diretamente e avançar etapa

### Notas Fiscais
- Acesso: ícone de nota fiscal na sidebar
- **Emitir NF:** botão **"+ Nova Nota"** → vincule ao pedido e cliente → dados fiscais (CFOP, natureza, etc.) → **"Transmitir"**
- **Cancelar NF:** abra a NF → botão **"Cancelar"** (disponível em até 24h após emissão)
- **Download XML/PDF:** botões de download na NF autorizada
- Status: rascunho → transmitindo → autorizada / rejeitada / cancelada

### Renders / Projetos 3D
- Acesso: ícone de imagem na sidebar OU dentro de um pedido → aba "Renders"
- **Upload:** botão **"+ Upload Render"** → selecione arquivo (JPG, PNG, PDF) → vincule ao pedido → Salvar
- **Galeria:** visualização em grid com zoom ao clicar
- **Excluir render:** ícone de lixeira na imagem

### Relatórios
- Acesso: ícone de gráfico na sidebar
- Tipos disponíveis: **Faturamento | Comissões | Produção | Inadimplência | Desempenho da Equipe**
- **Gerar relatório:** selecione o tipo → defina período (data início e fim ou mês/ano) → botão **"Gerar"**
- **Exportar:** botão **"Exportar PDF"** ou **"Exportar Excel"**

### Contas Correntes (Central de Tesouraria — v2)
- Acesso: sidebar Financeiro → **Contas Correntes**
- É a central de tesouraria da empresa: **todos os saldos, projeções e alertas são calculados automaticamente** a partir das movimentações do ERP (lançamentos pagos, contas a receber/pagar, transferências e reservas) — nada é digitado manualmente
- **Cards superiores (8):** Saldo Consolidado, Saldo Disponível, Saldo Previsto 30 dias, Entradas Hoje, Saídas Hoje, PIX Pendentes, Transferências Pendentes e Contas Conciliadas — com comparativos e mini-gráficos
- **Cards de conta:** cada conta mostra saldo atual, saldo previsto (30 dias), entradas/saídas de hoje, última movimentação, status (Conciliada / Pendências / Sem movimentação / Saldo negativo) e sino com alertas
- **Busca e filtros:** campo de busca (conta, banco, PIX, número) + filtro por status
- **Menu da conta (⋮):** Transferir daqui | Nova reserva | Ver extrato | Editar | Inativar
- **Drawer (clicar na conta):** saldo atual e previsto, saldo reservado vs disponível com barra, botões Nova Transferência e Extrato Completo, e abas:
  - **Extrato:** estilo banco — data/hora, descrição, cliente/fornecedor/pedido, categoria, valor e saldo após cada movimentação
  - **Resumo:** entradas/saídas hoje, previstos 7/15/30 dias, pendências de conciliação, gráfico de Projeção de Saldo (Hoje → 30 dias) e transferências da conta
  - **Reservas:** reservas financeiras (ex: "Reserva MDF — Pedido 152") que bloqueiam saldo disponível sem sair do saldo real; criar com botão "+ Reserva", liberar com o cadeado
  - **Informações:** banco, agência, conta, PIX, saldo inicial, saldo mínimo (gera alerta), observações
- **Nova Transferência:** botão no topo (ou no card/drawer) → origem, destino, valor, data e descrição. Data de hoje executa na hora (atualiza as duas contas + Financeiro + fluxo de caixa); **data futura agenda** e o sistema executa automaticamente na data
- **Nova Conta:** botão no topo → nome, tipo, banco, PIX, saldo inicial, **saldo mínimo** (alerta automático), agência, número, cor e observações
- **Painéis inferiores:** Distribuição de Saldos (rosca por conta), Insights Financeiros (IA — projeção de saldo negativo, previstos da semana, PIX não conciliados, concentração de receitas, fluxo vs mês anterior, sugestão de transferência) e Alertas (saldo abaixo do mínimo, contas negativas, conciliações pendentes, PIX não identificados, transferências pendentes, contas sem movimentação)
- Fase 1 é 100% baseada nos dados internos do ERP; a estrutura já está preparada para integração futura com Open Finance / Banco Inter

### Conciliação Bancária
- Acesso: Financeiro → aba **"Conciliação"**
- **Importar extrato:** botão **"Importar Extrato"** → selecione arquivo OFX ou CSV → sistema processa
- **Match automático:** sistema sugere correspondência entre extrato e lançamentos por valor/data
- **Confirmar:** botão "Confirmar" em cada item sugerido
- **Match manual:** selecione um item do extrato + um lançamento → botão "Vincular"
- **Ignorar item:** botão "Ignorar" para transações sem correspondência

### Usuários e Permissões
- Acesso: ícone de engrenagem → "Usuários" (apenas Gestor)
- **Novo usuário:** botão **"+ Novo Usuário"** → nome, email, senha, perfil (gestor/vendedor/técnico/financeiro) → Salvar
- **Editar permissões:** clique no usuário → aba "Permissões" → toggle por módulo (sem acesso / leitura / edição / total)
- **Inativar usuário:** toggle "Ativo" no cadastro do usuário

---

## MÓDULOS PLANEJADOS (em desenvolvimento)

### Agenda / Calendário
- Agendamento de visitas, medições e instalações
- Integração com pedidos e leads
- Alertas e lembretes automáticos
- Previsão: próxima fase de desenvolvimento

### Portal do Cliente
- Acesso externo para o cliente ver status do pedido
- Aprovação de projeto online
- Download de renders e contratos
- Previsão: próxima fase

### Integração WhatsApp
- Envio automático de atualizações de status ao cliente via WhatsApp Business API
- Templates de mensagem configuráveis
- Previsão: em planejamento

### Contratos Digitais
- Geração de contrato de venda a partir do pedido
- Assinatura digital integrada
- Previsão: em planejamento

### App Mobile
- Versão mobile para vendedores (CRM, orçamentos) e técnicos (kanban, assistência)
- Previsão: fase futura

---

## FLUXO COMPLETO DE VENDA (do lead ao pedido)

1. **Lead entra** → cadastrado no CRM (origem: indicação, Instagram, site, etc.)
2. **Qualificação** → vendedor avança para "Contato" → registra interações
3. **Visita agendada** → etapa "Visita" → medição do ambiente
4. **Orçamento criado** → módulo Comercial → itens, valores, condições
5. **Orçamento enviado** → cliente recebe → status "enviado"
6. **Negociação** → ajustes de valores, prazo, formas de pagamento
7. **Aprovação** → cliente aprova → botão "Gerar Pedido"
8. **Pedido na produção** → kanban avança etapas: Medição → Projeto → Produção → Instalação → Concluído
9. **Comissão gerada** → automaticamente para vendedor e parceiro (se houver)
10. **NF emitida** → módulo Notas Fiscais → transmissão para SEFAZ
11. **Assistência (se necessário)** → módulo Assistência Técnica → chamado vinculado ao pedido
