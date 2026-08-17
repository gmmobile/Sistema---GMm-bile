/* Planos de pagamento por etapa/fase do projeto — sem data de vencimento fixa.
   Cada fase fica em aberto (pendente) até o cliente pagar; quando a obra avança,
   a fase seguinte é criada manualmente (rota /lancamentos/:id/avancar-fase). */

const PLANOS_PAGAMENTO = {
  planoA: {
    etapas: [
      { label: 'Entrada',                       pct: 30 },
      { label: 'Aprovação do Projeto no Grupo', pct: 20 },
      { label: 'Medição',                       pct: 15 },
      { label: 'Entrega do Material',           pct: 15 },
      { label: 'Montagem',                      pct: 10 },
      { label: 'No Término',                    pct: 10 },
    ],
  },
  planoB: {
    etapas: [
      { label: 'Entrada',                       pct: 30 },
      { label: 'Aprovação do Projeto no Grupo', pct: 20 },
      { label: 'Medição Final',                 pct: 15 },
      { label: 'Entrega do Material',           pct: 10 },
      { label: 'Montagem',                      pct: 15 },
      { label: 'Término',                       pct: 10 },
    ],
  },
};

// indice é 0-based. A última fase absorve o arredondamento das anteriores,
// pra soma das fases bater exatamente com o valor total do projeto.
function calcularValorFase(valorTotal, etapas, indice) {
  let somaAnteriores = 0;
  for (let i = 0; i < indice; i++) {
    somaAnteriores += +(valorTotal * etapas[i].pct / 100).toFixed(2);
  }
  if (indice === etapas.length - 1) return +(valorTotal - somaAnteriores).toFixed(2);
  return +(valorTotal * etapas[indice].pct / 100).toFixed(2);
}

module.exports = { PLANOS_PAGAMENTO, calcularValorFase };
