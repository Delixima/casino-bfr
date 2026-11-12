import { getClient, h, fmt, fmtDate, errMsg, rpc, toast, loadProfile, logout, openModal } from './core.js';
import { GAMES, GAME_BY_ID, rulesEl } from './games.js';
import { stepsEl, helpEl } from './help.js';

const app = document.getElementById('app');
const state = { sb: null, profile: null, config: {}, balance: 0, minBet: 0 };
const remembered = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const remember = (k) => { try { localStorage.setItem(k, '1'); } catch { /* ignoré */ } };
let balanceEl;

// ---------------------------------------------------------------------------
// Écrans
// ---------------------------------------------------------------------------

function loginScreen(error) {
  const messages = {
    steam: 'La connexion Steam a échoué. Réessaie.',
    server: 'Erreur du serveur pendant la connexion. Réessaie dans un instant.',
    config: 'Le site n\'est pas encore configuré (clés manquantes).',
    session: 'Ta session a expiré. Reconnecte-toi.',
  };
  app.replaceChildren(h('main', { class: 'login' },
    h('div', { class: 'login-card' },
      h('div', { class: 'kanji-big', 'aria-hidden': 'true' }, '賭'),
      h('h1', {}, 'Casino de la Brigade Finance Relation'),
      h('p', { class: 'muted' }, 'Jetons fictifs pour le jeu de rôle. Aucun argent réel.'),
      stepsEl(),
      error && messages[error] ? h('p', { class: 'alert' }, messages[error]) : null,
      h('a', { class: 'btn steam big', href: '/.netlify/functions/steam-login' }, 'Se connecter avec Steam'),
      h('p', { class: 'tiny muted' }, 'Tes jetons sont liés à ton compte Steam : tu les retrouves sur tous tes appareils.'))));
}

function header(active) {
  const p = state.profile;
  balanceEl = h('span', { class: 'balance-amount' }, fmt(state.balance));
  const link = (href, label, key) => h('a', { href, class: active === key ? 'active' : '' }, label);
  return h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-kanji', 'aria-hidden': 'true' }, '賭'),
      h('span', {}, 'Casino BFR', h('small', {}, 'Finance Relation'))),
    h('nav', {}, link('#/', 'Jeux', 'lobby'), link('#/history', 'Historique', 'history'), link('#/leaderboard', 'Classement', 'board'),
      p.is_admin ? h('a', { href: '/admin.html' }, 'Admin') : null,
      h('button', { class: 'helpbtn', type: 'button', onClick: () => openModal('Aide : comment ça marche ?', helpEl()) }, '? Aide')),
    h('div', { class: 'user' },
      h('div', { class: 'balance', title: 'Tes jetons' }, h('span', { class: 'coin', 'aria-hidden': 'true' }, '◎'), balanceEl, h('small', {}, 'jetons')),
      p.avatar_url ? h('img', { class: 'avatar', src: p.avatar_url, alt: '', width: 36, height: 36 }) : null,
      h('span', { class: 'uname', title: p.display_name }, p.display_name),
      h('button', { class: 'btn small ghost', onClick: () => logout(state.sb) }, 'Quitter')));
}

function setBalance(n) {
  const from = state.balance;
  state.balance = Number(n);
  if (!balanceEl) return;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 600);
    balanceEl.textContent = fmt(Math.round(from + (state.balance - from) * k));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  document.querySelectorAll('.bet-balance').forEach((el) => { el.textContent = fmt(state.balance); });
  document.querySelectorAll('.lowfunds').forEach((el) => { el.hidden = state.balance >= state.minBet || Boolean(document.querySelector('.betbox.locked')); });
  // Filet de sécurité : si l'onglet est en arrière-plan, requestAnimationFrame est suspendu
  const target = state.balance;
  setTimeout(() => { if (state.balance === target) balanceEl.textContent = fmt(target); }, 700);
  balanceEl.classList.remove('flash-up', 'flash-down');
  void balanceEl.offsetWidth;
  if (state.balance !== from) balanceEl.classList.add(state.balance > from ? 'flash-up' : 'flash-down');
}

async function refreshBalance() {
  const p = await loadProfile(state.sb);
  if (p) { state.profile = p; setBalance(p.balance); }
}

async function loadConfig() {
  const { data, error } = await state.sb.from('game_config').select('*');
  if (error) throw error;
  state.config = Object.fromEntries(data.map((c) => [c.game, c]));
}

// ---------------------------------------------------------------------------
// Accueil
// ---------------------------------------------------------------------------

