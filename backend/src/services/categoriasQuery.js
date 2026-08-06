/* ════════════════════════════════════════════════════════════════
   CATEGORIAS QUERY — agregação de lançamentos por categoria
   Helper compartilhado para evitar duplicar o mesmo JOIN/GROUP BY
   em relatorios.js (DRE, Financeiro) e financeiro.js (DRE).
   ════════════════════════════════════════════════════════════════ */
const db = require('../utils/db');

const n = v => parseFloat(v) || 0;

/**
 * Soma de lançamentos pagos por categoria, filtrando por tipo e período
 * (data_pagamento entre ini/fim, inclusive). ini/fim devem já estar
 * validados como 'YYYY-MM-DD' pelo chamador.
 */
async function porCategoria(tipo, ini, fim, corPadrao = '#6366f1') {
  const rows = await db.all(
    `SELECT COALESCE(cat.nome,'Sem Categoria') AS categoria, COALESCE(cat.cor,$4) AS cor,
            COALESCE(SUM(l.valor),0) AS total
     FROM lancamentos l
     LEFT JOIN categorias cat ON cat.id = l.categoria_id
     WHERE l.tipo = $1 AND l.status = 'pago' AND l.data_pagamento BETWEEN $2 AND $3
     GROUP BY cat.nome, cat.cor
     ORDER BY total DESC`,
    [tipo, ini, fim, corPadrao]
  );
  return rows.map(r => ({ categoria: r.categoria, cor: r.cor, total: n(r.total) }));
}

module.exports = { porCategoria };
