// Aplica tema salvo ANTES de renderizar — evita flash
(function () {
  if (localStorage.getItem('tema') === 'light') document.documentElement.classList.add('light');
})();

// Garante autenticação
if (!checkAuth()) throw new Error('Não autenticado');

const usuario = getUsuario();

// Mapeamento de arquivo HTML → nome do módulo de permissão
const MODULO_MAP = {
  'dashboard.html':    'dashboard',
  'ranking.html':      'ranking',
  'agenda.html':       'agenda',
  'relatorios.html':   'relatorios',
  'clientes.html':     'clientes',
  'crm.html':          'crm',
  'comercial.html':    'comercial',
  'renders.html':      'renders',
  'radar.html':        'radar',
  'assistencia.html':  'assistencia',
  'financeiro.html':     'financeiro',
  'notas-fiscais.html':  'notas_fiscais',
  'contas.html':         'contas',
  'categorias.html':     'categorias',
  'comissoes.html':      'comissoes',
  'parceiros.html':      'parceiros',
  'conciliacao.html':    'financeiro',
  'estoque.html':        'estoque',
  'orcamentos.html':     'comercial',
  'kanban.html':         'comercial',
  'ordens-servico.html': 'assistencia',
  'fornecedores.html':   'financeiro',
  'usuarios.html':       'usuarios',
  'configuracoes.html':  'configuracoes',
};

// ── SIDEBAR DINÂMICA ──
const NAV = [
  {
    secao: 'Visão Geral',
    itens: [
      { label: 'Dashboard',      icon: 'layout-dashboard', href: 'dashboard.html' },
      { label: 'Ranking / Metas',icon: 'trophy',           href: 'ranking.html' },
      { label: 'Agenda',         icon: 'calendar-days',    href: 'agenda.html' },
      { label: 'Relatórios',     icon: 'bar-chart-2',      href: 'relatorios.html' },
    ]
  },
  {
    secao: 'Vendas',
    itens: [
      { label: 'Clientes',    icon: 'users',      href: 'clientes.html' },
      { label: 'CRM / Leads', icon: 'funnel',     href: 'crm.html' },
      { label: 'Orçamentos',  icon: 'file-check', href: 'orcamentos.html' },
      { label: 'Pedidos',     icon: 'briefcase',  href: 'comercial.html' },
      { label: 'Render Pro',  icon: 'image',      href: 'renders.html' },
    ]
  },
  {
    secao: 'Produção',
    itens: [
      { label: 'Kanban',           icon: 'columns',       href: 'kanban.html' },
      { label: 'Ordens de Serviço',icon: 'clipboard-list',href: 'ordens-servico.html' },
      { label: 'Radar de Prazos',  icon: 'radar',         href: 'radar.html' },
      { label: 'Assistência Téc.', icon: 'wrench',        href: 'assistencia.html' },
    ]
  },
  {
    secao: 'Financeiro',
    itens: [
      { label: 'Financeiro',           icon: 'wallet',     href: 'financeiro.html' },
      { label: 'Conciliação Bancária', icon: 'git-compare',href: 'conciliacao.html' },
      { label: 'Notas Fiscais',        icon: 'file-text',  href: 'notas-fiscais.html' },
      { label: 'Contas Correntes',     icon: 'landmark',   href: 'contas.html' },
      { label: 'Categorias',           icon: 'tag',        href: 'categorias.html' },
      { label: 'Comissões',            icon: 'percent',    href: 'comissoes.html' },
    ]
  },
  {
    secao: 'Estoque & Parceiros',
    itens: [
      { label: 'Estoque',     icon: 'package',   href: 'estoque.html' },
      { label: 'Fornecedores',icon: 'truck',     href: 'fornecedores.html' },
      { label: 'Parceiros',   icon: 'handshake', href: 'parceiros.html' },
    ]
  },
  {
    secao: 'Sistema',
    itens: [
      { label: 'Usuários',      icon: 'user-cog', href: 'usuarios.html' },
      { label: 'Configurações', icon: 'settings', href: 'configuracoes.html' },
    ]
  }
];