function lobby() {
  state.minBet = 0;
  const empty = state.balance <= 0
    ? h('div', { class: 'notice' }, h('b', {}, 'Tu as 0 jeton. '), 'Pour jouer, demande des jetons au staff de la brigade Finance Relation (en RP) : ils les ajoutent à ton compte et ils apparaissent ici tout de suite.')
    : null;
  const welcome = remembered('welcome_closed') ? null : h('section', { class: 'welcome' },
    h('button', { class: 'btn small ghost close', type: 'button', onClick: (e) => { remember('welcome_closed'); e.currentTarget.closest('.welcome').remove(); } }, 'Fermer ✕'),
    h('h2', {}, 'Bienvenue au casino de la brigade Finance Relation 👋'),
    stepsEl(),
    h('p', { class: 'tiny muted' }, "Jetons fictifs, aucun argent réel. Besoin d'aide ? Le bouton « ? Aide » est en haut de la page."));
  return h('main', { class: 'page' }, header('lobby'), welcome, empty,
    h('div', { class: 'cards' }, GAMES.map((g) => {
      const c = state.config[g.id];
      const closed = c && !c.enabled;
      return h('a', { class: 'game-card' + (closed ? ' closed' : ''), href: closed ? null : '#/game/' + g.id },
        h('div', { class: 'gk', 'aria-hidden': 'true' }, g.kanji),
        h('h3', {}, g.name),
        h('div', { class: 'theme' }, g.theme),
        h('p', {}, g.tagline),
        h('div', { class: 'meta' },
          h('span', { class: 'chip kind' }, g.kind),
          h('span', { class: 'chip gold' }, 'jusqu\'à ' + g.top),
          c ? h('span', { class: 'chip' }, `${fmt(c.min_bet)} – ${fmt(c.max_bet)}`) : null,
          closed ? h('span', { class: 'chip red' }, 'Fermé') : null));
    })));
}

// ---------------------------------------------------------------------------
// Page d'un jeu
// ---------------------------------------------------------------------------

function betBox(cfg) {
  const input = h('input', { type: 'number', inputmode: 'numeric', min: cfg.min_bet, max: cfg.max_bet, step: 1, value: cfg.min_bet, 'aria-label': 'Mise en jetons' });
  const clamp = (v) => Math.max(cfg.min_bet, Math.min(cfg.max_bet, Math.floor(v) || cfg.min_bet));
  const set = (v) => { input.value = clamp(v); };
  const chip = (label, fn) => h('button', { type: 'button', class: 'chip-btn', onClick: () => set(fn(Number(input.value) || cfg.min_bet)) }, label);
  const presets = [cfg.min_bet, 100, 500, 1000, 5000].filter((v, i, a) => v >= cfg.min_bet && v <= cfg.max_bet && a.indexOf(v) === i);
  const el = h('div', { class: 'betbox' },
    h('div', { class: 'bet-balance-row' }, h('small', {}, 'Tes jetons'), h('b', { class: 'bet-balance' }, fmt(state.balance))),
    h('label', {}, 'Combien veux-tu miser ?'), input,
    h('div', { class: 'chips' }, presets.map((v) => chip(fmt(v), () => v)),
      chip('½', (v) => v / 2), chip('×2', (v) => v * 2), chip('Max', () => Math.min(cfg.max_bet, state.balance))),
    h('small', { class: 'muted' }, `Mise : ${fmt(cfg.min_bet)} à ${fmt(cfg.max_bet)} jetons`));
  return {
    el,
    value: () => Math.floor(Number(input.value)),
    lock: (b) => { input.disabled = b; el.classList.toggle('locked', b); },
  };
}

function gamePage(id) {
  const g = GAME_BY_ID[id];
  const cfg = state.config[id];
  if (!g || !cfg) return notFound();
  if (!cfg.enabled) return h('main', { class: 'page' }, header('lobby'), h('div', { class: 'notice' }, 'Ce jeu est fermé pour le moment.'), h('a', { class: 'btn', href: '#/' }, 'Retour'));

  state.minBet = cfg.min_bet;
  const bet = betBox(cfg);
  const stage = h('div', { class: 'stage' });
  let busy = false;
  const ctx = {
    id, sb: state.sb, bet,
    checkBet() {
      const v = bet.value();
      if (!Number.isFinite(v) || v < cfg.min_bet || v > cfg.max_bet) throw new Error('invalid_bet');
      if (v > state.balance) throw new Error('insufficient_funds');
      return v;
    },
    instant(choice) {
      return rpc(state.sb, 'play_instant', { p_game: id, p_bet: ctx.checkBet(), p_choice: choice });
    },
    setBalance,
    async guard(fn) {
      if (busy) return;
      busy = true; stage.classList.add('busy');
      try { await fn(); } catch (e) { console.error(e); toast(errMsg(e), 'error'); refreshBalance().catch(() => {}); }
      finally { busy = false; stage.classList.remove('busy'); }
    },
  };
  stage.append(g.mount(ctx));

  const showRules = () => openModal(`Comment jouer : ${g.name}`, rulesEl(g));
  // Première visite de ce jeu : on affiche les règles une fois
  const seenKey = 'rules_seen_' + id;
  try {
    if (!localStorage.getItem(seenKey)) { localStorage.setItem(seenKey, '1'); setTimeout(showRules, 250); }
  } catch { /* stockage indisponible : on n'ouvre rien d'office */ }

  return h('main', { class: 'page' }, header('lobby'),
    h('a', { class: 'back', href: '#/' }, '← Tous les jeux'),
    h('div', { class: 'game-head' },
      h('span', { class: 'gk-title', 'aria-hidden': 'true' }, g.kanji),
      h('div', { class: 'game-titles' }, h('h2', {}, g.name), h('div', { class: 'theme' }, g.theme), h('p', { class: 'muted' }, g.tagline)),
      h('button', { class: 'btn gold', type: 'button', onClick: showRules }, '📖 Comment jouer ?')),
    h('div', { class: 'hint' }, h('span', { class: 'hint-ico', 'aria-hidden': 'true' }, '👉'), h('span', {}, g.hint)),
    h('div', { class: 'game-layout' }, stage,
      h('aside', { class: 'side' },
        h('div', { class: 'lowfunds', hidden: state.balance >= cfg.min_bet }, `Tu n'as pas assez de jetons pour jouer ici (mise minimale : ${fmt(cfg.min_bet)}). Demande des jetons au staff de la brigade.`),
        bet.el,
        h('div', { class: 'rules' }, h('h4', {}, 'Gains et chances'),
          h('ul', { class: 'odds' }, g.help.table.map(([a, b, c]) => h('li', {}, h('span', {}, a), h('small', {}, b + ' · ' + c)))),
          h('button', { class: 'btn small', type: 'button', onClick: showRules }, 'Voir toutes les règles')))));
}

