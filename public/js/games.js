// Les 10 jeux. Tous les résultats viennent du serveur (Supabase) ; ce fichier ne fait qu'afficher.
import { h, sleep, fmt, fmtMult, pick, rpc } from './core.js';

// ---------------------------------------------------------------------------
// Briques communes
// ---------------------------------------------------------------------------

const SUITS = ['♠', '♥', '♦', '♣'];
const rankLabel = (r) => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[r] || String(r));

function cardEl(rank, i = 0, hidden = false) {
  if (hidden) return h('div', { class: 'card back deal' }, h('span', {}, '鬼'));
  const suit = SUITS[(rank * 3 + i) % 4];
  const red = suit === '♥' || suit === '♦';
  return h('div', { class: 'card deal' + (red ? ' red' : '') },
    h('span', { class: 'rk' }, rankLabel(rank)), h('span', { class: 'st' }, suit));
}

function banner(r, extra) {
  const net = Number(r.payout) - Number(r.bet);
  const title = r.result === 'win' ? `Gagné ! +${fmt(net)} jetons`
    : r.result === 'push' ? 'Mise remboursée'
    : `Perdu −${fmt(r.bet)} jetons`;
  return h('div', { class: 'banner ' + r.result }, h('strong', {}, title), extra ? h('span', {}, extra) : null);
}

function segmented(options, initial, onChange) {
  let val = initial;
  const btns = options.map(([v, label, sub]) => [v, h('button', {
    type: 'button', class: 'seg', 'aria-pressed': String(v === val),
    onClick: () => { val = v; sync(); if (onChange) onChange(v); },
  }, label, sub ? h('small', {}, sub) : null)]);
  const sync = () => btns.forEach(([v, b]) => b.setAttribute('aria-pressed', String(v === val)));
  return {
    el: h('div', { class: 'segmented', role: 'group' }, btns.map((x) => x[1])),
    value: () => val,
    set: (v) => { val = v; sync(); },
  };
}

// Fait défiler des valeurs aléatoires dans un élément puis affiche la valeur finale
async function flicker(el, values, ms, final, every = 70) {
  const end = Date.now() + ms;
  el.classList.add('spinning');
  while (Date.now() < end) { el.textContent = pick(values); await sleep(every); }
  el.classList.remove('spinning');
  el.textContent = final;
}

const play = (ctx, choice) => ctx.instant(choice || {});

// ---------------------------------------------------------------------------
// 1. Chō-Han
// ---------------------------------------------------------------------------
const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function mountChohan(ctx) {
  const dice = [h('div', { class: 'die' }, FACES[0]), h('div', { class: 'die' }, FACES[2])];
  const choice = segmented([['pair', '丁 Chō', 'Pair'], ['impair', '半 Han', 'Impair']], 'pair');
  const out = h('div', { class: 'result' });
  const go = h('button', { class: 'btn primary big', onClick: () => ctx.guard(async () => {
    out.replaceChildren();
    const r = await play(ctx, { pick: choice.value() });
    await Promise.all(dice.map((d, i) => flicker(d, FACES, 900 + i * 350, FACES[r.details.dice[i] - 1], 80)));
    out.replaceChildren(banner(r, `Total ${r.details.total} : ${r.details.total % 2 === 0 ? 'pair' : 'impair'}`));
    ctx.setBalance(r.balance);
  }) }, 'Lancer les dés');
  return h('div', { class: 'stage-inner' }, h('div', { class: 'dice-row' }, dice), choice.el, go, out);
}

// ---------------------------------------------------------------------------
// 2. Roulette
// ---------------------------------------------------------------------------
const REDS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const rouletteColor = (n) => (n === 0 || n === 37 ? 'green' : REDS.includes(n) ? 'red' : 'black');

