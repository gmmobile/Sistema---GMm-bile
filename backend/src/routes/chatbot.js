const router = require('express').Router();
const { autenticar } = require('../middlewares/auth');
const { processarMensagem } = require('../services/chatbotService');

// Histório de conversa por sessão (em memória, resetado ao reiniciar o servidor)
// Para produção, usar banco ou Redis — aqui é suficiente para uso interno
const sessoes = new Map();
const MAX_HISTORICO = 20; // últimas 20 mensagens por sessão

router.post('/message', autenticar, async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ erro: 'Chatbot não configurado. Defina GEMINI_API_KEY no .env' });
  }

  const { mensagem, sessao_id } = req.body;
  if (!mensagem?.trim()) {
    return res.status(400).json({ erro: 'Mensagem não pode ser vazia' });
  }

  const chave = sessao_id || `${req.usuario.id}_${Date.now()}`;
  const historico = sessoes.get(chave) || [];

  historico.push({ role: 'user', content: mensagem.trim() });

  // Mantém apenas as últimas N mensagens para não extrapolar context window
  const historicoRecente = historico.slice(-MAX_HISTORICO);

  try {
    const resposta = await processarMensagem(historicoRecente);
    historico.push({ role: 'assistant', content: resposta });
    // Salva histórico atualizado (limitado)
    sessoes.set(chave, historico.slice(-MAX_HISTORICO));

    res.json({ resposta, sessao_id: chave });
  } catch (err) {
    console.error('[chatbot ERRO]', err.message?.slice(0, 200));
    if (err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('Too Many Requests')) {
      return res.status(429).json({ erro: 'Limite de requisições atingido. Aguarde alguns minutos e tente novamente.' });
    }
    res.status(500).json({ erro: 'Erro ao processar mensagem. Tente novamente.' });
  }
});

router.delete('/sessao/:id', autenticar, (req, res) => {
  sessoes.delete(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
