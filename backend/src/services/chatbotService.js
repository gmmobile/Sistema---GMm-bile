const { GoogleGenerativeAI } = require('@google/generative-ai');
const db   = require('../utils/db');
const fs   = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const KNOWLEDGE_FILE = path.join(__dirname, 'chatbot-knowledge.md');
function loadKnowledge() {
  try { return fs.readFileSync(KNOWLEDGE_FILE, 'utf8'); }
  catch { return '(base de conhecimento não encontrada)'; }
}

function buildSystemPrompt() {
  const agora = new Date();
  const dataHora = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday:'long', day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const mes = agora.getMonth() + 1;
  const ano = agora.getFullYear();
  const nomeMes = agora.toLocaleString('pt-BR', { month:'long', timeZone:'America/Sao_Paulo' });

  return `Você é a Assistente Pessoal Inteligente do sistema GM MÓBILE, especialista em CRM e ERP para empresas de móveis planejados.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXTO DO SISTEMA — GM MÓBILE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
O GM MÓBILE é um ERP + CRM completo desenvolvido para gestão de uma empresa de móveis planejados. Você conhece profundamente cada módulo:

**MÓDULOS ATIVOS:**

1. **Dashboard** — KPIs em tempo real: faturamento do mês, pedidos ativos, leads, orçamentos pendentes, alertas de estoque e assistência técnica. Gráficos de evolução mensal.

2. **CRM / Leads** — Funil de vendas com etapas: novo → contato → visita → proposta → negociação → fechado/perdido. Cada lead tem origem, produto de interesse, vendedor responsável e histórico de interações.

3. **Clientes** — Cadastro completo com histórico de compras, orçamentos, pedidos e assistências. Campos: nome, CPF/CNPJ, endereço, contatos, cidade, origem.

4. **Comercial / Orçamentos** — Criação de orçamentos com itens personalizados (móveis planejados), cálculo de frete, montagem, desconto, entrada e parcelamento. Status: rascunho → enviado → aprovado → recusado → expirado. Conversão em pedido com 1 clique.

5. **Pedidos / Kanban de Produção** — Gestão de pedidos com pipeline de produção em etapas: medição → projeto → aprovação do cliente → produção → pronto para entrega → instalação → concluído. Cada pedido tem prazo, vendedor, projetista e valor.

6. **Financeiro** — Lançamentos de receitas e despesas por categoria, centro de custo, contas correntes, conciliação bancária e DRE. Contas a pagar e receber com status: pendente → pago → cancelado.

7. **Comissões** — Cálculo automático de comissões por vendedor e parceiro. Status: pendente → pago. Gerado automaticamente ao fechar pedido.

8. **Metas** — Definição de metas mensais por vendedor. Acompanhamento de atingimento em tempo real com barra de progresso.

9. **Ranking & Performance** — Dashboard gamificado com leaderboard de vendedores e projetistas. Score calculado por: faturamento (40%), conversão (25%), volume de pedidos (20%), ticket médio (15%). Badges: Campeão, Meta Batida, Maior Ticket, Maior Conversão, Alta Performance.

10. **Estoque** — Controle de produtos com estoque mínimo, alertas de reposição e valorização de estoque (estoque × custo).

11. **Parceiros** — Cadastro de parceiros de indicação com percentual de comissão configurável.

12. **Assistência Técnica** — Chamados pós-venda categorizados por tipo de problema (instalação, qualidade, medição, etc.) com SLA e acompanhamento de status.

13. **Radar de Prazos** — Alertas automáticos de pedidos com entrega vencida ou próxima do vencimento. Configurável por janela de dias.

14. **Notas Fiscais** — Emissão e controle de NF-e (modelo 55) integrado ao pedido e cliente.

15. **Renders** — Upload e galeria de renders 3D dos projetos por pedido/cliente.

16. **Relatórios** — Relatórios consolidados de faturamento, comissões, inadimplência, produção e desempenho da equipe.

17. **Conciliação Bancária** — Importação de extrato OFX/CSV com match automático por valor/data contra lançamentos financeiros.

**MÓDULOS PLANEJADOS (em desenvolvimento ou próxima fase):**
- **Agenda / Calendário** — Agendamento de visitas, medições e instalações com alertas.
- **Portal do Cliente** — Acesso do cliente ao status do pedido e aprovação de projeto online.
- **Contratos Digitais** — Geração e assinatura digital de contratos de venda.
- **Integração WhatsApp** — Envio automático de atualizações de status ao cliente via WhatsApp Business API.
- **App Mobile** — Versão mobile para vendedores e técnicos em campo.
- **BI Avançado** — Painéis de business intelligence com drill-down por período, vendedor, produto e região.

**PERFIS DE USUÁRIO:**
- **Gestor** — Acesso total ao sistema
- **Vendedor** — CRM, pedidos, orçamentos, clientes, comissões próprias
- **Técnico** — Kanban de produção, assistência técnica, renders
- **Financeiro** — Módulo financeiro, notas fiscais, relatórios, comissões

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NAVEGAÇÃO, MÓDULOS E BASE DE CONHECIMENTO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Você CONHECE a interface visual completa do GM MÓBILE. JAMAIS diga que "não tem acesso à interface" — guie o usuário passo a passo com botões e menus exatos.

${loadKnowledge()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEU COMPORTAMENTO COMO ESPECIALISTA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**REGRA MAIS IMPORTANTE:** Você SEMPRE consegue guiar o usuário na interface. Jamais diga "não tenho acesso à interface" ou "não posso ver as telas". Você conhece cada botão, cada aba, cada fluxo.

**SEMPRE que uma pergunta envolver dados do sistema:**
1. Use OBRIGATORIAMENTE as ferramentas disponíveis para buscar dados reais do banco
2. Nunca invente ou estime valores — sempre consulte as ferramentas
3. Cruze dados entre módulos para dar análises completas
4. Após os dados, ofereça SEMPRE uma análise e 1-2 recomendações práticas

**Quando o usuário perguntar COMO FAZER algo no sistema:**
- Responda com o passo a passo exato: qual menu, qual botão, qual campo
- Use numeração para os passos
- Seja específico ("clique em + Novo Lead" não "vá para o módulo de leads")

**Como especialista em CRM/ERP para móveis planejados:**
- Benchmarks do setor: ticket médio R$ 8.000–R$ 25.000, ciclo de vendas 15–45 dias, conversão orçamento→pedido saudável acima de 35%
- Identifica gargalos no funil, alerta prazos em risco, sugere follow-ups
- Compara períodos, destaca performers, identifica quem precisa de atenção

**Formato das respostas:**
- Português do Brasil, profissional mas direto
- **Negrito** para valores, botões e ações importantes
- Numeração para passo a passos
- Valores em R$ X.XXX,XX
- Direto ao ponto, sem enrolar

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXTO TEMPORAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Agora: ${dataHora}
Mês atual: ${mes} (${nomeMes} de ${ano})
Mês anterior: ${mes === 1 ? 12 : mes - 1}/${mes === 1 ? ano - 1 : ano}

Quando o usuário disser "este mês" = ${mes}/${ano}. "Mês passado" = ${mes === 1 ? 12 : mes - 1}/${mes === 1 ? ano - 1 : ano}. "Este ano" = ${ano}.`;
}

