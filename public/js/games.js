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
  { id: 'chohan', kanji: '丁半', name: 'Chō-Han (dés)', theme: 'Chō-Han des Hashira',
    tagline: 'Pair ou impair avec deux dés', top: '×1,9', mount: mountChohan,
    help: {
      goal: 'Devine si le total de deux dés sera pair ou impair.',
      steps: ['Choisis ta mise.', 'Choisis Chō (丁, pair) ou Han (半, impair).',
        'Clique sur « Lancer les dés » : deux dés à six faces sont lancés.',
        'Si le total correspond à ton choix, tu gagnes.'],
      table: [['Bon choix', '50 %', '×1,9 la mise'], ['Mauvais choix', '50 %', 'Mise perdue']],
      note: 'Exemple : tu mises 100 et tu gagnes, tu reçois 190 (gain net : 90).',
    } },
  { id: 'roulette', kanji: '月', name: 'Roulette', theme: 'Roulette de la Lune',
    tagline: 'Parie sur une couleur ou un numéro', top: '×36', mount: mountRoulette,
    help: {
      goal: "Devine où s'arrête la bille sur une roue de 38 cases : les numéros 1 à 36, plus le 0 et le 00 (cases vertes).",
      steps: ['Choisis ta mise.', 'Choisis un pari : rouge, noir, pair, impair, 1 à 18, 19 à 36, ou un numéro précis (0 et 00 compris).',
        'Clique sur « Lancer la bille ».', 'Si la bille tombe sur ton pari, tu gagnes.'],
      table: [['Rouge ou noir', '47,4 %', '×2'], ['Pair ou impair', '47,4 %', '×2'], ['1 à 18 ou 19 à 36', '47,4 %', '×2'],
        ['Numéro précis', '2,6 %', '×36']],
      note: 'Le 0 et le 00 font perdre tous les paris, sauf si tu as misé dessus.',
    } },
  { id: 'blackjack', kanji: '二十一', name: 'Blackjack', theme: 'Vingt-et-un de la Brigade',
    tagline: 'Approche 21 sans dépasser', top: '×2,5', mount: mountBlackjack,
    help: {
      goal: 'Fais une main plus proche de 21 que celle du croupier, sans dépasser 21.',
      steps: ['Choisis ta mise puis clique sur « Distribuer » : tu reçois deux cartes, le croupier en montre une.',
        "Valeur des cartes : de 2 à 10, leur chiffre ; les figures valent 10 ; l'As vaut 1 ou 11 (le mieux pour toi).",
        "Tirer : une carte de plus. Rester : tu gardes ta main. Doubler : possible seulement avec tes deux premières cartes, tu doubles ta mise et tu ne reçois qu'une carte.",
        "Si tu dépasses 21, tu perds. Le croupier tire jusqu'à 17 et s'arrête sur tout 17."],
      table: [['Victoire', '≈ 43 %', '×2'], ['Blackjack (As + carte de valeur 10)', '≈ 4,7 %', '×2,5'],
        ['Égalité', '≈ 9 %', 'Mise rendue'], ['Défaite', '≈ 48 %', 'Mise perdue']],
      note: 'Les chances sont approximatives et dépendent de ta façon de jouer. Les cartes sont tirées dans un sabot infini. Ta main est conservée si tu quittes la page.',
    } },
  { id: 'slots', kanji: '呼吸', name: 'Machine à sous', theme: 'Les Cinq Respirations',
    tagline: 'Aligne trois symboles identiques', top: '×20', mount: mountSlots,
    help: {
      goal: 'Fais apparaître trois symboles identiques sur les trois rouleaux.',
      steps: ['Choisis ta mise.', "Clique sur « Lancer les Respirations » : les trois rouleaux tournent puis s'arrêtent.",
        'Trois symboles identiques te font gagner selon le tableau ci-dessous. Les autres combinaisons perdent.'],
      table: [['刀 刀 刀', '1 %', '×20'], ['炎 炎 炎', '3 %', '×5'], ['水 水 水', '8 %', '×2'], ['雷 雷 雷', '10 %', '×1,5'],
        ['藤 藤 藤', '25 %', 'Mise rendue'], ['Autre combinaison', '53 %', 'Mise perdue']],
    } },
  { id: 'scratch', kanji: '花札', name: 'Carte à gratter', theme: 'Cartes Hanafuda',
    tagline: 'Gratte et trouve trois fleurs identiques', top: '×30', mount: mountScratch,
    help: {
      goal: 'Gratte les 6 cartes : trois fleurs identiques te font gagner.',
      steps: ['Choisis ta mise puis clique sur « Acheter un ticket » : la mise est prélevée.',
        'Clique sur chaque carte pour la gratter, ou sur « Tout gratter ».',
        'Si trois fleurs identiques apparaissent, tu gagnes selon la fleur.'],
      table: [['桜 桜 桜', '1 %', '×30'], ['菊 菊 菊', '5 %', '×5'], ['藤 藤 藤', '14 %', '×2'], ['梅 梅 梅', '10 %', 'Mise rendue'],
        ['Aucun triplé', '70 %', 'Mise perdue']],
      note: "Le résultat est décidé dès l'achat du ticket : gratter ne change rien, ça ne fait que le révéler.",
    } },
  { id: 'ravens', kanji: '鴉', name: 'Course de corbeaux', theme: 'Corbeaux Kasugai',
    tagline: 'Parie sur le corbeau gagnant', top: '×5,5', mount: mountRavens,
    help: {
      goal: 'Six corbeaux courent : parie sur celui qui gagnera ou qui finira sur le podium.',
      steps: ['Choisis ta mise et ton corbeau (1 à 6).', 'Choisis ton pari : Victoire (il finit premier) ou Podium (il finit dans les trois premiers).',
        "Clique sur « Lancer la course » et regarde l'arrivée."],
      table: [['Victoire (1er)', '16,7 %', '×5,5'], ['Podium (top 3)', '50 %', '×1,8'], ['Perdu', 'le reste', 'Mise perdue']],
      note: 'Tous les corbeaux ont les mêmes chances : choisir le 1 ou le 6 ne change rien.',
    } },
  { id: 'cups', kanji: '杯', name: 'Bonneteau (3 gobelets)', theme: 'Trois coupes, une Nichirin',
    tagline: 'Devine sous quelle coupe est la lame', top: '×2,7', mount: mountCups,
    help: {
      goal: 'Une lame est cachée sous une des trois coupes : devine laquelle.',
      steps: ['Choisis ta mise.', 'Clique sur la coupe de ton choix.', 'Clique sur « Mélanger et révéler » : les coupes sont mélangées puis soulevées.',
        'Si la lame est sous ta coupe, tu gagnes.'],
      table: [['Bonne coupe', '33 %', '×2,7'], ['Mauvaise coupe', '67 %', 'Mise perdue']],
      note: 'La lame est placée au hasard, quel que soit ton choix.',
    } },
  { id: 'war', kanji: '柱', name: 'Bataille', theme: 'Bataille des Piliers',
    tagline: 'Ta carte contre celle du croupier', top: '×2', mount: mountWar,
    help: {
      goal: 'Toi et le croupier tirez chacun une carte : la plus haute gagne.',
      steps: ['Choisis ta mise puis clique sur « Tirer une carte ».',
        'Ordre des cartes, de la plus faible à la plus forte : 2, 3, … 10, Valet, Dame, Roi, As.',
        'Si ta carte est plus haute que celle du croupier, tu gagnes.'],
      table: [['Ta carte est plus haute', '46 %', '×2'], ['Égalité', '7,7 %', 'La banque gagne (mise perdue)'],
        ['Carte du croupier plus haute', '46 %', 'Mise perdue']],
    } },
  { id: 'wheel', kanji: '運命', name: 'Roue de la fortune', theme: 'Roue du destin de Muzan',
    tagline: 'Fais tourner la roue, gagne un multiplicateur', top: '×6', mount: mountWheel,
    help: {
      goal: 'Fais tourner une roue de 20 cases : chaque case indique ton gain.',
      steps: ['Choisis ta mise.', 'Clique sur « Tourner la roue ».', "La case où elle s'arrête, sous la flèche, donne ton gain."],
      table: [['Case ×6', '1 case sur 20 (5 %)', '×6'], ['Case ×2', '2 cases (10 %)', '×2'], ['Case ×1,5', '3 cases (15 %)', '×1,5'],
        ['Case ×1', '4 cases (20 %)', 'Mise rendue'], ['Case ✕', '10 cases (50 %)', 'Mise perdue']],
    } },
  { id: 'double', kanji: '藤', name: 'Quitte ou double', theme: 'Glycine',
    tagline: 'Double ta mise ou perds tout', top: '×8', mount: mountDouble,
    help: {
      goal: "Double ton gain jusqu'à trois fois de suite, mais un seul échec te fait tout perdre.",
      steps: ['Choisis ta mise puis clique sur « Miser ».',
        'Clique sur « Doubler » : tu as 45 % de chances de réussir et de doubler ton gain.',
        'Après chaque réussite, tu peux « Encaisser » ton gain ou retenter de doubler.',
        "En cas d'échec, tu perds tout. À la 3e réussite (×8), ton gain est encaissé automatiquement."],
      table: [['Réussir 1 étape', '45 %', '×2'], ['Réussir 2 étapes', '20 %', '×4'], ['Réussir 3 étapes', '9 %', '×8'],
        ['Échouer', 'à chaque étape 55 %', 'Mise perdue']],
      note: 'Ta partie est conservée si tu quittes la page.',
    } },
];

// Contenu de la fenêtre « Comment jouer ? »
export function rulesEl(g) {
  const hp = g.help;
  return h('div', { class: 'rules-doc' },
    h('p', { class: 'lead' }, hp.goal),
    h('h4', {}, 'Comment jouer'),
    h('ol', {}, hp.steps.map((s) => h('li', {}, s))),
    h('h4', {}, 'Gains et chances'),
    h('table', {},
      h('thead', {}, h('tr', {}, ['Résultat', 'Chances', 'Gain'].map((x) => h('th', {}, x)))),
      h('tbody', {}, hp.table.map(([a, b, c]) => h('tr', {}, h('td', {}, a), h('td', {}, b), h('td', {}, c))))),
    hp.note ? h('p', { class: 'muted' }, hp.note) : null,
    h('p', { class: 'tiny muted' }, 'Jetons fictifs, pour le jeu de rôle uniquement. Tous les tirages sont faits côté serveur.'));
}

export const GAME_BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g]));
