// Panneau du staff : crédit/débit de jetons, statistiques, réglage des jeux, journal.
// Tout est vérifié côté serveur : cette page n'est qu'une interface.
import { getClient, h, fmt, fmtDate, errMsg, rpc, toast, loadProfile, logout } from './core.js';

const app = document.getElementById('app');
// En-têtes de tableau ; les colonnes numériques (classe) sont alignées comme leurs chiffres
const heads = (labels, cls = {}) => h('thead', {}, h('tr', {}, labels.map((x, i) => h('th', { class: cls[i] || null }, x))));
let sb;
let me;

function shell(tab, content) {
  const t = (key, label) => h('button', { class: 'tab' + (tab === key ? ' active' : ''), onClick: () => show(key) }, label);
  return h('main', { class: 'page' },
    h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '/' }, h('span', { class: 'brand-kanji', 'aria-hidden': 'true' }, '賭'), h('span', {}, 'Administration', h('small', {}, 'Casino BFR'))),
      h('div', { class: 'user' }, h('span', { class: 'uname' }, me.display_name),
        h('a', { class: 'btn small ghost', href: '/' }, 'Retour au casino'),
        h('button', { class: 'btn small ghost', onClick: () => logout(sb) }, 'Quitter'))),
    h('div', { class: 'tabs' }, t('players', 'Joueurs'), t('stats', 'Statistiques'), t('games', 'Jeux'), t('log', 'Journal')),
    content);
}

async function show(tab) {
  try {
    const content = await ({ players: playersTab, stats: statsTab, games: gamesTab, log: logTab }[tab])();
    app.replaceChildren(shell(tab, content));
  } catch (e) {
    console.error(e);
    toast(errMsg(e), 'error');
  }
}

// ----- Joueurs ---------------------------------------------------------------

async function playersTab(search = '') {
  const players = await rpc(sb, 'admin_list_players', { p_search: search || null });
  const q = h('input', { type: 'search', class: 'search', placeholder: 'Rechercher un pseudo ou un SteamID64…', value: search, 'aria-label': 'Recherche' });
  const form = h('form', { class: 'row', onSubmit: async (e) => {
    e.preventDefault();
    app.replaceChildren(shell('players', await playersTab(q.value.trim())));
  } }, q, h('button', { class: 'btn' }, 'Chercher'));

  const rows = players.map((p) => {
    const amount = h('input', { type: 'number', step: 1, placeholder: '+/- jetons', 'aria-label': 'Montant pour ' + p.display_name, class: 'amount' });
    const note = h('input', { type: 'text', maxlength: 120, placeholder: 'Motif (optionnel)', 'aria-label': 'Motif', class: 'note' });
    const apply = async (sign) => {
      const raw = Math.floor(Math.abs(Number(amount.value)));
      if (!raw) return toast('Entre un montant.', 'error');
      try {
        const r = await rpc(sb, 'admin_adjust_balance', { p_steam_id: p.steam_id, p_amount: sign * raw, p_note: note.value.trim() || null });
        toast(`${r.display_name} : nouveau solde ${fmt(r.balance)}`, 'success');
        app.replaceChildren(shell('players', await playersTab(q.value.trim())));
      } catch (e) {
        toast(String(e.message || '').includes('insufficient_funds') ? "Le joueur n'a pas assez de jetons." : errMsg(e), 'error');
      }
    };
    return h('tr', {},
      h('td', {}, h('div', { class: 'who' }, p.avatar_url ? h('img', { class: 'avatar', src: p.avatar_url, alt: '', width: 32, height: 32 }) : null,
        h('div', {}, h('b', {}, p.display_name, p.is_admin ? h('span', { class: 'chip gold' }, 'staff') : null), h('small', { class: 'muted block' }, p.steam_id)))),
      h('td', { class: 'ctr' }, h('b', {}, fmt(p.balance))),
      h('td', {}, h('div', { class: 'row' }, amount, note,
        h('button', { class: 'btn small primary', onClick: () => apply(1) }, 'Donner'),
        h('button', { class: 'btn small danger', onClick: () => apply(-1) }, 'Retirer'))),
      h('td', {}, fmtDate(p.last_login)));
  });
  return h('section', {}, form,
    players.length ? h('div', { class: 'tablewrap' }, h('table', {},
      heads(['Joueur', 'Solde', 'Ajuster', 'Dernière visite'], { 1: 'ctr' }), h('tbody', {}, rows)))
      : h('p', { class: 'muted' }, 'Aucun joueur. Un joueur apparaît ici après sa première connexion Steam.'));
}

// ----- Statistiques ----------------------------------------------------------