// ---------------------------------------------------------------------------
// Historique et classement
// ---------------------------------------------------------------------------

async function historyPage() {
  const { data, error } = await state.sb.from('transactions').select('*')
    .eq('user_id', state.profile.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
  if (error) throw error;
  const label = (t) => t.kind === 'game' ? (GAME_BY_ID[t.game] ? GAME_BY_ID[t.game].name : t.game)
    : t.kind === 'admin_credit' ? 'Jetons reçus (staff)' : 'Jetons retirés (staff)';
  const rows = data.map((t) => h('tr', {},
    h('td', {}, fmtDate(t.created_at)),
    h('td', {}, label(t), t.note ? h('small', { class: 'muted block' }, t.note) : null),
    h('td', { class: 'num' }, t.kind === 'game' ? fmt(t.bet) : '—'),
    h('td', { class: 'num ' + (t.amount > 0 ? 'pos' : t.amount < 0 ? 'neg' : '') }, (t.amount > 0 ? '+' : '') + fmt(t.amount)),
    h('td', { class: 'num' }, fmt(t.balance_after))));
  return h('main', { class: 'page' }, header('history'), h('h2', {}, 'Ton historique'),
    data.length ? h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Date', 'Opération', 'Mise', 'Résultat', 'Solde'].map((x, i) => h('th', { class: i >= 2 ? 'num' : null }, x)))), h('tbody', {}, rows)))
      : h('p', { class: 'muted' }, 'Aucune opération pour le moment.'));
}

async function leaderboardPage() {
  const list = await rpc(state.sb, 'leaderboard');
  return h('main', { class: 'page' }, header('board'), h('h2', {}, 'Les plus riches de la brigade'),
    list.length ? h('ol', { class: 'board' }, list.map((p, i) => h('li', {},
      h('span', { class: 'rank' }, i + 1),
      p.avatar_url ? h('img', { class: 'avatar', src: p.avatar_url, alt: '', width: 36, height: 36 }) : h('span', { class: 'avatar ph' }),
      h('span', { class: 'bname' }, p.display_name),
      h('b', {}, fmt(p.balance) + ' jetons'))))
      : h('p', { class: 'muted' }, 'Personne n\'a encore de jetons.'));
}

function notFound() {
  return h('main', { class: 'page' }, header('lobby'), h('p', {}, 'Page introuvable.'), h('a', { class: 'btn', href: '#/' }, 'Retour aux jeux'));
}

// ---------------------------------------------------------------------------
// Routeur
// ---------------------------------------------------------------------------

async function route() {
  if (!state.profile) return;
  const path = location.hash.replace(/^#/, '') || '/';
  try {
    await refreshBalance();
    await loadConfig();
    let view;
    if (path === '/' || path === '') view = lobby();
    else if (path.startsWith('/game/')) view = gamePage(path.slice(6));
    else if (path === '/history') view = await historyPage();
    else if (path === '/leaderboard') view = await leaderboardPage();
    else view = notFound();
    app.replaceChildren(view);
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    app.replaceChildren(h('main', { class: 'page' }, h('p', { class: 'alert' }, errMsg(e)), h('button', { class: 'btn', onClick: route }, 'Réessayer')));
  }
}

async function boot() {
  const error = new URLSearchParams(location.search).get('error');
  try {
    state.sb = await getClient();
    const { data: { session } } = await state.sb.auth.getSession();
    if (!session) return loginScreen(error);
    state.profile = await loadProfile(state.sb);
    if (!state.profile) { await state.sb.auth.signOut(); return loginScreen('server'); }
    state.balance = Number(state.profile.balance);
    if (error) history.replaceState(null, '', location.pathname + location.hash);
    window.addEventListener('hashchange', route);
    await route();
  } catch (e) {
    console.error(e);
    app.replaceChildren(h('main', { class: 'login' }, h('div', { class: 'login-card' },
      h('h1', {}, 'Casino BFR'), h('p', { class: 'alert' }, e.message || 'Le site est indisponible.'))));
  }
}

boot();