function mountRoulette(ctx) {
  let sel = { type: 'red' };
  const label = h('div', { class: 'muted center' });
  const wheel = h('div', { class: 'roulette-ball green' }, '0');
  const out = h('div', { class: 'result' });
  const NAMES = { red: 'Rouge', black: 'Noir', even: 'Pair', odd: 'Impair', low: '1 à 18', high: '19 à 36' };
  const buttons = new Map();
  const refresh = () => {
    buttons.forEach((b, k) => b.setAttribute('aria-pressed', String(k === (sel.type === 'number' ? 'n' + sel.number : sel.type))));
    label.textContent = sel.type === 'number'
      ? `Mise sur le ${sel.number === 37 ? '00' : sel.number} (×36)` : `Mise sur ${NAMES[sel.type]} (×2)`;
  };
  const outside = ['red', 'black', 'even', 'odd', 'low', 'high'].map((t) => {
    const b = h('button', { type: 'button', class: 'seg ' + (t === 'red' || t === 'black' ? 'c-' + t : ''), onClick: () => { sel = { type: t }; refresh(); } }, NAMES[t]);
    buttons.set(t, b); return b;
  });
  const nums = [0, 37, ...Array.from({ length: 36 }, (_, i) => i + 1)].map((n) => {
    const b = h('button', { type: 'button', class: 'rnum c-' + rouletteColor(n), onClick: () => { sel = { type: 'number', number: n }; refresh(); } }, n === 37 ? '00' : n);
    buttons.set('n' + n, b); return b;
  });
  const go = h('button', { class: 'btn primary big', onClick: () => ctx.guard(async () => {
    out.replaceChildren();
    const r = await play(ctx, sel);
    const all = Array.from({ length: 37 }, (_, i) => String(i)).concat('00');
    const end = Date.now() + 1800;
    wheel.className = 'roulette-ball spinning green';
    for (let d = 60; Date.now() < end; d += 12) {
      const v = pick(all); wheel.textContent = v;
      wheel.className = 'roulette-ball spinning ' + rouletteColor(v === '00' ? 37 : Number(v));
      await sleep(d);
    }
    wheel.textContent = r.details.label;
    wheel.className = 'roulette-ball ' + r.details.color;
    const colorFr = { red: 'rouge', black: 'noir', green: 'vert' }[r.details.color];
    out.replaceChildren(banner(r, `${r.details.label} ${colorFr}`));
    ctx.setBalance(r.balance);
  }) }, 'Lancer la bille');
  refresh();
  return h('div', { class: 'stage-inner' }, wheel,
    h('div', { class: 'segmented wrap' }, outside),
    h('div', { class: 'num-grid' }, nums), label, go, out);
}

// ---------------------------------------------------------------------------
// 3. Blackjack (partie en plusieurs étapes, état conservé côté serveur)
// ---------------------------------------------------------------------------

