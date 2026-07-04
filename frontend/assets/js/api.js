const API_BASE = window.location.origin + '/api';

function getToken() {
  return localStorage.getItem('token');
}

function getUsuario() {
  try { return JSON.parse(localStorage.getItem('usuario')); } catch { return null; }
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
  sessionStorage.removeItem('permissoes');
  window.location.href = '/index.html';
}

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(API_BASE + path, opts);

  if (res.status === 401) { logout(); return; }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro || 'Erro na requisição');
  return data;
}

const Api = {
  get:    (path)        => api('GET',    path),
  post:   (path, body)  => api('POST',   path, body),
  put:    (path, body)  => api('PUT',    path, body),
  patch:  (path, body)  => api('PATCH',  path, body),
  delete: (path)        => api('DELETE', path),
};

// Toast notifications
function toast(msg, tipo = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  const icons = { success: 'check-circle', error: 'x-circle', info: 'info', warning: 'alert-triangle' };
  t.className = `toast toast-${tipo}`;
  t.innerHTML = `<i data-lucide="${icons[tipo] || 'info'}"></i><span>${msg}</span>`;
  c.appendChild(t);
  lucide.createIcons({ nodes: [t] });
  setTimeout(() => t.remove(), 4000);
}

// Sanitiza string para uso seguro em innerHTML — previne XSS
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Formatar moeda
function moeda(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
}

// Formatar data
function formatarData(str) {
  if (!str) return '—';
  const d = new Date(str);
  return d.toLocaleDateString('pt-BR');
}

// Verificar auth na carga da página
function checkAuth() {
  if (!getToken()) {
    window.location.href = '/index.html';
    return false;
  }
  return true;
}

// Verifica se o usuário tem ao menos o nível informado no módulo
function temPermissao(modulo, nivel = 'leitura') {
  const eu = getUsuario();
  if (eu?.perfil === 'gestor') return true;
  const p = JSON.parse(sessionStorage.getItem('permissoes') || '{}');
  const niveis = ['sem_acesso', 'leitura', 'edicao', 'total'];
  const meuNivel = p[modulo] || 'sem_acesso';
  return niveis.indexOf(meuNivel) >= niveis.indexOf(nivel);
}

// Redireciona para dashboard se o usuário não tiver acesso de leitura ao módulo
function verificarAcesso(modulo) {
  if (!temPermissao(modulo, 'leitura')) {
    window.location.href = 'dashboard.html';
  }
}

// ── Telefone ──
function mascaraTelefone(el) {
  const d = el.value.replace(/\D/g, '').slice(0, 11);
  const n = d.length;
  let v = d;
  if (n > 2) v = '(' + v.slice(0,2) + ') ' + v.slice(2);
  if (n > 10) v = v.slice(0,10) + '-' + v.slice(10);   // 11 dígitos: (00) 00000-0000
  else if (n > 6) v = v.slice(0,9) + '-' + v.slice(9); // 7-10 dígitos: (00) 0000-XXXX
  el.value = v;
}

// ── Validadores ──
function _dig(v) { return (v || '').replace(/\D/g, ''); }

function marcarErro(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('campo-erro');
  let span = el.parentElement.querySelector('.msg-erro');
  if (!span) { span = document.createElement('span'); span.className = 'msg-erro'; el.parentElement.appendChild(span); }
  span.textContent = msg;
  el.addEventListener('input', function() {
    el.classList.remove('campo-erro');
    span.remove();
  }, { once: true });
}

function limparErros() {
  document.querySelectorAll('.campo-erro').forEach(el => el.classList.remove('campo-erro'));
  document.querySelectorAll('.msg-erro').forEach(el => el.remove());
}

function validarDocumento(id) {
  const val = document.getElementById(id)?.value || '';
  if (!val) return true;
  const d = _dig(val);
  if (d.length !== 11 && d.length !== 14) {
    marcarErro(id, d.length < 11 ? 'CPF incompleto — faltam ' + (11 - d.length) + ' dígitos'
                                  : 'CNPJ incompleto — faltam ' + (14 - d.length) + ' dígitos');
    return false;
  }
  return true;
}

