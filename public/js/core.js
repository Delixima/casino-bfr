// Fonctions communes : client Supabase, construction du DOM (sans innerHTML), messages d'erreur.

let clientPromise = null;

export function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      if (!window.supabase) throw new Error('Bibliothèque Supabase introuvable (public/vendor/supabase.js). Lance "npm run build".');
      const res = await fetch('/.netlify/functions/config');
      const cfg = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(cfg.error || 'Configuration du site indisponible.');
      return window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
    })();
  }
  return clientPromise;
}

// h('div', { class: 'x', onClick: fn }, enfants...) : création de DOM sûre (textContent uniquement)
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// Icônes au trait (SVG statiques, aucune donnée utilisateur)
const ICONS = {
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
};
export function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ico" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return t.content.firstChild;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function fmtMult(m) {
  return '×' + String(m).replace('.', ',');
}

export function fmtDate(iso) {
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const ERRORS = {
  not_authenticated: 'Connecte-toi avec Steam pour jouer.',
  insufficient_funds: "Tu n'as pas assez de jetons.",
  invalid_bet: 'Mise invalide : respecte les limites du jeu.',
  game_disabled: 'Ce jeu est fermé pour le moment.',
  invalid_choice: 'Choix invalide.',
  invalid_action: 'Action invalide.',
  unknown_game: 'Jeu inconnu.',
  game_in_progress: 'Une partie est déjà en cours.',
  no_active_game: "Aucune partie en cours.",
  cannot_double: 'Doubler est possible uniquement avec les deux premières cartes.',
  nothing_to_cash: "Réussis au moins une étape avant d'encaisser.",
  forbidden: 'Accès réservé au staff.',
  player_not_found: "Joueur introuvable (il doit s'être connecté au moins une fois).",
  invalid_amount: 'Montant invalide.',
  no_profile: 'Profil introuvable : reconnecte-toi.',
};

export function errMsg(e) {
  const raw = (e && (e.message || e.details)) || String(e);
  for (const k of Object.keys(ERRORS)) if (raw.includes(k)) return ERRORS[k];
  if (/jwt|token|session/i.test(raw)) return 'Session expirée : reconnecte-toi.';
  if (/fetch|network/i.test(raw)) return 'Connexion impossible, réessaie.';
  return 'Une erreur est survenue.';
}

export async function rpc(sb, name, args) {
  const { data, error } = await sb.rpc(name, args || {});
  if (error) throw error;
  return data;
}

let toastBox;
export function toast(message, type = 'info') {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastBox);
  }
  const t = h('div', { class: 'toast ' + type }, message);
  toastBox.append(t);
  setTimeout(() => t.classList.add('out'), 3800);
  setTimeout(() => t.remove(), 4300);
}

export async function loadProfile(sb) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function logout(sb) {
  await sb.auth.signOut();
  location.href = '/';
}

// Fenêtre modale accessible : Échap, clic à côté, bouton Fermer, focus piégé et rendu.
export function openModal(title, body) {
  const previous = document.activeElement;
  let backdrop;
  const close = () => {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', close);
    document.body.classList.remove('modal-open');
    backdrop.remove();
    if (previous && previous.focus) previous.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const closeBtn = h('button', { class: 'modal-close', type: 'button', 'aria-label': 'Fermer', onClick: close }, '×');
  const dialog = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' },
    h('div', { class: 'modal-head' }, h('h3', { id: 'modal-title' }, title), closeBtn),
    h('div', { class: 'modal-body' }, body),
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn primary', type: 'button', onClick: close }, "J'ai compris")));
  backdrop = h('div', { class: 'modal-backdrop', onClick: (e) => { if (e.target === backdrop) close(); } }, dialog);
  document.body.append(backdrop);
  document.body.classList.add('modal-open');
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', close);
  closeBtn.focus();
  return close;
}