function mountBlackjack(ctx) {
  const dealer = h('div', { class: 'hand' });
  const player = h('div', { class: 'hand' });
  const dInfo = h('div', { class: 'hand-info' });
  const pInfo = h('div', { class: 'hand-info' });
  const out = h('div', { class: 'result' });
  const bDeal = h('button', { class: 'btn primary big', onClick: () => ctx.guard(async () => {
    const bet = ctx.checkBet();
    out.replaceChildren();
    const s = await rpc(ctx.sb, 'bj_start', { p_bet: bet });
    ctx.setBalance(s.balance);
    render(s);
  }) }, 'Distribuer');
  const act = (a) => () => ctx.guard(async () => render(await rpc(ctx.sb, 'bj_action', { p_action: a })));
  const bHit = h('button', { class: 'btn', onClick: act('hit') }, 'Tirer');
  const bStand = h('button', { class: 'btn', onClick: act('stand') }, 'Rester');
  const bDouble = h('button', { class: 'btn', onClick: act('double') }, 'Doubler');
  const actions = h('div', { class: 'row center' }, bHit, bStand, bDouble);

  function render(s) {
    const d = s.details;
    const dealerCards = d.dealer.map((c, i) => cardEl(c, i));
    if (d.dealer_hidden) dealerCards.push(cardEl(0, 0, true));
    dealer.replaceChildren(...dealerCards);
    player.replaceChildren(...d.player.map((c, i) => cardEl(c, i + 2)));
    dInfo.textContent = 'Croupier : ' + (d.dealer_hidden ? d.dealer_value + ' + ?' : d.dealer_value);
    pInfo.textContent = 'Toi : ' + d.player_value + (s.finished ? '' : '   ·   mise ' + fmt(d.bet));
    const live = !s.finished;
    actions.hidden = !live;
    bDeal.hidden = live;
    bDouble.disabled = !d.can_double;
    ctx.bet.lock(live);
    if (live) { ctx.setBalance(s.balance); out.replaceChildren(); }
    if (s.finished) {
      const why = {
        blackjack: 'Blackjack ! Payé 3 pour 2', push_blackjack: 'Blackjack des deux côtés', dealer_blackjack: 'Blackjack du croupier',
        bust: 'Tu dépasses 21', dealer_bust: 'Le croupier dépasse 21', higher: 'Ta main est plus forte',
        push: 'Égalité', lower: 'La main du croupier est plus forte',
      }[s.why];
      out.replaceChildren(banner(s, why));
      ctx.setBalance(s.balance);
      bDeal.textContent = 'Nouvelle main';
    }
  }

  actions.hidden = true;
  // Reprise d'une partie en cours (page rechargée)
  rpc(ctx.sb, 'bj_current').then((s) => { if (s) render(s); }).catch(() => {});
  return h('div', { class: 'stage-inner table' }, dInfo, dealer, pInfo, player, actions, bDeal, out);
}

// ---------------------------------------------------------------------------
// 4. Machine à sous
// ---------------------------------------------------------------------------
const SLOT_WIN = { 20: '刀', 5: '炎', 2: '水', 1.5: '雷', 1: '藤' };
const SLOT_ALL = ['刀', '炎', '水', '雷', '藤', '鬼'];

function slotFinal(mult) {
  const s = SLOT_WIN[mult];
  if (s) return [s, s, s];
  let r;
  do { r = [pick(SLOT_ALL), pick(SLOT_ALL), pick(SLOT_ALL)]; } while (r[0] === r[1] && r[1] === r[2]);
  return r;
}

function mountSlots(ctx) {
  const reels = [0, 1, 2].map(() => h('div', { class: 'reel' }, pick(SLOT_ALL)));
  const out = h('div', { class: 'result' });
  const go = h('button', { class: 'btn primary big', onClick: () => ctx.guard(async () => {
    out.replaceChildren();
    const r = await play(ctx);
    const fin = slotFinal(r.details.mult);
    await Promise.all(reels.map((el, i) => flicker(el, SLOT_ALL, 900 + i * 500, fin[i], 60)));
    out.replaceChildren(banner(r, r.details.mult ? 'Multiplicateur ' + fmtMult(r.details.mult) : 'Pas de ligne gagnante'));
    ctx.setBalance(r.balance);
  }) }, 'Lancer les Respirations');
  const pay = h('div', { class: 'paytable' },
    [['刀刀刀', 20], ['炎炎炎', 5], ['水水水', 2], ['雷雷雷', 1.5], ['藤藤藤', 1]].map(([s, m]) =>
      h('div', {}, h('span', { class: 'sym' }, s), h('b', {}, fmtMult(m)))));
  return h('div', { class: 'stage-inner' }, h('div', { class: 'reels' }, reels), go, out, pay);
}

// ---------------------------------------------------------------------------
// 5. Cartes Hanafuda (grattage)
// ---------------------------------------------------------------------------
const FLOWERS = ['桜', '梅', '藤', '菊', '松', '柳'];
const FLOWER_WIN = { 30: '桜', 5: '菊', 2: '藤', 1: '梅' };

function scratchGrid(mult) {
  const win = FLOWER_WIN[mult];
  const cells = [];
  const count = {};
  const add = (s) => { cells.push(s); count[s] = (count[s] || 0) + 1; };
  if (win) for (let i = 0; i < 3; i++) add(win);
  while (cells.length < 6) add(pick(FLOWERS.filter((x) => (count[x] || 0) < 2)));
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return { cells, win };
}

