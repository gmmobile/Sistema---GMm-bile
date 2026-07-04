/**
 * GM Assistant — widget de chat com IA integrado ao sistema
 */
(function () {
  const STORAGE_KEY_MSGS   = 'gm_chat_msgs';
  const STORAGE_KEY_SESSAO = 'gm_chat_sessao';

  let sessaoId  = sessionStorage.getItem(STORAGE_KEY_SESSAO) || null;
  let aberto    = false;
  let digitando = false;

  // ── Estilos ──
  const style = document.createElement('style');
  style.textContent = `
    #gm-chat-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: var(--primary, #C4A24A);
      color: #fff;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(196,162,74,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9998;
      transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
      opacity: 0.35;
    }
    #gm-chat-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 20px rgba(196,162,74,0.55);
      opacity: 1;
    }
    #gm-chat-btn svg { width: 22px; height: 22px; }

    #gm-chat-badge {
      position: absolute;
      top: -3px;
      right: -3px;
      width: 14px;
      height: 14px;
      background: #ef4444;
      border-radius: 50%;
      border: 2px solid var(--bg, #0d1117);
      display: none;
    }

    #gm-chat-panel {
      position: fixed;
      bottom: 88px;
      right: 24px;
      width: 380px;
      max-height: 580px;
      background: var(--card, #161b27);
      border: 1px solid var(--border, rgba(255,255,255,0.08));
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 12px 40px rgba(0,0,0,0.4);
      z-index: 9999;
      overflow: hidden;
      opacity: 0;
      transform: translateY(16px) scale(0.97);
      pointer-events: none;
      transition: opacity 0.22s ease, transform 0.22s ease;
    }
    #gm-chat-panel.aberto {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: all;
    }

    .gm-chat-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
      background: var(--card-header, rgba(196,162,74,0.06));
    }
    .gm-chat-header-icon {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, #C4A24A, #a8893a);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      padding: 2px;
      box-shadow: 0 0 0 2px rgba(196,162,74,0.5);
    }
    .gm-chat-header-icon svg { width: 16px; height: 16px; color: #fff; }
    .gm-chat-header-info { flex: 1; }
    .gm-chat-header-info strong {
      display: block;
      font-size: 13px;
      color: var(--text, #e2e8f0);
    }
    .gm-chat-header-info span {
      font-size: 11px;
      color: var(--muted, #64748b);
    }
    .gm-chat-header-actions { display: flex; gap: 4px; }
    .gm-chat-header-actions button {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--muted, #64748b);
      padding: 4px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s, background 0.15s;
    }
    .gm-chat-header-actions button:hover {
      color: var(--text, #e2e8f0);
      background: rgba(255,255,255,0.06);
    }
    .gm-chat-header-actions button svg { width: 15px; height: 15px; }

    .gm-chat-msgs {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.1) transparent;
    }

    .gm-msg {
      max-width: 88%;
      line-height: 1.55;
      font-size: 13px;
    }
    .gm-msg.user {
      align-self: flex-end;
      background: var(--primary, #C4A24A);
      color: #fff;
      padding: 9px 13px;
      border-radius: 14px 14px 3px 14px;
    }
    .gm-msg.assistant {
      align-self: flex-start;
      background: var(--input-bg, rgba(255,255,255,0.05));
      color: var(--text, #e2e8f0);
      padding: 10px 13px;
      border-radius: 3px 14px 14px 14px;
    }
    .gm-msg.assistant strong { color: var(--primary, #C4A24A); }
    .gm-msg.assistant ul, .gm-msg.assistant ol {
      padding-left: 16px;
      margin: 4px 0;
    }
    .gm-msg.assistant li { margin: 2px 0; }
    .gm-msg.assistant code {
      background: rgba(255,255,255,0.08);
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 12px;
    }

    .gm-typing {
      align-self: flex-start;
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 10px 14px;
      background: var(--input-bg, rgba(255,255,255,0.05));
      border-radius: 3px 14px 14px 14px;
    }
    .gm-typing span {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--primary, #C4A24A);
      animation: gm-bounce 1.2s ease infinite;
    }
    .gm-typing span:nth-child(2) { animation-delay: 0.2s; }
    .gm-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes gm-bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
      30% { transform: translateY(-5px); opacity: 1; }
    }

    .gm-chat-footer {
      padding: 12px;
      border-top: 1px solid var(--border, rgba(255,255,255,0.08));
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    .gm-chat-input {
      flex: 1;
      background: var(--input-bg, rgba(255,255,255,0.05));
      border: 1px solid var(--border, rgba(255,255,255,0.08));
      border-radius: 10px;
      color: var(--text, #e2e8f0);
      font-size: 13px;
      padding: 9px 12px;
      resize: none;
      max-height: 100px;
      min-height: 38px;
      line-height: 1.4;
      outline: none;
      font-family: inherit;
      transition: border-color 0.15s;
    }
    .gm-chat-input:focus { border-color: var(--primary, #C4A24A); }
    .gm-chat-input::placeholder { color: var(--muted, #64748b); }
    .gm-chat-send {
      background: var(--primary, #C4A24A);
      border: none;
      border-radius: 10px;
      color: #fff;
      cursor: pointer;
      padding: 9px 13px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: opacity 0.15s, transform 0.1s;
    }
    .gm-chat-send:hover { opacity: 0.88; }
    .gm-chat-send:active { transform: scale(0.95); }
    .gm-chat-send:disabled { opacity: 0.4; cursor: not-allowed; }
    .gm-chat-send svg { width: 16px; height: 16px; }

    .gm-sugestoes {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 16px 12px;
    }
    .gm-sugestao {
      background: rgba(196,162,74,0.1);
      border: 1px solid rgba(196,162,74,0.2);
      color: var(--primary, #C4A24A);
      border-radius: 20px;
      font-size: 11px;
      padding: 4px 10px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s;
    }
    .gm-sugestao:hover { background: rgba(196,162,74,0.2); }

    /* Preview da foto da agente */
    #gm-foto-preview {
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0);
      transition: background 0.28s ease;
      cursor: pointer;
    }
    #gm-foto-preview.visivel { background: rgba(0,0,0,0.55); }
    #gm-foto-preview img {
      width: 200px;
      height: 200px;
      border-radius: 50%;
      object-fit: cover;
      object-position: center top;
      border: 3px solid #C4A24A;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5);
      transform: scale(0.4);
      opacity: 0;
      transition: transform 0.32s cubic-bezier(0.34,1.56,0.64,1), opacity 0.22s ease;
    }
    #gm-foto-preview.visivel img { transform: scale(1); opacity: 1; }

    /* Efeito de entrada da bolha */
    .gm-msg { opacity: 0; transform: translateY(6px); transition: opacity 0.18s ease, transform 0.18s ease; }
    .gm-msg.visivel { opacity: 1; transform: translateY(0); }

    /* Cursor piscando durante a digitação */
    .gm-msg.digitando::after {
      content: '▋';
      color: var(--primary, #C4A24A);
      animation: gm-cursor 0.7s step-end infinite;
      font-size: 0.9em;
      margin-left: 1px;
    }
    @keyframes gm-cursor { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

    @media (max-width: 480px) {
      #gm-chat-panel { width: calc(100vw - 20px); right: 10px; bottom: 80px; }
      #gm-chat-btn { right: 16px; bottom: 16px; }
    }
  `;
  document.head.appendChild(style);

  // ── HTML do widget ──
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <button id="gm-chat-btn" title="Assistente Pessoal — Pergunte sobre o sistema">
      <span id="gm-chat-badge"></span>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </button>

    <div id="gm-chat-panel">
      <div class="gm-chat-header">
        <div class="gm-chat-header-icon" style="padding:0;overflow:hidden;">
          <img src="/assets/img/agente-ia.png" alt="Assistente" style="width:44px;height:44px;border-radius:50%;object-fit:cover;object-position:center top;display:block;image-rendering:high-quality;">
        </div>
        <div class="gm-chat-header-info">
          <strong>Assistente Pessoal</strong>
          <span>Assistente inteligente do sistema</span>
        </div>
        <div class="gm-chat-header-actions">
          <button id="gm-chat-clear" title="Limpar conversa">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
            </svg>
          </button>
          <button id="gm-chat-close" title="Fechar">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="gm-chat-msgs" id="gm-chat-msgs"></div>

      <div class="gm-sugestoes" id="gm-sugestoes">
        <button class="gm-sugestao">Análise completa do mês</button>
        <button class="gm-sugestao">Como está o funil de vendas?</button>
        <button class="gm-sugestao">Pedidos em risco de atraso</button>
        <button class="gm-sugestao">Desempenho da equipe</button>
        <button class="gm-sugestao">Faturamento vs meta</button>
        <button class="gm-sugestao">Orçamentos aguardando retorno</button>
      </div>

      <div class="gm-chat-footer">
        <textarea
          id="gm-chat-input"
          class="gm-chat-input"
          placeholder="Pergunte sobre faturamento, pedidos, clientes…"
          rows="1"
        ></textarea>
        <button class="gm-chat-send" id="gm-chat-send">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper);

  const btn = document.getElementById('gm-chat-btn');
  const panel = document.getElementById('gm-chat-panel');
  const msgs = document.getElementById('gm-chat-msgs');
  const input = document.getElementById('gm-chat-input');
  const sendBtn = document.getElementById('gm-chat-send');
  const badge = document.getElementById('gm-chat-badge');
  const sugestoes = document.getElementById('gm-sugestoes');

  // ── Funções auxiliares ──
  function togglePanel() {
    aberto = !aberto;
    panel.classList.toggle('aberto', aberto);
    badge.style.display = 'none';
    if (aberto) {
      setTimeout(() => input.focus(), 50);
      if (!msgs.children.length) {
        const restaurado = restaurarHistorico();
        if (!restaurado) mostrarBoasVindas();
      }
    }
  }

  function saudacao() {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return 'Bom dia';
    if (h >= 12 && h < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  function mostrarBoasVindas() {
    const usuario = typeof getUsuario === 'function' ? getUsuario() : null;
    const nome = usuario?.nome?.split(' ')[0] || 'Gestor';
    const agora = new Date();
    const data = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    adicionarMsg('assistant',
      `${saudacao()}, **${nome}**!\n\n` +
      `Sou sua **Assistente Pessoal** — especialista em CRM e ERP do GM MÓBILE. Tenho acesso em tempo real a todos os dados do sistema: faturamento, funil de vendas, pedidos, produção, equipe, metas, financeiro e estoque.\n\n` +
      `Posso fazer **análises completas**, identificar gargalos, comparar períodos e dar recomendações práticas baseadas nos seus números.\n\n` +
      `Experimente perguntar algo como *"como está o mês?"* ou use uma das sugestões abaixo.`
    );
  }

  function salvarHistorico() {
    const itens = [...msgs.querySelectorAll('.gm-msg')].map(el => ({
      role: el.classList.contains('user') ? 'user' : 'assistant',
      html: el.innerHTML
    }));
    sessionStorage.setItem(STORAGE_KEY_MSGS, JSON.stringify(itens));
  }

  function restaurarHistorico() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_MSGS);
      if (!raw) return false;
      const itens = JSON.parse(raw);
      // Ignora o histórico se só tiver a mensagem de boas-vindas (sem interação real)
      const temConversa = itens.some(i => i.role === 'user');
      if (!temConversa) return false;
      itens.forEach(({ role, html }) => {
        const div = document.createElement('div');
        div.className = `gm-msg ${role} visivel`;
        div.innerHTML = html;
        msgs.appendChild(div);
      });
      msgs.scrollTop = msgs.scrollHeight;
      return true;
    } catch { return false; }
  }

  function adicionarMsg(role, texto) {
    const div = document.createElement('div');
    div.className = `gm-msg ${role}`;
    div.innerHTML = role === 'assistant' ? renderMarkdown(texto) : escapeHtmlLocal(texto);
    msgs.appendChild(div);
    requestAnimationFrame(() => div.classList.add('visivel'));
    msgs.scrollTop = msgs.scrollHeight;
    salvarHistorico();
    return div;
  }

  function typewriterMsg(texto, onDone) {
    const div = document.createElement('div');
    div.className = 'gm-msg assistant digitando';
    msgs.appendChild(div);
    requestAnimationFrame(() => div.classList.add('visivel'));

    // velocidade adaptativa: termina entre 1s (curto) e 2.5s (longo)
    const total   = texto.length;
    const duracao = Math.min(2500, Math.max(1000, total * 10));
    const porTick = Math.max(1, Math.ceil(total / (duracao / 16)));
    let i = 0;

    const tick = () => {
      i = Math.min(i + porTick, total);
      div.innerHTML = renderMarkdown(texto.slice(0, i));
      msgs.scrollTop  = msgs.scrollHeight;
      if (i < total) {
        requestAnimationFrame(tick);
      } else {
        div.classList.remove('digitando');
        msgs.scrollTop = msgs.scrollHeight;
        salvarHistorico();
        if (onDone) onDone();
      }
    };
    requestAnimationFrame(tick);
    return div;
  }

  function mostrarDigitando() {
    const div = document.createElement('div');
    div.className = 'gm-typing';
    div.id = 'gm-typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function removerDigitando() {
    document.getElementById('gm-typing-indicator')?.remove();
  }

  function escapeHtmlLocal(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderMarkdown(text) {
    return text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/^### (.+)$/gm, '<strong>$1</strong>')
      .replace(/^## (.+)$/gm, '<strong>$1</strong>')
      .replace(/^# (.+)$/gm, '<strong>$1</strong>')
      .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
      .replace(/\n{2,}/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }

  function ajustarAltura() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  }

  async function enviarMensagem(texto) {
    if (digitando || !texto.trim()) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    sugestoes.style.display = 'none';
    adicionarMsg('user', texto);
    input.value = '';
    input.style.height = '';
    digitando = true;
    sendBtn.disabled = true;
    mostrarDigitando();

    try {
      const res = await fetch('/api/chatbot/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ mensagem: texto, sessao_id: sessaoId })
      });

      const data = await res.json();
      removerDigitando();

      const liberar = () => { digitando = false; sendBtn.disabled = false; input.focus(); };

      if (!res.ok) {
        const msg = res.status === 429
          ? 'Limite de requisições atingido. Aguarde alguns minutos e tente novamente.'
          : (data.erro || 'Erro ao processar sua mensagem.');
        adicionarMsg('assistant', `⚠️ ${msg}`);
        liberar();
      } else {
        sessaoId = data.sessao_id;
        sessionStorage.setItem(STORAGE_KEY_SESSAO, sessaoId);
        typewriterMsg(data.resposta, liberar);
      }
    } catch {
      removerDigitando();
      adicionarMsg('assistant', '⚠️ Não consegui me conectar. Verifique se o servidor está rodando.');
      digitando = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  // ── Eventos ──
  btn.addEventListener('click', togglePanel);

  document.getElementById('gm-chat-close').addEventListener('click', () => {
    aberto = false;
    panel.classList.remove('aberto');
  });

  document.getElementById('gm-chat-clear').addEventListener('click', () => {
    if (sessaoId) {
      const token = localStorage.getItem('token');
      fetch(`/api/chatbot/sessao/${sessaoId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(() => {});
    }
    msgs.innerHTML = '';
    sessaoId = null;
    sessionStorage.removeItem(STORAGE_KEY_MSGS);
    sessionStorage.removeItem(STORAGE_KEY_SESSAO);
    sugestoes.style.display = 'flex';
    mostrarBoasVindas();
  });

  // Preview da foto ao clicar
  const fotoHeader = panel.querySelector('.gm-chat-header-icon img');
  if (fotoHeader) {
    fotoHeader.style.cursor = 'pointer';
    fotoHeader.addEventListener('click', () => {
      const overlay = document.createElement('div');
      overlay.id = 'gm-foto-preview';
      const img = document.createElement('img');
      img.src = '/assets/img/agente-ia.png';
      overlay.appendChild(img);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('visivel')));
      overlay.addEventListener('click', () => {
        overlay.classList.remove('visivel');
        setTimeout(() => overlay.remove(), 320);
      });
    });
  }

  sendBtn.addEventListener('click', () => enviarMensagem(input.value));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviarMensagem(input.value);
    }
  });

  input.addEventListener('input', ajustarAltura);

  // Sugestões rápidas
  sugestoes.querySelectorAll('.gm-sugestao').forEach(btn => {
    btn.addEventListener('click', () => enviarMensagem(btn.textContent));
  });

  // Badge de novidade quando fechado
  let primeiraVez = !sessionStorage.getItem('gm_chat_visto');
  if (primeiraVez) {
    badge.style.display = 'block';
    sessionStorage.setItem('gm_chat_visto', '1');
  }
})();