const SYSTEM_PROMPT = buildSystemPrompt();

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'get_resumo_financeiro',
        description: 'Retorna faturamento, receitas, despesas e lucro de um período. Use para perguntas sobre faturamento, lucro, receita, despesas.',
        parameters: {
          type: 'OBJECT',
          properties: {
            mes:     { type: 'NUMBER', description: 'Mês (1-12). Se omitido, usa o mês atual.' },
            ano:     { type: 'NUMBER', description: 'Ano com 4 dígitos. Se omitido, usa o ano atual.' },
            periodo: { type: 'STRING', description: 'Escopo: mes, trimestre, semestre, ano, todos. Default: mes.' }
          }
        }
      },
      {
        name: 'get_pedidos',
        description: 'Retorna resumo de pedidos/vendas: quantidade, valores, status, etapas de produção.',
        parameters: {
          type: 'OBJECT',
          properties: {
            mes:    { type: 'NUMBER' },
            ano:    { type: 'NUMBER' },
            status: { type: 'STRING', description: 'ativo, concluido, cancelado ou todos.' }
          }
        }
      },
      {
        name: 'get_clientes',
        description: 'Retorna informações sobre clientes: total, novos no período, mais recentes.',
        parameters: {
          type: 'OBJECT',
          properties: {
            mes:    { type: 'NUMBER' },
            ano:    { type: 'NUMBER' },
            limite: { type: 'NUMBER', description: 'Quantos clientes listar. Default: 10.' }
          }
        }
      },
      {
        name: 'get_orcamentos',
        description: 'Retorna resumo de orçamentos: quantidade por status, valor total, taxa de conversão.',
        parameters: {
          type: 'OBJECT',
          properties: {
            mes:    { type: 'NUMBER' },
            ano:    { type: 'NUMBER' },
            status: { type: 'STRING', description: 'rascunho, enviado, aprovado, recusado, expirado ou todos.' }
          }
        }
      },
      {
        name: 'get_leads',
        description: 'Retorna resumo do funil de CRM/leads: quantidade por etapa, conversões.',
        parameters: {
          type: 'OBJECT',
          properties: {
            mes: { type: 'NUMBER' },
            ano: { type: 'NUMBER' }
          }
        }
      },
      {
        name: 'get_kanban_producao',
        description: 'Retorna status da produção: pedidos em cada etapa (medição, projeto, aprovação, produção, entrega, instalação).',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: 'get_estoque',
        description: 'Retorna situação do estoque: produtos, quantidades, alertas de estoque mínimo.',
        parameters: {
          type: 'OBJECT',
          properties: {
            apenas_criticos: { type: 'BOOLEAN', description: 'Se true, retorna só produtos abaixo do mínimo.' }
          }
        }
      },
      {
        name: 'get_assistencia_tecnica',
        description: 'Retorna chamados de assistência técnica: abertos, em andamento, concluídos.',
        parameters: {
          type: 'OBJECT',
          properties: {
            mes:    { type: 'NUMBER' },
            ano:    { type: 'NUMBER' },
            status: { type: 'STRING', description: 'aberto, em_andamento, concluido ou todos.' }
          }
        }
      },
      {
        name: 'get_comissoes',
        description: 'Retorna comissões de vendedores e parceiros no período.',
        parameters: {
          type: 'OBJECT',
          properties: {
            mes: { type: 'NUMBER' },
            ano: { type: 'NUMBER' }
          }
        }
      },
      {
        name: 'get_metas',
        description: 'Retorna metas e ranking de vendas da equipe.',
        parameters: {
          type: 'OBJECT',
          properties: {
            mes: { type: 'NUMBER' },
            ano: { type: 'NUMBER' }
          }
        }
      },
      {
        name: 'get_radar_prazos',
        description: 'Retorna pedidos com prazos próximos ou vencidos.',
        parameters: {
          type: 'OBJECT',
          properties: {
            dias: { type: 'NUMBER', description: 'Janela em dias para alerta. Default: 7.' }
          }
        }
      },
      {
        name: 'get_dashboard_geral',
        description: 'Retorna visão geral do sistema: KPIs principais. Use para perguntas gerais sobre "como está o sistema".',
        parameters: { type: 'OBJECT', properties: {} }
      }
    ]
  }
];