function mountScratch(ctx) {
  const grid = h('div', { class: 'hanafuda' });
  const out = h('div', { class: 'result' });
  let current = null;
  const cards = Array.from({ length: 6 }, () => h('button', { type: 'button', class: 'hana back', 'aria-label': 'Carte à gratter' }, '？'));
  const reveal = (i) => {
    if (!current || cards[i].classList.contains('open')) return;
    cards[i].classList.remove('back');
    cards[i].classList.add('open');
    cards[i].textContent = current.grid.cells[i];
    if (current.grid.win && current.grid.cells[i] === current.grid.win) cards[i].classList.add('hit');
    if (cards.every((c) => c.classList.contains('open'))) finish();
  };
  const finish = () => {
    if (!current) return;
    const { r } = current;
    current = null;
    out.replaceChildren(banner(r, r.details.mult ? `Trois ${FLOWER_WIN[r.details.mult]} : ${fmtMult(r.details.mult)}` : 'Aucun triplé'));
    ctx.setBalance(r.balance);
    allBtn.hidden = true;
    go.hidden = false;
    ctx.bet.lock(false);
  };
  cards.forEach((c, i) => c.addEventListener('click', () => reveal(i)));
  grid.append(...cards);
  const allBtn = h('button', { class: 'btn', hidden: true, onClick: () => cards.forEach((_, i) => reveal(i)) }, 'Tout gratter');
  const go = h('button', { class: 'btn primary big', onClick: () => ctx.guard(async () => {
    out.replaceChildren();
    const r = await play(ctx);
    current = { r, grid: scratchGrid(r.details.mult) };
    cards.forEach((c) => { c.className = 'hana back'; c.textContent = '？'; });
    go.hidden = true; allBtn.hidden = false;
    ctx.bet.lock(true);
    out.replaceChildren(h('p', { class: 'muted center' }, 'Gratte les cartes : 3 fleurs identiques = gagné.'));
  }) }, 'Acheter un ticket');
  return h('div', { class: 'stage-inner' }, grid, go, allBtn, out);
}

// ---------------------------------------------------------------------------
// 6. Course des corbeaux
// ---------------------------------------------------------------------------

function mountRavens(ctx) {
  let mine = 1;
  const type = segmented([['win', 'Victoire', '×5,5'], ['podium', 'Podium', '×1,8']], 'win');
  const out = h('div', { class: 'result' });
  const lanes = [1, 2, 3, 4, 5, 6].map((n) => {
    const bird = h('div', { class: 'bird r' + n }, '鴉');
    const lane = h('div', { class: 'lane', 'aria-label': 'Corbeau ' + n }, h('span', { class: 'lane-n' }, n), h('div', { class: 'track' }, bird));
    return { n, bird, lane };
  });
  const choose = h('div', { class: 'ravens-pick' }, [1, 2, 3, 4, 5, 6].map((n) =>
    h('button', { type: 'button', class: 'seg', 'aria-pressed': String(n === mine), onClick: (e) => {
      mine = n;
      choose.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === n)));
    } }, 'Corbeau ' + n)));
  const go = h('button', { class: 'btn primary big', onClick: () => ctx.guard(async () => {
    out.replaceChildren();
    lanes.forEach((l) => { l.bird.style.transition = 'none'; l.bird.style.left = '0%'; l.lane.classList.remove('mine'); });
    lanes[mine - 1].lane.classList.add('mine');
    const r = await play(ctx, { type: type.value(), pick: mine });
    await sleep(60);
    r.details.order.forEach((n, rank) => {
      const l = lanes[n - 1];
      l.bird.style.transition = `left ${2.2 + rank * 0.18}s cubic-bezier(.3,.7,.3,1)`;
      l.bird.style.left = (88 - rank * 6) + '%';
    });
    await sleep(2200 + 5 * 180 + 300);
    out.replaceChildren(banner(r, 'Arrivée : ' + r.details.order.map((n, i) => `${i + 1}. n°${n}`).join('  ')));
    ctx.setBalance(r.balance);
  }) }, 'Lancer la course');
  return h('div', { class: 'stage-inner' }, h('div', { class: 'lanes' }, lanes.map((l) => l.lane)),
    h('p', { class: 'muted center' }, 'Choisis ton corbeau :'), choose, type.el, go, out);
}