function validarTelefone(id, label) {
  const val = document.getElementById(id)?.value || '';
  if (!val) return true;
  const d = _dig(val);
  if (d.length < 10 || d.length > 11) {
    marcarErro(id, `${label || 'Telefone'} incompleto — mínimo 10 dígitos`);
    return false;
  }
  return true;
}

function validarDataNascimento(id) {
  const val = document.getElementById(id)?.value || '';
  if (!val) return true;
  const d = new Date(val);
  const hoje = new Date();
  if (isNaN(d)) { marcarErro(id, 'Data inválida'); return false; }
  if (d > hoje)  { marcarErro(id, 'Data não pode ser no futuro'); return false; }
  const idade = hoje.getFullYear() - d.getFullYear() - (hoje < new Date(hoje.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0);
  if (idade > 120) { marcarErro(id, 'Data de nascimento inválida'); return false; }
  return true;
}

function validarEmail(id) {
  const val = document.getElementById(id)?.value || '';
  if (!val) return true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
    marcarErro(id, 'E-mail inválido');
    return false;
  }
  return true;
}

function validarCep(id) {
  const val = document.getElementById(id)?.value || '';
  if (!val) return true;
  const d = _dig(val);
  if (d.length !== 8) {
    marcarErro(id, 'CEP incompleto — faltam ' + (8 - d.length) + ' dígitos');
    return false;
  }
  return true;
}

// ── CPF / CNPJ ──
function mascaraCpfCnpj(el) {
  const d = el.value.replace(/\D/g, '').slice(0, 14);
  const n = d.length;
  let v = d;
  if (n <= 11) {
    if (n > 3) v = v.slice(0,3) + '.' + v.slice(3);
    if (n > 6) v = v.slice(0,7) + '.' + v.slice(7);
    if (n > 9) v = v.slice(0,11) + '-' + v.slice(11);
  } else {
    v = v.slice(0,2) + '.' + v.slice(2);
    v = v.slice(0,6) + '.' + v.slice(6);
    v = v.slice(0,10) + '/' + v.slice(10);
    if (n > 12) v = v.slice(0,15) + '-' + v.slice(15);
  }
  el.value = v;
}

// ── CEP (ViaCEP) ──
async function buscarCep(el, campos) {
  // Aceita elemento DOM ou string de valor
  const input = (el && el.tagName) ? el : null;
  const raw = input ? input.value : String(el);

  // Aplica máscara 00000-000
  if (input) {
    let v = raw.replace(/\D/g, '').slice(0, 8);
    if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
    input.value = v;
  }

  const cep = raw.replace(/\D/g, '');
  if (cep.length !== 8) {
    if (input) input.style.borderColor = '';
    return;
  }

  const c = Object.assign({ rua: 'fRua', bairro: 'fBairro', cidade: 'fCidade', estado: 'fEstado', numero: 'fNumero' }, campos || {});
  const set = (id, val) => { const e = document.getElementById(id); if (e) e.value = val; };

  if (input) input.style.borderColor = 'var(--warning)';

  try {
    const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const d = await resp.json();

    if (d.erro) {
      if (input) input.style.borderColor = 'var(--danger)';
      toast('CEP não encontrado', 'error');
      return;
    }

    set(c.rua,    d.logradouro || '');
    set(c.bairro, d.bairro     || '');
    set(c.cidade, d.localidade || '');
    set(c.estado, d.uf         || '');

    if (input) {
      input.style.borderColor = 'var(--success)';
      setTimeout(() => { input.style.borderColor = ''; }, 2000);
    }

    const numEl = document.getElementById(c.numero);
    if (numEl) numEl.focus();

  } catch(e) {
    if (input) input.style.borderColor = 'var(--danger)';
    toast('Erro ao buscar CEP', 'error');
  }
}

// Garante que ícones Lucide do HTML estático sejam inicializados mesmo com CDN lento
window.addEventListener('load', function() {
  if (typeof lucide !== 'undefined') lucide.createIcons();
});

// Garante o X no botão fechar toda vez que um modal abre
const _SVG_X = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.modal-overlay').forEach(function(modal) {
    new MutationObserver(function() {
      if (modal.classList.contains('open')) {
        modal.querySelectorAll('.modal-close').forEach(function(btn) {
          btn.innerHTML = _SVG_X;
        });
      }
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  });
});
