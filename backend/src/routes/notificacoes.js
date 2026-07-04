const express = require('express');
const db = require('../utils/db');
const { autenticar } = require('../middlewares/auth');

const router = express.Router();
router.use(autenticar);

function waLink(whatsapp, numero, clienteNome, tipo, empresa) {
  if (!whatsapp) return null;
  const fone = whatsapp.replace(/\D/g, '');
  if (!fone) return null;
  const msgs = {
    atrasado: `Olá ${clienteNome}! Gostaríamos de falar sobre o pedido *${numero}*. Podemos combinar uma nova data de entrega?\n\n— ${empresa}`,
    amanha:   `Olá ${clienteNome}! Passando para lembrar que a entrega do seu pedido *${numero}* está prevista para *amanhã*. Qualquer dúvida, estamos à disposição!\n\n— ${empresa}`,
    semana:   `Olá ${clienteNome}! A entrega do seu pedido *${numero}* está prevista para essa semana. Em breve entraremos em contato para combinar os detalhes.\n\n— ${empresa}`,
    cobranca: `Olá ${clienteNome}! Identificamos que o pagamento referente ao pedido *${numero}* está em aberto. Poderia nos confirmar quando será realizado?\n\nCaso já tenha efetuado o pagamento, desconsidere esta mensagem.\n\n— ${empresa}`,
  };
  return `https://wa.me/55${fone}?text=${encodeURIComponent(msgs[tipo] || msgs.atrasado)}`;
}

router.get('/', async (req, res) => {
  try {
    const hoje   = new Date().toISOString().split('T')[0];
    const amanha = new Date(Date.now() + 86_400_000).toISOString().split('T')[0];
    const em7    = new Date(Date.now() + 7 * 86_400_000).toISOString().split('T')[0];

    const cfg = await db.get('SELECT nome_empresa FROM configuracoes_loja WHERE id=1');
    const empresa = cfg?.nome_empresa || 'GM MÓBILE';

    const comWa = (rows, tipo) => rows.map(p => ({
      ...p,
      whatsapp_link: waLink(p.cliente_whatsapp, p.numero, p.cliente_nome, tipo, empresa),
    }));

    const [pedidosAtrasados, entregaAmanha, entregaSemana, cobrancasVencidas, estoqueBaixo, kanbanEstagnados] = await Promise.all([
      db.all(`
        SELECT p.id, p.numero, c.nome AS cliente_nome, c.whatsapp AS cliente_whatsapp,
               p.data_prevista_entrega::text
        FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id
        WHERE p.status NOT IN ('concluido','cancelado')
          AND p.data_prevista_entrega IS NOT NULL AND p.data_prevista_entrega < $1
        ORDER BY p.data_prevista_entrega LIMIT 20
      `, [hoje]),
      db.all(`
        SELECT p.id, p.numero, c.nome AS cliente_nome, c.whatsapp AS cliente_whatsapp,
               p.data_prevista_entrega::text
        FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id
        WHERE p.status NOT IN ('concluido','cancelado') AND p.data_prevista_entrega = $1
        ORDER BY p.numero
      `, [amanha]),
      db.all(`
        SELECT p.id, p.numero, c.nome AS cliente_nome, c.whatsapp AS cliente_whatsapp,
               p.data_prevista_entrega::text
        FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id
        WHERE p.status NOT IN ('concluido','cancelado')
          AND p.data_prevista_entrega > $1 AND p.data_prevista_entrega <= $2
        ORDER BY p.data_prevista_entrega LIMIT 15
      `, [amanha, em7]),
      db.all(`
        SELECT l.id, l.descricao, l.valor, l.data_vencimento::text,
               p.numero AS pedido_numero, c.nome AS cliente_nome, c.whatsapp AS cliente_whatsapp
        FROM lancamentos l
        LEFT JOIN pedidos p ON p.id = l.pedido_id
        LEFT JOIN clientes c ON c.id = p.cliente_id
        WHERE l.tipo='receita' AND l.status='pendente' AND l.valor > 0 AND l.data_vencimento < $1
        ORDER BY l.data_vencimento LIMIT 20
      `, [hoje]),
      db.all(`
        SELECT id, nome, estoque_atual, estoque_minimo
        FROM produtos WHERE ativo=1 AND estoque_minimo > 0 AND estoque_atual <= estoque_minimo
        ORDER BY (estoque_atual - estoque_minimo) LIMIT 20
      `),
      db.all(`
        SELECT p.id, p.numero, c.nome AS cliente_nome, p.etapa_producao,
               EXTRACT(DAY FROM NOW() - COALESCE(p.etapa_atualizada_em, p.criado_em))::int AS dias_na_etapa
        FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id
        WHERE p.status NOT IN ('cancelado','concluido')
          AND EXTRACT(DAY FROM NOW() - COALESCE(p.etapa_atualizada_em, p.criado_em)) >= 7
        ORDER BY dias_na_etapa DESC LIMIT 10
      `),
    ]);

    res.json({
      total: pedidosAtrasados.length + entregaAmanha.length + entregaSemana.length +
             cobrancasVencidas.length + estoqueBaixo.length + kanbanEstagnados.length,
      pedidos_atrasados: comWa(pedidosAtrasados, 'atrasado'),
      entrega_amanha:    comWa(entregaAmanha, 'amanha'),
      entrega_semana:    comWa(entregaSemana, 'semana'),
      cobrancas_vencidas: cobrancasVencidas.map(c => ({
        ...c,
        whatsapp_link: waLink(c.cliente_whatsapp, c.pedido_numero || '—', c.cliente_nome || 'Cliente', 'cobranca', empresa),
      })),
      estoque_baixo:     estoqueBaixo,
      kanban_estagnados: kanbanEstagnados,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar notificações' });
  }
});

module.exports = router;