// ---------------------------------------------------------------------------
// 7. Trois coupes
// ---------------------------------------------------------------------------

function mountCups(ctx) {
  let mine = 2;
  const out = h('div', { class: 'result' });
  const cups = [1, 2, 3].map((n) => {
    const under = h('div', { class: 'under' }, '');
    const cup = h('button', { type: 'button', class: 'cup', 'aria-pressed': String(n === mine), 'aria-label': 'Coupe ' + n,
      onClick: () => { mine = n; cups.forEach((c) => c.cup.setAttribute('aria-pressed', String(c.n === n))); } },
      h('span', { class: 'cup-top' }, '杯'));
    return { n, cup, under, wrap: h('div', { class: 'cup-wrap' }, under, cup) };
  });
  const go = h('button', { class: 'btn primary big', onClick: () => ctx.guard(async () => {
    out.replaceChildren();
    cups.forEach((c) => { c.wrap.classList.remove('lift'); c.under.textContent = ''; });
    const r = await play(ctx, { pick: mine });
    cups.forEach((c) => c.wrap.classList.add('shuffle'));
    await sleep(1500);
    cups.forEach((c) => {
      c.wrap.classList.remove('shuffle');
      c.under.textContent = c.n === r.details.winning_cup ? '刀' : '';
      c.wrap.classList.add('lift');
    });
    await sleep(500);
    out.replaceChildren(banner(r, r.details.winning_cup === mine ? 'La lame Nichirin était là !' : `La lame était sous la coupe ${r.details.winning_cup}`));
    ctx.setBalance(r.balance);
  }) }, 'Mélanger et révéler');
  return h('div', { class: 'stage-inner' }, h('p', { class: 'muted center' }, 'Choisis la coupe qui cache la lame :'),
    h('div', { class: 'cups' }, cups.map((c) => c.wrap)), go, out);
}

// ---------------------------------------------------------------------------
// 8. Bataille des Piliers
// ---------------------------------------------------------------------------

function mountWar(ctx) {
  const you = h('div', { class: 'war-slot' }, cardEl(0, 0, true));
  const dlr = h('div', { class: 'war-slot' }, cardEl(0, 0, true));
  const out = h('div', { class: 'result' });
  const go = h('button', { class: 'btn primary big', onClick: () => ctx.guard(async () => {
    out.replaceChildren();
    you.replaceChildren(cardEl(0, 0, true)); dlr.replaceChildren(cardEl(0, 0, true));
    const r = await play(ctx);
    await sleep(700);
    dlr.replaceChildren(cardEl(r.details.dealer, 1));
    await sleep(700);
    you.replaceChildren(cardEl(r.details.player, 2));
    await sleep(400);
    out.replaceChildren(banner(r, r.details.outcome === 'tie' ? 'Égalité : la banque gagne' : null));
    ctx.setBalance(r.balance);
  }) }, 'Tirer une carte');
  return h('div', { class: 'stage-inner' },
    h('div', { class: 'war' }, h('div', {}, h('div', { class: 'muted center' }, 'Croupier'), dlr), h('div', { class: 'vs' }, 'VS'), h('div', {}, h('div', { class: 'muted center' }, 'Toi'), you)),
    go, out);
}

// ---------------------------------------------------------------------------
// 9. Roue du destin
// ---------------------------------------------------------------------------
// 20 cases : x6 (1), x2 (2), x1,5 (3), x1 (4), perdu (10) - même répartition que le serveur.
const WHEEL = ['6', 'L', '2', 'L', '1.5', 'L', '1', 'L', '1.5', 'L', '2', 'L', '1', 'L', '1.5', 'L', '1', 'L', '1', 'L'];
const WHEEL_COLOR = { 6: '#d4af37', 2: '#b3202a', 1.5: '#d9692b', 1: '#2f7d78', L: '#1b1b22' };