async function carregarPermissoes() {
  if (sessionStorage.getItem('permissoes')) return;
  if (usuario?.perfil === 'gestor') {
    sessionStorage.setItem('permissoes', JSON.stringify({ _all: 'total' }));
    return;
  }
  try {
    const token = localStorage.getItem('token');
    const resp = await fetch(window.location.origin + '/api/usuarios/minhas-permissoes', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (resp.ok) {
      const data = await resp.json();
      sessionStorage.setItem('permissoes', JSON.stringify(data));
    }
    // Se a API retornar erro (ex: 404 por servidor não reiniciado), não armazena nada —
    // buildSidebar verá null e não vai filtrar nem redirecionar (usuário não fica travado)
  } catch(e) {
    // Erro de rede — mesma lógica: não armazena, não trava
  }
}

function buildSidebar() {
  const paginaAtual = window.location.pathname.split('/').pop();
  const raw = sessionStorage.getItem('permissoes');
  const permissoes = raw ? JSON.parse(raw) : null;
  // Se permissões não foram carregadas (ex: API offline), não filtra nada
  const permCarregadas = permissoes !== null;
  const isGestor = usuario?.perfil === 'gestor' || permissoes?._all === 'total';

  // Verifica acesso à página atual só se permissões foram carregadas
  if (permCarregadas && !isGestor) {
    const moduloAtual = MODULO_MAP[paginaAtual];
    if (moduloAtual) {
      const nivel = permissoes[moduloAtual] || 'sem_acesso';
      if (nivel === 'sem_acesso') {
        window.location.href = 'dashboard.html';
        return;
      }
    }
  }

  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // Oculta a sidebar antes de montar para não piscar o scroll
  sidebar.style.visibility = 'hidden';

  sidebar.innerHTML = `
    <a class="sidebar-logo" href="dashboard.html">
      <div class="sidebar-logo-icon" id="sidebarLogoIcon"><i data-lucide="sofa"></i></div>
      <div class="sidebar-logo-text">
        <strong>GM MÓBILE</strong>
        <span>Móveis Planejados</span>
      </div>
    </a>
    <nav class="sidebar-nav" id="sidebarNav"></nav>
    <div class="sidebar-user">
      <div class="sidebar-user-inner">
        ${usuario?.foto
          ? `<img src="${usuario.foto}" alt="" style="width:32px;height:32px;border-radius:8px;object-fit:cover;flex-shrink:0" onerror="this.outerHTML='<div class=\\'user-avatar\\'>${(usuario?.nome||'U')[0].toUpperCase()}</div>'">`
          : `<div class="user-avatar">${(usuario?.nome || 'U')[0].toUpperCase()}</div>`
        }
        <div class="user-info">
          <strong>${usuario?.nome || 'Usuário'}</strong>
          <span>${usuario?.perfil || ''}</span>
        </div>
      </div>
      <button class="sidebar-logout" onclick="logout()" title="Sair da conta">
        <i data-lucide="log-out"></i>
      </button>
    </div>
  `;

  const nav = document.getElementById('sidebarNav');

  NAV.forEach(({ secao, itens }) => {
    // Filtra itens sem acesso (só se permissões foram carregadas)
    const itensFiltrados = itens.filter(item => {
      if (!permCarregadas || isGestor) return true;
      const modulo = MODULO_MAP[item.href];
      if (!modulo) return true;
      return (permissoes[modulo] || 'sem_acesso') !== 'sem_acesso';
    });

    if (!itensFiltrados.length) return;

    const sec = document.createElement('div');
    sec.className = 'nav-section';
    sec.innerHTML = `<div class="nav-section-title">${secao}</div>`;

    itensFiltrados.forEach(({ label, icon, href, badge }) => {
      const ativo = paginaAtual === href ? 'active' : '';
      const badgeHtml = badge ? `<span class="nav-badge">${badge}</span>` : '';
      const a = document.createElement('a');
      a.className = `nav-item ${ativo}`;
      a.href = href;
      a.setAttribute('data-label', label);
      a.innerHTML = `
        <div class="nav-icon"><i data-lucide="${icon}"></i></div>
        <span class="nav-label">${label}</span>
        ${badgeHtml}
      `;
      a.addEventListener('click', (e) => {
        // Salva scroll do nav
        const sidebarNav = document.getElementById('sidebarNav');
        if (sidebarNav) sessionStorage.setItem('sidebarScroll', sidebarNav.scrollTop);

        // Recolhe sidebar expandida no mobile ao navegar
        if (window.innerWidth <= 900) {
          document.getElementById('sidebar')?.classList.remove('expanded');
          document.getElementById('sidebarBackdrop')?.classList.remove('open');
        }

        // Não anima se já está na página ativa
        if (a.classList.contains('active')) return;

        e.preventDefault();
        const destino = a.href;
        const main = document.querySelector('.main-content');
        main.classList.add('saindo');
        setTimeout(() => { window.location.href = destino; }, 150);
      });
      sec.appendChild(a);
    });

    nav.appendChild(sec);
  });

  lucide.createIcons();

  // Após o browser calcular o layout, restaura scroll do nav e exibe a sidebar
  requestAnimationFrame(() => {
    const sidebarNav = document.getElementById('sidebarNav');
    const scroll = parseInt(sessionStorage.getItem('sidebarScroll') || '0');
    if (sidebarNav) sidebarNav.scrollTop = scroll;
    sidebar.style.visibility = '';
  });
}

function toggleSidebar() {
  const s = document.getElementById('sidebar');
  if (window.innerWidth <= 900) {
    const isExpanding = !s.classList.contains('expanded');
    s.classList.toggle('expanded');
    let bd = document.getElementById('sidebarBackdrop');
    if (!bd) {
      bd = document.createElement('div');
      bd.id = 'sidebarBackdrop';
      bd.className = 'sidebar-backdrop';
      bd.onclick = () => { s.classList.remove('expanded'); bd.classList.remove('open'); };
      document.body.appendChild(bd);
    }
    bd.classList.toggle('open', isExpanding);
  } else {
    s.classList.toggle('collapsed');
  }
}

function menuUsuario() {}

// ── NOTIFICAÇÕES ──
async function carregarNotificacoes() {
  try {
    const token = localStorage.getItem('token');
    const r = await fetch(window.location.origin + '/api/notificacoes', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) return;
    const data = await r.json();
    const badge = document.getElementById('notifBadge');
    if (badge && data.total > 0) {
      badge.textContent = data.total > 9 ? '9+' : data.total;
      badge.style.display = 'flex';
    }
    window._notifData = data;
  } catch(e) {}
}

function toggleNotifDropdown() {
  let drop = document.getElementById('notifDropdown');
  if (drop) { drop.remove(); return; }

  const data  = window._notifData || {};
  const fmt   = v => `R$ ${(v||0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const fmtD  = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
  const etapaLabel = { medicao:'Medição', projeto:'Projeto', aprovacao:'Aprovação', producao:'Produção', entrega:'Entrega', instalacao:'Instalação' };

  const fechar = `document.getElementById('notifDropdown')?.remove()`;

  // Item de pedido com botão WhatsApp opcional
  const itemPedido = (p, cor, subtexto, href) => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--border)">
      <span style="width:6px;height:6px;background:${cor};border-radius:50%;flex-shrink:0;margin-top:2px"></span>
      <a href="${href}?busca=${encodeURIComponent(p.numero)}" onclick="${fechar}" style="flex:1;min-width:0;text-decoration:none;color:var(--text)">
        <div style="font-size:12px;font-weight:600">${p.numero} <span style="font-weight:400;color:var(--text-muted)">— ${p.cliente_nome}</span></div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:1px">${subtexto}</div>
      </a>
      ${p.whatsapp_link ? `<a href="${p.whatsapp_link}" target="_blank" onclick="${fechar}" title="Enviar WhatsApp" style="flex-shrink:0;width:28px;height:28px;background:#22c55e;border-radius:6px;display:flex;align-items:center;justify-content:center;text-decoration:none">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
      </a>` : ''}
    </div>`;

  const secao = (label, cor) => `<div style="padding:8px 14px 4px;font-size:10px;font-weight:700;color:${cor};text-transform:uppercase;letter-spacing:.5px">${label}</div>`;

  let html = `<div style="font-weight:700;font-size:13px;padding:12px 14px 8px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
    <span>Notificações</span>
    ${data.total > 0 ? `<span style="font-size:11px;font-weight:600;color:var(--text-muted)">${data.total} alerta${data.total>1?'s':''}</span>` : ''}
  </div>`;

  if (!data.total) {
    html += `<div style="padding:24px;text-align:center;color:var(--text-dim);font-size:13px">✅ Tudo em dia</div>`;
  }

  if (data.entrega_amanha?.length) {
    html += secao(`🔔 Entrega amanhã (${data.entrega_amanha.length})`, '#f59e0b');
    data.entrega_amanha.forEach(p => html += itemPedido(p, '#f59e0b', `Previsto para ${fmtD(p.data_prevista_entrega)}`, 'comercial.html'));
  }

  if (data.pedidos_atrasados?.length) {
    html += secao(`🔴 Atrasados (${data.pedidos_atrasados.length})`, '#ef4444');
    data.pedidos_atrasados.forEach(p => html += itemPedido(p, '#ef4444', `Vencia em ${fmtD(p.data_prevista_entrega)}`, 'comercial.html'));
  }

  if (data.entrega_semana?.length) {
    html += secao(`📅 Essa semana (${data.entrega_semana.length})`, '#60a5fa');
    data.entrega_semana.forEach(p => html += itemPedido(p, '#60a5fa', `Previsto para ${fmtD(p.data_prevista_entrega)}`, 'comercial.html'));
  }

  if (data.kanban_estagnados?.length) {
    html += secao(`🟣 Produção parada`, '#a78bfa');
    data.kanban_estagnados.forEach(p => {
      html += `<a href="kanban.html" onclick="${fechar}" style="display:flex;align-items:center;gap:8px;padding:8px 14px;text-decoration:none;color:var(--text);border-bottom:1px solid var(--border);font-size:12px">
        <span style="width:6px;height:6px;background:#a78bfa;border-radius:50%;flex-shrink:0"></span>
        <span style="flex:1"><strong>${p.numero}</strong> — ${p.cliente_nome}<br><span style="color:var(--text-dim);font-size:11px">${etapaLabel[p.etapa_producao]||p.etapa_producao} há <strong>${p.dias_na_etapa} dias</strong></span></span>
      </a>`;
    });
  }

  if (data.cobrancas_vencidas?.length) {
    html += secao(`💰 Cobranças vencidas (${data.cobrancas_vencidas.length})`, '#f59e0b');
    data.cobrancas_vencidas.forEach(c => {
      const titulo = c.cliente_nome ? `${c.cliente_nome} não pagou` : c.descricao;
      const sub = [c.pedido_numero, fmt(c.valor), `venceu ${fmtD(c.data_vencimento)}`].filter(Boolean).join(' · ');
      const href = c.pedido_numero ? `comercial.html?busca=${encodeURIComponent(c.pedido_numero)}` : 'financeiro.html';
      html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--border)">
        <span style="width:6px;height:6px;background:#f59e0b;border-radius:50%;flex-shrink:0;margin-top:2px"></span>
        <a href="${href}" onclick="${fechar}" style="flex:1;min-width:0;text-decoration:none;color:var(--text)">
          <div style="font-size:12px;font-weight:600">⚠️ ${titulo}</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:1px">${sub}</div>
        </a>
        ${c.whatsapp_link ? `<a href="${c.whatsapp_link}" target="_blank" onclick="${fechar}" title="Cobrar via WhatsApp" style="flex-shrink:0;width:28px;height:28px;background:#22c55e;border-radius:6px;display:flex;align-items:center;justify-content:center;text-decoration:none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
        </a>` : ''}
      </div>`;
    });
  }

  if (data.estoque_baixo?.length) {
    html += secao(`📦 Estoque baixo (${data.estoque_baixo.length})`, '#C4A24A');
    data.estoque_baixo.forEach(e => {
      html += `<a href="estoque.html" onclick="${fechar}" style="display:flex;align-items:center;gap:8px;padding:8px 14px;text-decoration:none;color:var(--text);border-bottom:1px solid var(--border);font-size:12px">
        <span style="width:6px;height:6px;background:#C4A24A;border-radius:50%;flex-shrink:0"></span>
        <span>${e.nome}<br><span style="color:var(--text-dim);font-size:11px">Atual: ${e.estoque_atual} / Mínimo: ${e.estoque_minimo}</span></span>
      </a>`;
    });
  }

  // Rodapé "visto agora"
  const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  html += `<div style="padding:8px 14px;font-size:11px;color:var(--text-dim);text-align:center;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:center;gap:5px">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>
    Visualizado às ${agora}
  </div>`;

  drop = document.createElement('div');
  drop.id = 'notifDropdown';
  drop.style.cssText = `position:fixed;top:52px;right:8px;width:320px;max-height:460px;overflow-y:auto;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);z-index:9000`;
  drop.innerHTML = html;
  document.body.appendChild(drop);

  // Remove o badge ao abrir — marca como visto
  const badge = document.getElementById('notifBadge');
  if (badge) badge.style.display = 'none';

  setTimeout(() => document.addEventListener('click', function h(e) {
    if (!drop.contains(e.target) && e.target.id !== 'btnNotif') { drop.remove(); document.removeEventListener('click', h); }
  }), 0);
}

// ── SVGs de tema e topbar ──
const SVG_SUN      = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const SVG_MOON     = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
const SVG_SETTINGS = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;

function toggleTheme() {
  const html = document.documentElement;
  html.classList.add('tema-trocando');
  const isLight = html.classList.toggle('light');
  localStorage.setItem('tema', isLight ? 'light' : 'dark');
  const btn = document.getElementById('btnTema');
  if (btn) btn.innerHTML = isLight ? SVG_MOON : SVG_SUN;
  setTimeout(() => html.classList.remove('tema-trocando'), 300);
}

document.addEventListener('DOMContentLoaded', async () => {
  await carregarPermissoes();
  buildSidebar();

  // SVGs inline — não dependem do Lucide, funcionam sempre
  const SVG_MENU = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>`;
  const SVG_X    = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  const SVG_BELL = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;

  document.querySelectorAll('.btn-collapse').forEach(el => { el.innerHTML = SVG_MENU; });
  document.querySelectorAll('.modal-close').forEach(el => { el.innerHTML = SVG_X; });

  // layout.js assume controle total do topbar-right
  const topbarRight = document.querySelector('.topbar-right');
  if (topbarRight) {
    const isLight = document.documentElement.classList.contains('light');
    const SVG_BELL_IC = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;
    topbarRight.innerHTML = `
      <div id="btnTema" class="topbar-btn" title="Alternar tema" style="cursor:pointer">${isLight ? SVG_MOON : SVG_SUN}</div>
      <div id="btnNotif" class="topbar-btn" title="Notificações" style="cursor:pointer;position:relative">
        ${SVG_BELL_IC}
        <span id="notifBadge" style="display:none;position:absolute;top:2px;right:2px;width:16px;height:16px;background:#ef4444;border-radius:50%;font-size:9px;font-weight:700;color:#fff;display:none;align-items:center;justify-content:center;line-height:1"></span>
      </div>
      <a href="configuracoes.html" class="topbar-btn" title="Configurações" style="text-decoration:none">${SVG_SETTINGS}</a>
    `;
    document.getElementById('btnTema').addEventListener('click', toggleTheme);
    document.getElementById('btnNotif').addEventListener('click', toggleNotifDropdown);
    carregarNotificacoes();
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Carrega logo da empresa na sidebar
  fetch(window.location.origin + '/api/admin/configuracoes-loja', {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  }).then(r => r.ok ? r.json() : null).then(cfg => {
    if (!cfg?.logo_path) return;
    const el = document.getElementById('sidebarLogoIcon');
    if (el) {
      el.style.background = 'none';
      el.style.boxShadow = 'none';
      el.style.padding = '0';
      const logoSrc = cfg.logo_path.startsWith('http') ? cfg.logo_path : `${window.location.origin}/${cfg.logo_path}`;
      el.innerHTML = `<img src="${logoSrc}" style="width:36px;height:36px;object-fit:contain;border-radius:8px;" alt="Logo">`;
    }
  }).catch(() => {});

  // ── Pré-busca via URL (?busca=PED-xxx) ──
  const buscaParam = new URLSearchParams(window.location.search).get('busca');
  if (buscaParam) {
    const tentarBusca = () => {
      const campo = document.getElementById('campoBusca');
      if (campo) {
        campo.value = buscaParam;
        campo.dispatchEvent(new Event('input', { bubbles: true }));
        campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
        campo.focus();
        // Destaca o campo brevemente
        campo.style.transition = 'box-shadow 0.3s';
        campo.style.boxShadow = '0 0 0 3px rgba(196,162,74,0.5)';
        setTimeout(() => { campo.style.boxShadow = ''; }, 1800);
      } else {
        setTimeout(tentarBusca, 300);
      }
    };
    setTimeout(tentarBusca, 400);
  }

  // ── Chatbot widget ──
  const chatScript = document.createElement('script');
  chatScript.src = '/assets/js/chatbot.js';
  document.body.appendChild(chatScript);
});