async function executarFerramenta(nome, args) {
  const agora = new Date();
  const mes    = args.mes || (agora.getMonth() + 1);
  const ano    = args.ano || agora.getFullYear();
  const mesStr = String(mes).padStart(2, '0');
  const mesAno = `${ano}-${mesStr}`;

  switch (nome) {
    case 'get_resumo_financeiro': {
      // data_pagamento e data_vencimento são TEXT (YYYY-MM-DD) → usar LIKE ou LEFT()
      let wPago, wPendente;
      switch (args.periodo) {
        case 'trimestre': {
          const meses = Array.from({length:3},(_,i)=>{ const m=mes-i; return m<=0?`${ano-1}-${String(m+12).padStart(2,'0')}`:`${ano}-${String(m).padStart(2,'0')}`; });
          wPago     = `LEFT(data_pagamento,7) IN ('${meses.join("','")}')`;
          wPendente = `LEFT(data_vencimento,7) IN ('${meses.join("','")}')`;
          break;
        }
        case 'semestre': {
          const meses = Array.from({length:6},(_,i)=>{ const m=mes-i; return m<=0?`${ano-1}-${String(m+12).padStart(2,'0')}`:`${ano}-${String(m).padStart(2,'0')}`; });
          wPago     = `LEFT(data_pagamento,7) IN ('${meses.join("','")}')`;
          wPendente = `LEFT(data_vencimento,7) IN ('${meses.join("','")}')`;
          break;
        }
        case 'ano':
          wPago     = `LEFT(data_pagamento,4)='${ano}'`;
          wPendente = `LEFT(data_vencimento,4)='${ano}'`;
          break;
        case 'todos':
          wPago     = `1=1`;
          wPendente = `1=1`;
          break;
        default:
          wPago     = `LEFT(data_pagamento,7)='${mesAno}'`;
          wPendente = `LEFT(data_vencimento,7)='${mesAno}'`;
      }
      const [receitas, despesas, recPend, despPend, porCategoria] = await Promise.all([
        db.get(`SELECT COALESCE(SUM(valor),0) AS total, COUNT(*) AS qtd FROM lancamentos WHERE tipo='receita' AND status='pago' AND ${wPago}`),
        db.get(`SELECT COALESCE(SUM(valor),0) AS total, COUNT(*) AS qtd FROM lancamentos WHERE tipo='despesa' AND status='pago' AND ${wPago}`),
        db.get(`SELECT COALESCE(SUM(valor),0) AS total FROM lancamentos WHERE tipo='receita' AND status='pendente' AND ${wPendente}`),
        db.get(`SELECT COALESCE(SUM(valor),0) AS total FROM lancamentos WHERE tipo='despesa' AND status='pendente' AND ${wPendente}`),
        db.all(`SELECT c.nome AS categoria, l.tipo, COALESCE(SUM(l.valor),0) AS total FROM lancamentos l LEFT JOIN categorias c ON c.id=l.categoria_id WHERE l.status='pago' AND ${wPago} GROUP BY l.categoria_id, c.nome, l.tipo ORDER BY total DESC LIMIT 10`),
      ]);
      return { periodo: args.periodo||'mes', mes, ano, receitas_pagas: receitas.total, receitas_qtd: receitas.qtd, despesas_pagas: despesas.total, despesas_qtd: despesas.qtd, lucro_liquido: receitas.total - despesas.total, receitas_pendentes: recPend.total, despesas_pendentes: despPend.total, por_categoria: porCategoria };
    }

    case 'get_pedidos': {
      const sf = args.status && args.status !== 'todos' ? `AND p.status='${args.status}'` : '';
      const pf = `AND TO_CHAR(p.criado_em,'YYYY-MM')='${mesAno}'`;
      const [resumo, etapas, total, recentes] = await Promise.all([
        db.all(`SELECT p.status, COUNT(*) AS qtd, COALESCE(SUM(p.valor_final),0) AS valor FROM pedidos p WHERE p.deleted_at IS NULL ${sf} ${pf} GROUP BY p.status`),
        db.all(`SELECT etapa_producao, COUNT(*) AS qtd FROM pedidos WHERE status NOT IN ('cancelado','concluido') AND deleted_at IS NULL GROUP BY etapa_producao`),
        db.get(`SELECT COUNT(*) AS qtd, COALESCE(SUM(p.valor_final),0) AS valor FROM pedidos p WHERE p.deleted_at IS NULL ${sf} ${pf}`),
        db.all(`SELECT p.numero, c.nome AS cliente, p.valor_final AS valor_total, p.status, p.etapa_producao, p.criado_em FROM pedidos p LEFT JOIN clientes c ON c.id=p.cliente_id WHERE p.deleted_at IS NULL ${sf} ${pf} ORDER BY p.criado_em DESC LIMIT 5`),
      ]);
      return { mes, ano, total_pedidos: total.qtd, valor_total: total.valor, por_status: resumo, etapas_producao: etapas, recentes };
    }

    case 'get_clientes': {
      const lim = parseInt(args.limite)||10;
      const [total, novos, recentes] = await Promise.all([
        db.get(`SELECT COUNT(*) AS qtd FROM clientes WHERE ativo=1`),
        db.get(`SELECT COUNT(*) AS qtd FROM clientes WHERE ativo=1 AND TO_CHAR(criado_em,'YYYY-MM')='${mesAno}'`),
        db.all(`SELECT nome, email, telefone, cidade, criado_em FROM clientes WHERE ativo=1 ORDER BY criado_em DESC LIMIT ${lim}`),
      ]);
      return { total_clientes: total.qtd, novos_no_periodo: novos.qtd, mes, ano, recentes };
    }

    case 'get_orcamentos': {
      const sf = args.status && args.status !== 'todos' ? `AND o.status='${args.status}'` : '';
      const [resumo, total] = await Promise.all([
        db.all(`SELECT o.status, COUNT(*) AS qtd, COALESCE(SUM(o.valor_final),0) AS valor FROM orcamentos o WHERE o.deleted_at IS NULL AND TO_CHAR(o.criado_em,'YYYY-MM')='${mesAno}' ${sf} GROUP BY o.status`),
        db.get(`SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_final),0) AS valor FROM orcamentos WHERE deleted_at IS NULL AND TO_CHAR(criado_em,'YYYY-MM')='${mesAno}' ${sf}`),
      ]);
      const aprovados = resumo.find(r => r.status === 'aprovado');
      const enviados  = resumo.find(r => r.status === 'enviado');
      const txConversao = ((enviados?.qtd||0)+(aprovados?.qtd||0)) > 0
        ? (((aprovados?.qtd||0) / ((enviados?.qtd||0)+(aprovados?.qtd||0)))*100).toFixed(1) : 0;
      return { mes, ano, total_orcamentos: total.qtd, valor_total: total.valor, por_status: resumo, taxa_conversao_pct: txConversao };
    }

    case 'get_leads': {
      const [por_etapa, total] = await Promise.all([
        db.all(`SELECT etapa, COUNT(*) AS qtd FROM leads WHERE TO_CHAR(criado_em,'YYYY-MM')='${mesAno}' GROUP BY etapa`),
        db.get(`SELECT COUNT(*) AS qtd FROM leads WHERE TO_CHAR(criado_em,'YYYY-MM')='${mesAno}'`),
      ]);
      const fechados = por_etapa.find(s => s.etapa === 'fechado');
      return { mes, ano, total_leads: total.qtd, fechados: fechados?.qtd||0, por_etapa };
    }

    case 'get_kanban_producao': {
      const [etapas, atrasados] = await Promise.all([
        db.all(`SELECT etapa_producao, COUNT(*) AS qtd, COALESCE(SUM(valor_final),0) AS valor FROM pedidos WHERE status NOT IN ('cancelado','concluido') AND deleted_at IS NULL GROUP BY etapa_producao`),
        db.get(`SELECT COUNT(*) AS qtd FROM pedidos WHERE status NOT IN ('cancelado','concluido') AND data_prevista_entrega IS NOT NULL AND data_prevista_entrega < TO_CHAR(CURRENT_DATE,'YYYY-MM-DD') AND deleted_at IS NULL`),
      ]);
      return { etapas_producao: etapas, total_atrasados: atrasados.qtd };
    }

    case 'get_estoque': {
      const filtro = args.apenas_criticos ? 'WHERE estoque_atual <= estoque_minimo AND ativo=1' : 'WHERE ativo=1';
      const [produtos, resumo] = await Promise.all([
        db.all(`SELECT nome, codigo, categoria, estoque_atual, estoque_minimo, unidade, CASE WHEN estoque_atual <= estoque_minimo THEN 'critico' ELSE 'ok' END AS situacao FROM produtos ${filtro} ORDER BY (estoque_atual - estoque_minimo) ASC LIMIT 20`),
        db.get(`SELECT COUNT(*) AS total, SUM(CASE WHEN estoque_atual <= estoque_minimo THEN 1 ELSE 0 END) AS criticos, COALESCE(SUM(estoque_atual * valor_custo),0) AS valor_total FROM produtos WHERE ativo=1`),
      ]);
      return { resumo, produtos };
    }

    case 'get_assistencia_tecnica': {
      const sf = args.status && args.status !== 'todos' ? `AND status='${args.status}'` : '';
      const [por_status, por_tipo] = await Promise.all([
        db.all(`SELECT status, COUNT(*) AS qtd FROM assistencias WHERE TO_CHAR(criado_em,'YYYY-MM')='${mesAno}' ${sf} GROUP BY status`),
        db.all(`SELECT tipo_problema, COUNT(*) AS qtd FROM assistencias WHERE TO_CHAR(criado_em,'YYYY-MM')='${mesAno}' GROUP BY tipo_problema ORDER BY qtd DESC LIMIT 5`),
      ]);
      return { mes, ano, por_status, por_tipo };
    }

    case 'get_comissoes': {
      const [comissoes, total_pago, total_pendente] = await Promise.all([
        db.all(`SELECT CASE c.tipo WHEN 'vendedor' THEN u.nome ELSE pa.nome END AS nome, c.tipo, COALESCE(SUM(c.valor_comissao),0) AS total, COUNT(*) AS qtd FROM comissoes c LEFT JOIN usuarios u ON u.id=c.pessoa_id AND c.tipo='vendedor' LEFT JOIN parceiros pa ON pa.id=c.pessoa_id AND c.tipo='parceiro' WHERE TO_CHAR(c.data_geracao,'YYYY-MM')='${mesAno}' GROUP BY c.pessoa_id, c.tipo, u.nome, pa.nome ORDER BY total DESC`),
        db.get(`SELECT COALESCE(SUM(valor_comissao),0) AS total FROM comissoes WHERE status='pago' AND TO_CHAR(data_geracao,'YYYY-MM')='${mesAno}'`),
        db.get(`SELECT COALESCE(SUM(valor_comissao),0) AS total FROM comissoes WHERE status='pendente' AND TO_CHAR(data_geracao,'YYYY-MM')='${mesAno}'`),
      ]);
      return { mes, ano, comissoes, total_pago: total_pago.total, total_pendente: total_pendente.total };
    }

    case 'get_metas': {
      const metas = await db.all(`
        SELECT m.*, u.nome AS vendedor_nome,
               COALESCE(SUM(p.valor_final),0) AS valor_realizado,
               COUNT(p.id) AS qtd_pedidos
        FROM metas m
        LEFT JOIN usuarios u ON u.id=m.vendedor_id
        LEFT JOIN pedidos p ON p.vendedor_id=m.vendedor_id
          AND p.status NOT IN ('cancelado')
          AND TO_CHAR(p.criado_em,'YYYY-MM')='${mesAno}'
        WHERE m.mes=$1 AND m.ano=$2
        GROUP BY m.id, m.vendedor_id, m.mes, m.ano, m.valor_meta, u.nome
        ORDER BY valor_realizado DESC
      `, [mes, ano]);
      return { mes, ano, metas };
    }

    case 'get_radar_prazos': {
      const dias = parseInt(args.dias)||7;
      const alertas = await db.all(`
        SELECT p.numero, c.nome AS cliente, p.data_prevista_entrega AS prazo,
               p.etapa_producao, p.valor_final AS valor_total,
               (p.data_prevista_entrega::date - CURRENT_DATE) AS dias_restantes
        FROM pedidos p LEFT JOIN clientes c ON c.id=p.cliente_id
        WHERE p.status NOT IN ('cancelado','concluido')
          AND p.data_prevista_entrega IS NOT NULL
          AND p.data_prevista_entrega::date <= CURRENT_DATE + $1
          AND p.deleted_at IS NULL
        ORDER BY p.data_prevista_entrega ASC LIMIT 20
      `, [dias]);
      return { dias_janela: dias, alertas };
    }

    case 'get_dashboard_geral': {
      const mA    = agora.getMonth() + 1;
      const aA    = agora.getFullYear();
      const mAStr = String(mA).padStart(2,'0');
      const mAMes = `${aA}-${mAStr}`;
      const [fat, pedAtivos, cliTotal, orcPend, atrasados, estCrit, assistAberta] = await Promise.all([
        db.get(`SELECT COALESCE(SUM(valor_final),0) AS total FROM pedidos WHERE status<>'cancelado' AND TO_CHAR(criado_em,'YYYY-MM')='${mAMes}' AND deleted_at IS NULL`),
        db.get(`SELECT COUNT(*) AS qtd FROM pedidos WHERE status='ativo' AND deleted_at IS NULL`),
        db.get(`SELECT COUNT(*) AS qtd FROM clientes WHERE ativo=1`),
        db.get(`SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_final),0) AS valor FROM orcamentos WHERE status IN ('enviado','rascunho') AND deleted_at IS NULL`),
        db.get(`SELECT COUNT(*) AS qtd FROM pedidos WHERE status NOT IN ('cancelado','concluido') AND data_prevista_entrega IS NOT NULL AND data_prevista_entrega < TO_CHAR(CURRENT_DATE,'YYYY-MM-DD') AND deleted_at IS NULL`),
        db.get(`SELECT COUNT(*) AS qtd FROM produtos WHERE ativo=1 AND estoque_atual <= estoque_minimo`),
        db.get(`SELECT COUNT(*) AS qtd FROM assistencias WHERE status='aberto'`),
      ]);
      return { faturamento_mes_atual: fat.total, pedidos_ativos: pedAtivos.qtd, total_clientes: cliTotal.qtd, orcamentos_pendentes: orcPend.qtd, valor_orcamentos_pendentes: orcPend.valor, pedidos_atrasados: atrasados.qtd, produtos_estoque_critico: estCrit.qtd, chamados_assistencia_abertos: assistAberta.qtd, mes_atual: mA, ano_atual: aA };
    }

    default:
      return { erro: 'Ferramenta desconhecida' };
  }
}