function mountWheel(ctx) {
  const seg = 360 / WHEEL.length;
  const stops = WHEEL.map((k, i) => `${WHEEL_COLOR[k]} ${i * seg}deg ${(i + 1) * seg}deg`).join(', ');
  const wheel = h('div', { class: 'wheel', style: { background: `conic-gradient(from ${-seg / 2}deg, ${stops})` } },
    WHEEL.map((k, i) => h('span', { class: 'wlabel', style: { transform: `rotate(${i * seg}deg) translateY(-112px)` } }, k === 'L' ? '✕' : '×' + k.replace('.', ','))));
  let rot = 0;
  const out = h('div', { class: 'result' });
  const go = h('button', { class: 'btn primary big', onClick: () => ctx.guard(async () => {
    out.replaceChildren();
    const r = await play(ctx);
    const key = r.details.mult === 0 ? 'L' : String(r.details.mult);
    const idx = pick(WHEEL.map((k, i) => (k === key ? i : -1)).filter((i) => i >= 0));
    rot = Math.ceil(rot / 360) * 360 + 360 * 5 - idx * seg;
    wheel.style.transform = `rotate(${rot}deg)`;
    await sleep(4200);
    out.replaceChildren(banner(r, r.details.mult ? 'Case ' + fmtMult(r.details.mult) : 'Case perdante'));
    ctx.setBalance(r.balance);
  }) }, 'Tourner la roue');
  return h('div', { class: 'stage-inner' }, h('div', { class: 'wheel-box' }, h('div', { class: 'pointer' }, '▼'), wheel), go, out);
}

// ---------------------------------------------------------------------------
// 10. Quitte ou double de la Glycine
// ---------------------------------------------------------------------------