async function statsTab() {
  const s = await rpc(sb, 'admin_stats');
  const tot = s.games.reduce((a, g) => ({ w: a.w + Number(g.wagered), p: a.p + Number(g.paid), r: a.r + Number(g.rounds) }), { w: 0, p: 0, r: 0 });
  const card = (label, value) => h('div', { class: 'stat' }, h('small', {}, label), h('b', {}, value));
  return h('section', {},
    h('div', { class: 'stats' }, card('Joueurs inscrits', fmt(s.players)), card('Jetons en circulation', fmt(s.tokens_in_circulation)),
      card('Manches jouées', fmt(tot.r)), card('Total misé', fmt(tot.w)),
      card('Bénéfice de la banque', fmt(tot.w - tot.p)), card('Taux de retour global', tot.w ? (tot.p / tot.w * 100).toFixed(1) + ' %' : '—')),
    h('div', { class: 'tablewrap' }, h('table', {},
      heads(['Jeu', 'Manches', 'Misé', 'Versé', 'Bénéfice banque', 'Retour'], { 1: 'num', 2: 'num', 3: 'num', 4: 'num', 5: 'num' }),
      h('tbody', {}, s.games.map((g) => h('tr', {}, h('td', {}, g.label), h('td', { class: 'num' }, fmt(g.rounds)), h('td', { class: 'num' }, fmt(g.wagered)),
        h('td', { class: 'num' }, fmt(g.paid)),
        h('td', { class: 'num ' + (g.house_profit >= 0 ? 'pos' : 'neg') }, fmt(g.house_profit)),
        h('td', { class: 'num' }, Number(g.wagered) ? (Number(g.paid) / Number(g.wagered) * 100).toFixed(1) + ' %' : '—')))))),
    h('p', { class: 'muted' }, 'Le « retour » est la part des mises rendue aux joueurs. Il doit rester sous 100 % à long terme (les jeux sont réglés entre 90 % et 98 %).'));
}

// ----- Jeux ------------------------------------------------------------------

async function gamesTab() {
  const { data, error } = await sb.from('game_config').select('*').order('sort');
  if (error) throw error;
  const rows = data.map((c) => {
    const min = h('input', { type: 'number', min: 1, value: c.min_bet, class: 'amount', 'aria-label': 'Mise minimale ' + c.label });
    const max = h('input', { type: 'number', min: 1, value: c.max_bet, class: 'amount', 'aria-label': 'Mise maximale ' + c.label });
    const on = h('input', { type: 'checkbox', 'aria-label': 'Ouvert : ' + c.label });
    on.checked = c.enabled;
    const save = async () => {
      try {
        await rpc(sb, 'admin_set_game_config', { p_game: c.game, p_min: Math.floor(Number(min.value)), p_max: Math.floor(Number(max.value)), p_enabled: on.checked });
        toast(c.label + ' : réglages enregistrés', 'success');
      } catch (e) { toast(errMsg(e), 'error'); }
    };
    return h('tr', {}, h('td', {}, h('b', {}, c.label)), h('td', {}, min), h('td', {}, max),
      h('td', {}, h('label', { class: 'switch' }, on, ' Ouvert')), h('td', {}, h('button', { class: 'btn small primary', onClick: save }, 'Enregistrer')));
  });
  return h('section', {}, h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Jeu', 'Mise min', 'Mise max', 'État', ''].map((x) => h('th', {}, x)))), h('tbody', {}, rows))));
}

// ----- Journal ---------------------------------------------------------------

async function logTab() {
  const list = await rpc(sb, 'admin_recent_transactions', { p_limit: 200 });
  const kind = (t) => t.kind === 'game' ? t.game : t.kind === 'admin_credit' ? 'don du staff' : 'retrait du staff';
  return h('section', {}, h('div', { class: 'tablewrap' }, h('table', {},
    heads(['Date', 'Joueur', 'Opération', 'Mise', 'Résultat', 'Solde'], { 3: 'num', 4: 'num', 5: 'num' }),
    h('tbody', {}, list.map((t) => h('tr', {}, h('td', {}, fmtDate(t.created_at)),
      h('td', {}, t.display_name, h('small', { class: 'muted block' }, t.steam_id)),
      h('td', {}, kind(t), t.note ? h('small', { class: 'muted block' }, t.note) : null),
      h('td', { class: 'num' }, t.kind === 'game' ? fmt(t.bet) : '—'),
      h('td', { class: 'num ' + (t.amount > 0 ? 'pos' : t.amount < 0 ? 'neg' : '') }, (t.amount > 0 ? '+' : '') + fmt(t.amount)),
      h('td', { class: 'num' }, fmt(t.balance_after))))))));
}

(async () => {
  try {
    sb = await getClient();
    me = await loadProfile(sb);
    if (!me) { location.replace('/'); return; }
    if (!me.is_admin) {
      app.replaceChildren(h('main', { class: 'login' }, h('div', { class: 'login-card' },
        h('h1', {}, 'Accès refusé'), h('p', { class: 'muted' }, 'Cette page est réservée au staff de la brigade Finance Relation.'),
        h('a', { class: 'btn', href: '/' }, 'Retour au casino'))));
      return;
    }
    await show('players');
  } catch (e) {
    console.error(e);
    app.replaceChildren(h('main', { class: 'login' }, h('div', { class: 'login-card' }, h('p', { class: 'alert' }, e.message || errMsg(e)))));
  }
})();