async function comRetry(fn, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch (err) {
      const e503 = err.message?.includes('503') || err.message?.includes('high demand');
      if (e503 && i < tentativas - 1) {
        await new Promise(r => setTimeout(r, (i + 1) * 2000));
        continue;
      }
      throw err;
    }
  }
}

async function processarMensagem(mensagens) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    tools: TOOLS,
  });

  const history = mensagens.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const ultimaMensagem = mensagens[mensagens.length - 1].content;
  const chat = model.startChat({ history });

  let result = await comRetry(() => chat.sendMessage(ultimaMensagem));

  let iteracoes = 0;
  while (iteracoes++ < 5) {
    const parts = result.response.candidates?.[0]?.content?.parts || [];
    const funcCalls = parts.filter(p => p.functionCall);

    console.log(`[chatbot] iteração ${iteracoes} | parts: ${parts.length} | funcCalls: ${funcCalls.length}`);
    if (!funcCalls.length) break;

    const funcResponses = await Promise.all(funcCalls.map(async part => {
      console.log(`[chatbot] chamando ferramenta: ${part.functionCall.name}`, part.functionCall.args);
      let saida;
      try {
        saida = await executarFerramenta(part.functionCall.name, part.functionCall.args || {});
        console.log(`[chatbot] resultado:`, JSON.stringify(saida).slice(0, 200));
      } catch (err) {
        console.error(`[chatbot] erro na ferramenta ${part.functionCall.name}:`, err.message);
        saida = { erro: err.message };
      }
      return { functionResponse: { name: part.functionCall.name, response: saida } };
    }));

    result = await comRetry(() => chat.sendMessage(funcResponses));
  }

  const texto = result.response.text();
  console.log(`[chatbot] resposta final:`, texto.slice(0, 300));
  return texto;
}

module.exports = { processarMensagem };