function mountDouble(ctx) {
  const steps = [2, 4, 8].map((m) => h('div', { class: 'rung' }, '×' + m));
  const pot = h('div', { class: 'pot' }, '—');
  const out = h('div', { class: 'result' });
  const start = h('button', { class: 'btn primary big', onClick: () => ctx.guard(async () => {
    const bet = ctx.checkBet();
    out.replaceChildren();
    const s = await rpc(ctx.sb, 'qd_start', { p_bet: bet });
    ctx.setBalance(s.balance);
    render(s);
  }) }, 'Miser');
  const step = h('button', { class: 'btn primary big', onClick: () => ctx.guard(async () => render(await rpc(ctx.sb, 'qd_step'))) }, 'Doubler (45 %)');
  const cash = h('button', { class: 'btn gold big', onClick: () => ctx.guard(async () => render(await rpc(ctx.sb, 'qd_cash'))) }, 'Encaisser');
  const live = h('div', { class: 'row center' }, step, cash);

  function render(s) {
    const d = s.details;
    steps.forEach((el, i) => {
      el.classList.toggle('done', i < d.step);
      el.classList.toggle('failed', Boolean(s.finished && d.failed && i === d.step));
    });
    const active = !s.finished;
    live.hidden = !active; start.hidden = active;
    ctx.bet.lock(active);
    if (active) {
      ctx.setBalance(s.balance);
      pot.textContent = d.step === 0 ? `Mise : ${fmt(d.bet)}` : `Gain actuel : ${fmt(d.current)}`;
      step.textContent = `Doubler vers ${fmt(d.next)} (45 %)`;
      cash.hidden = !d.can_cash;
      out.replaceChildren();
    } else {
      pot.textContent = s.result === 'win' ? `Encaissé : ${fmt(s.payout)}` : 'Tout est perdu…';
      out.replaceChildren(banner(s, d.maxed ? 'Palier maximum atteint !' : null));
      ctx.setBalance(s.balance);
      start.textContent = 'Rejouer';
    }
  }

  live.hidden = true;
  rpc(ctx.sb, 'qd_current').then((s) => { if (s) render(s); }).catch(() => {});
  return h('div', { class: 'stage-inner' }, h('div', { class: 'ladder' }, steps), pot, live, start, out);
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const GAMES = [
  { id: 'chohan', kanji: '丁半', tagline: 'Pair ou impair ?', top: '×1,9', mount: mountChohan,
    rules: ['Deux dés sont lancés. Tu paries sur la parité du total : Chō (pair) ou Han (impair).',
      'Chances de gagner : 50 %. Gain : ×1,9 la mise.'] },
  { id: 'roulette', kanji: '月', tagline: 'La bille de la Lune', top: '×36', mount: mountRoulette,
    rules: ['38 cases : 1 à 36, plus le 0 et le 00 (qui font perdre les mises extérieures).',
      'Rouge, noir, pair, impair, 1-18, 19-36 : 47,4 % de chances, gain ×2.',
      'Numéro plein (0 et 00 inclus) : 2,6 % de chances, gain ×36.'] },
  { id: 'blackjack', kanji: '二十一', tagline: 'Approche 21 sans dépasser', top: '×2,5', mount: mountBlackjack,
    rules: ['Bats le croupier sans dépasser 21. Le croupier tire jusqu\'à 17 et s\'arrête sur tout 17.',
      'Victoire ×2 · blackjack (As + figure) ×2,5 · égalité : mise rendue.',
      'Tu peux tirer, rester, ou doubler avec tes deux premières cartes. Cartes tirées dans un sabot infini.'] },
  { id: 'slots', kanji: '呼吸', tagline: 'Les Cinq Respirations', top: '×20', mount: mountSlots,
    rules: ['Trois symboles identiques font gagner. Chances de gain : 22 % (+ 25 % de mise rendue).',
      '刀 ×20 (1 %) · 炎 ×5 (3 %) · 水 ×2 (8 %) · 雷 ×1,5 (10 %) · 藤 mise rendue (25 %).'] },
  { id: 'scratch', kanji: '花札', tagline: 'Cartes Hanafuda à gratter', top: '×30', mount: mountScratch,
    rules: ['Gratte les 6 cartes : trois fleurs identiques font gagner.',
      '桜 ×30 (1 %) · 菊 ×5 (5 %) · 藤 ×2 (14 %) · 梅 mise rendue (10 %). 70 % de tickets perdants.'] },
  { id: 'ravens', kanji: '鴉', tagline: 'Course des corbeaux Kasugai', top: '×5,5', mount: mountRavens,
    rules: ['Six corbeaux courent. Choisis ton favori.',
      'Victoire (1er) : 16,7 % de chances, ×5,5. Podium (top 3) : 50 % de chances, ×1,8.'] },
  { id: 'cups', kanji: '杯', tagline: 'Où est la lame Nichirin ?', top: '×2,7', mount: mountCups,
    rules: ['Une lame est cachée sous une des trois coupes. Trouve-la.', '33 % de chances de gagner. Gain : ×2,7.'] },
  { id: 'war', kanji: '柱', tagline: 'Ta carte contre celle du croupier', top: '×2', mount: mountWar,
    rules: ['Vous tirez chacun une carte (As = la plus forte). La plus haute gagne.',
      'Égalité : la banque gagne. 46 % de chances, gain ×2.'] },
  { id: 'wheel', kanji: '運命', tagline: 'La roue du destin de Muzan', top: '×6', mount: mountWheel,
    rules: ['20 cases : ×6 (1), ×2 (2), ×1,5 (3), mise rendue (4), perdu (10).',
      '30 % de chances de gagner, 20 % de mise rendue.'] },
  { id: 'double', kanji: '藤', tagline: 'Quitte ou double', top: '×8', mount: mountDouble,
    rules: ['Doubler réussit avec 45 % de chances. Encaisse quand tu veux : ×2, ×4 ou ×8 au maximum (3 étapes).',
      'Un seul échec et la mise est perdue. Ta partie est conservée si tu quittes la page.'] },
];

export const GAME_BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g]));
