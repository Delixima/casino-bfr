// Tests de la logique serveur (SQL) sur un vrai PostgreSQL embarqué (pglite).
// Lancer : npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(here, '..', 'supabase', 'migrations', '001_init.sql'), 'utf8');

const ADMIN_STEAM = '76561199213350970';
const U1 = '00000000-0000-0000-0000-000000000001';
const U2 = '00000000-0000-0000-0000-000000000002';
const ADM = '00000000-0000-0000-0000-0000000000aa';

let db;

// Simule la connexion d'un utilisateur (équivalent de auth.uid() de Supabase)
async function as(uid) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
}
async function rpc(name, ...args) {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  const r = await db.query(`select public.${name}(${ph}) as r`, args);
  return r.rows[0].r;
}
async function balance(uid) {
  const r = await db.query('select balance from public.profiles where id = $1', [uid]);
  return Number(r.rows[0].balance);
}
async function fails(promise, message) {
  await assert.rejects(promise, (e) => {
    assert.match(String(e.message), new RegExp(message));
    return true;
  });
}
async function give(uid, amount) {
  await db.query('update public.profiles set balance = $2 where id = $1', [uid, amount]);
}

before(async () => {
  db = new PGlite();
  // Simulation minimale de l'environnement Supabase
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public to anon, authenticated;
    grant usage on schema auth to anon, authenticated;
  `);
  await db.exec(MIGRATION);
  await db.exec(`insert into auth.users (id) values ('${U1}'), ('${U2}'), ('${ADM}')`);
  await db.exec(`
    insert into public.profiles (id, steam_id, display_name) values
      ('${U1}', '76561198000000001', 'Tanjiro'),
      ('${U2}', '76561198000000002', 'Zenitsu'),
      ('${ADM}', '${ADMIN_STEAM}', 'Finance');
  `);
});

after(async () => { await db.close(); });

test('le SteamID admin reçoit is_admin automatiquement, pas les autres', async () => {
  const r = await db.query('select steam_id, is_admin from public.profiles order by steam_id');
  const byId = Object.fromEntries(r.rows.map((x) => [x.steam_id, x.is_admin]));
  assert.equal(byId[ADMIN_STEAM], true);
  assert.equal(byId['76561198000000001'], false);
});

test('un nouveau joueur démarre à 0 jeton', async () => {
  assert.equal(await balance(U1), 0);
});

test('non connecté : tout est refusé', async () => {
  await as(null);
  await fails(rpc('play_instant', 'slots', 10, '{}'), 'not_authenticated');
  await fails(rpc('bj_start', 10), 'not_authenticated');
  await fails(rpc('leaderboard'), 'not_authenticated');
});

test('un joueur normal ne peut pas utiliser les fonctions admin', async () => {
  await as(U1);
  await fails(rpc('admin_adjust_balance', '76561198000000001', 1000, 'triche'), 'forbidden');
  await fails(rpc('admin_stats'), 'forbidden');
  await fails(rpc('admin_list_players', null), 'forbidden');
});

test('l\'admin crédite et débite, avec historique et sans solde négatif', async () => {
  await as(ADM);
  const r = await rpc('admin_adjust_balance', '76561198000000001', 5000, 'Prime de mission');
  assert.equal(Number(r.balance), 5000);
  const r2 = await rpc('admin_adjust_balance', '76561198000000001', -1000, 'Correction');
  assert.equal(Number(r2.balance), 4000);
  await fails(rpc('admin_adjust_balance', '76561198000000001', -999999, null), 'insufficient_funds');
  await fails(rpc('admin_adjust_balance', '76561198000000001', 0, null), 'invalid_amount');
  await fails(rpc('admin_adjust_balance', '1234', 10, null), 'player_not_found');
  const t = await db.query(`select kind, amount, note from public.transactions where user_id = $1 order by id`, [U1]);
  assert.deepEqual(t.rows.map((x) => x.kind), ['admin_credit', 'admin_debit']);
});

test('mises invalides, solde insuffisant et choix invalides sont refusés sans toucher au solde', async () => {
  await give(U1, 1000);
  await as(U1);
  await fails(rpc('play_instant', 'slots', 5, '{}'), 'invalid_bet');            // < min
  await fails(rpc('play_instant', 'slots', 999999, '{}'), 'invalid_bet');       // > max
  await fails(rpc('play_instant', 'slots', -50, '{}'), 'invalid_bet');
  await fails(rpc('play_instant', 'slots', null, '{}'), 'invalid_bet');
  await fails(rpc('play_instant', 'poker', 100, '{}'), 'unknown_game');
  await fails(rpc('play_instant', 'chohan', 100, '{}'), 'invalid_choice');
  await fails(rpc('play_instant', 'chohan', 100, '{"pick":"x"}'), 'invalid_choice');
  await fails(rpc('play_instant', 'roulette', 100, '{"type":"number","number":99}'), 'invalid_choice');
  await fails(rpc('play_instant', 'roulette', 100, '{"type":"bidon"}'), 'invalid_choice');
  await fails(rpc('play_instant', 'ravens', 100, '{"type":"win","pick":9}'), 'invalid_choice');
  await fails(rpc('play_instant', 'cups', 100, '{"pick":1}'), 'unknown_game');   // le bonneteau a ses propres fonctions
  await give(U1, 50);
  await fails(rpc('play_instant', 'slots', 100, '{}'), 'insufficient_funds');
  assert.equal(await balance(U1), 50);
});

const INSTANT = [
  ['chohan', { pick: 'pair' }],
  ['roulette', { type: 'red' }],
  ['roulette', { type: 'number', number: 37 }],
  ['slots', {}],
  ['scratch', {}],
  ['ravens', { type: 'win', pick: 3 }],
  ['ravens', { type: 'podium', pick: 3 }],
  ['war', {}],
  ['wheel', {}],
];

test('chaque jeu instantané : solde cohérent et historique enregistré', async () => {
  await as(U2);
  for (const [game, choice] of INSTANT) {
    await give(U2, 100000);
    const before = await balance(U2);
    const r = await rpc('play_instant', game, 100, JSON.stringify(choice));
    const after = await balance(U2);
    assert.equal(Number(r.balance), after, game);
    assert.equal(after, before - 100 + Number(r.payout), game);
    assert.ok(['win', 'lose', 'push'].includes(r.result), game);
    const t = await db.query(
      `select bet, payout, amount, balance_after from public.transactions
       where user_id = $1 and game = $2 order by id desc limit 1`, [U2, game]);
    assert.equal(Number(t.rows[0].bet), 100);
    assert.equal(Number(t.rows[0].payout), Number(r.payout));
    assert.equal(Number(t.rows[0].amount), Number(r.payout) - 100);
    assert.equal(Number(t.rows[0].balance_after), after);
  }
});

// ---- RTP : taux de retour théorique vs mesuré (10 000 manches / jeu) ----
const N = 10000;
const THEORY = [
  ['chohan',   { pick: 'pair' },               0.95],
  ['roulette', { type: 'red' },                36 / 38],
  ['roulette', { type: 'number', number: 17 }, 36 / 38],
  ['slots',    {},                             0.91],
  ['scratch',  {},                             0.93],
  ['ravens',   { type: 'win', pick: 1 },       5.5 / 6],
  ['ravens',   { type: 'podium', pick: 4 },    0.90],
  ['war',      {},                             12 / 13],
  ['wheel',    {},                             0.925],
];
// Écart-type du gain par manche (en multiple de la mise), pour fixer la tolérance
const SD = { chohan: 0.95, roulette: 1, slots: 2.2, scratch: 1.9, ravens: 2.3, war: 1, wheel: 1.3 };

for (const [game, choice, rtp] of THEORY) {
  test(`RTP ${game} ${JSON.stringify(choice)} ≈ ${(rtp * 100).toFixed(1)} %`, { timeout: 120000 }, async () => {
    await as(U2);
    await give(U2, 1000000000);
    await db.query(`delete from public.transactions where user_id = $1 and game = $2`, [U2, game]);
    await db.query(
      `select public.play_instant($1, 100, $2::jsonb) from generate_series(1, $3)`,
      [game, JSON.stringify(choice), N]);
    const r = await db.query(
      `select sum(bet) b, sum(payout) p, count(*) filter (where payout > bet) wins,
              count(*) filter (where payout < bet) losses
       from public.transactions where user_id = $1 and game = $2`, [U2, game]);
    const row = r.rows[0];
    const measured = Number(row.p) / Number(row.b);
    // Un pari plein à x36 varie bien plus qu'un pari à x2 : écart-type adapté
    const sd = choice.type === 'number' ? 5.8 : (SD[game] ?? 2);
    const tol = 5 * sd / Math.sqrt(N);
    assert.ok(Math.abs(measured - rtp) < tol,
      `${game}: mesuré ${measured.toFixed(4)} vs théorique ${rtp.toFixed(4)} (tolérance ±${tol.toFixed(3)})`);
    if (choice.type === 'number') {
      // numéro plein : 1 chance sur 38 (≈ 2,63 %), vérifié sur la fréquence de victoire
      const p = 1 / 38;
      const freq = Number(row.wins) / N;
      assert.ok(Math.abs(freq - p) < 5 * Math.sqrt(p * (1 - p) / N),
        `roulette numéro: fréquence ${freq.toFixed(4)} vs ${p.toFixed(4)}`);
    }
    // Le casino doit gagner à long terme mais le joueur doit pouvoir gagner
    assert.ok(Number(row.wins) > 0, `${game}: aucune victoire sur ${N} manches`);
    console.log(`  ${game} ${JSON.stringify(choice)}: RTP ${(measured * 100).toFixed(1)} %, ` +
      `victoires ${(Number(row.wins) / N * 100).toFixed(1)} %, défaites ${(Number(row.losses) / N * 100).toFixed(1)} %`);
  });
}


// ---- Bonneteau (jeu d'adresse : la lame est mélangée sous les yeux du joueur) ----
// Rejoue les échanges comme le fait l'interface : suit la lame de coupe en coupe.
function followBlade(start, swaps) {
  let pos = start;
  for (const [a, b] of swaps) { if (pos === a) pos = b; else if (pos === b) pos = a; }
  return pos;
}

test('bonneteau : la lame suivie à l\'œil correspond au résultat du serveur', { timeout: 120000 }, async () => {
  await as(U2);
  let wins = 0, losses = 0;
  for (let i = 0; i < 150; i++) {
    await give(U2, 100000);
    const s = await rpc('cups_start', 100);
    assert.equal(s.finished, false);
    assert.equal(Number(s.balance), 99900);                   // mise retenue pendant la partie
    assert.ok(s.details.start >= 1 && s.details.start <= 3);
    assert.ok(s.details.swaps.length >= 14 && s.details.swaps.length <= 20);
    // jamais deux fois le même échange de suite, et seulement des coupes 1 à 3
    s.details.swaps.forEach(([a, b], k) => {
      assert.ok(a >= 1 && b <= 3 && a < b);
      if (k) assert.notDeepEqual(s.details.swaps[k - 1], [a, b]);
    });
    assert.equal(JSON.stringify(s).includes('final'), false, 'la position finale ne doit pas être envoyée avant le choix');
    await fails(rpc('cups_start', 100), 'game_in_progress');
    const cur = await rpc('cups_current');
    assert.equal(cur.details.resumed, true);
    assert.equal(JSON.stringify(cur).includes('start'), false, 'reprise : aucune info sur la lame');

    const seen = followBlade(s.details.start, s.details.swaps);    // ce qu'un joueur attentif voit
    const r = await rpc('cups_pick', seen);
    assert.equal(r.details.winning_cup, seen, 'le serveur et l\'animation doivent être d\'accord');
    assert.equal(r.result, 'win');
    assert.equal(Number(r.payout), 160);                           // x1,6
    assert.equal(await balance(U2), 99900 + 160);
    wins++;
    assert.equal(await rpc('cups_current'), null);
  }
  // mauvais choix : perdu, mise perdue
  await give(U2, 1000);
  const s2 = await rpc('cups_start', 100);
  const seen2 = followBlade(s2.details.start, s2.details.swaps);
  const wrong = seen2 === 1 ? 2 : 1;
  const r2 = await rpc('cups_pick', wrong);
  assert.equal(r2.result, 'lose');
  assert.equal(Number(r2.payout), 0);
  assert.equal(await balance(U2), 900);
  losses++;
  assert.equal(wins, 150); assert.equal(losses, 1);
});

test('bonneteau : choix invalide, aucune partie, mises limitées', async () => {
  await as(U2);
  await fails(rpc('cups_pick', 1), 'no_active_game');
  await give(U2, 100000);
  await fails(rpc('cups_start', 5), 'invalid_bet');
  await fails(rpc('cups_start', 1001), 'invalid_bet');           // mise max par défaut : 1000
  await rpc('cups_start', 100);
  await fails(rpc('cups_pick', 0), 'invalid_choice');
  await fails(rpc('cups_pick', 4), 'invalid_choice');
  await fails(rpc('cups_pick', null), 'invalid_choice');
  await rpc('cups_pick', 2);                                       // termine la partie
});

test('bonneteau : un joueur au hasard gagne environ 1 fois sur 3 (retour ≈ 53 %)', { timeout: 120000 }, async () => {
  await as(U2);
  await give(U2, 1000000000);
  const N2 = 3000;
  let wins = 0;
  for (let i = 0; i < N2; i++) {
    await rpc('cups_start', 100);
    const r = await rpc('cups_pick', (i % 3) + 1);                 // choix sans regarder
    if (r.result === 'win') wins++;
  }
  const p = 1 / 3;
  const freq = wins / N2;
  assert.ok(Math.abs(freq - p) < 5 * Math.sqrt(p * (1 - p) / N2), `fréquence ${freq.toFixed(3)} vs ${p.toFixed(3)}`);
  console.log(`  bonneteau (choix au hasard): victoires ${(freq * 100).toFixed(1)} % ⇒ retour ${(freq * 160).toFixed(0)} %`);
});

// ---- Blackjack ----
test('blackjack : parties complètes, solde cohérent, une seule partie à la fois', { timeout: 120000 }, async () => {
  await as(U2);
  let finished = 0;
  let wins = 0;
  for (let i = 0; i < 300; i++) {
    await give(U2, 100000);
    const start = await db.query(`select public.bj_start(100) r`);
    let state = start.rows[0].r;
    if (!state.finished) {
      // la carte cachée n'est jamais révélée en cours de partie
      assert.equal(state.details.dealer.length, 1);
      assert.equal(state.details.dealer_hidden, true);
      await fails(rpc('bj_start', 100), 'game_in_progress');
      const cur = await rpc('bj_current');
      assert.equal(cur.details.dealer.length, 1);
      // joueur simple : tire jusqu'à 16 inclus
      let guard = 0;
      while (!state.finished && guard++ < 20) {
        const action = state.details.player_value < 17 ? 'hit' : 'stand';
        state = await rpc('bj_action', action);
      }
    }
    assert.equal(state.finished, true);
    finished++;
    if (state.result === 'win') wins++;
    const bal = await balance(U2);
    assert.equal(Number(state.balance), bal);
    assert.equal(bal, 100000 - Number(state.bet) + Number(state.payout));
    assert.equal(await rpc('bj_current'), null);
    assert.ok([0, Number(state.bet), Number(state.bet) * 2, Math.floor(Number(state.bet) * 2.5)].includes(Number(state.payout)));
  }
  assert.equal(finished, 300);
  assert.ok(wins > 40, `trop peu de victoires au blackjack: ${wins}/300`);
});

test('blackjack : double mise et règles', async () => {
  await as(U2);
  await fails(rpc('bj_action', 'hit'), 'no_active_game');
  let doubled = 0;
  for (let i = 0; i < 200 && doubled < 5; i++) {
    await give(U2, 100000);
    let state = (await db.query(`select public.bj_start(100) r`)).rows[0].r;
    if (state.finished) continue;
    state = await rpc('bj_action', 'double');
    doubled++;
    assert.equal(state.finished, true);
    assert.equal(Number(state.bet), 200);
    assert.equal(state.details.player.length, 3);
    assert.equal(await balance(U2), 100000 - 200 + Number(state.payout));
  }
  assert.ok(doubled > 0);
  // double interdit après un tirage
  for (let i = 0; i < 200; i++) {
    await give(U2, 100000);
    let state = (await db.query(`select public.bj_start(100) r`)).rows[0].r;
    if (state.finished) continue;
    state = await rpc('bj_action', 'hit');
    if (!state.finished) {
      await fails(rpc('bj_action', 'double'), 'cannot_double');
      await rpc('bj_action', 'stand');
      break;
    }
  }
});

test('blackjack : le dealer tire jusqu\'à 17 et la mise est bien retenue pendant la partie', async () => {
  await as(U2);
  for (let i = 0; i < 100; i++) {
    await give(U2, 1000);
    const state = (await db.query(`select public.bj_start(100) r`)).rows[0].r;
    if (state.finished) continue;
    assert.equal(await balance(U2), 900);       // mise retenue
    const end = await rpc('bj_action', 'stand');
    if (end.details.player_value <= 21) {
      assert.ok(end.details.dealer_value >= 17, 'le croupier doit avoir au moins 17');
    }
    return;
  }
});

// ---- Quitte ou double ----
test('quitte ou double : étapes, encaissement, perte', async () => {
  await as(U2);
  await fails(rpc('qd_cash'), 'no_active_game');
  let cashed = 0, lost = 0, maxed = 0;
  for (let i = 0; i < 400; i++) {
    await give(U2, 100000);
    let state = await rpc('qd_start', 100);
    assert.equal(state.finished, false);
    await fails(rpc('qd_start', 100), 'game_in_progress');
    await fails(rpc('qd_cash'), 'nothing_to_cash');       // rien à encaisser à l'étape 0
    assert.equal(await balance(U2), 99900);
    const wantSteps = 1 + (i % 3);                        // tente 1, 2 ou 3 étapes puis encaisse
    while (!state.finished) {
      if (state.details.step >= wantSteps) { state = await rpc('qd_cash'); break; }
      state = await rpc('qd_step');
    }
    assert.equal(state.finished, true);
    const bal = await balance(U2);
    assert.equal(bal, 100000 - 100 + Number(state.payout));
    if (state.result === 'lose') { lost++; assert.equal(Number(state.payout), 0); }
    else {
      cashed++;
      const steps = Math.log2(Number(state.payout) / 100);
      assert.ok([1, 2, 3].includes(steps), `gain inattendu ${state.payout}`);
      if (steps === 3) maxed++;
    }
    assert.equal(await rpc('qd_current'), null);
  }
  assert.ok(cashed > 0 && lost > 0, `cashed=${cashed} lost=${lost}`);
  assert.ok(maxed > 0, 'le palier x8 doit pouvoir être atteint');
});

test('un joueur ne voit que ses propres données (RLS) et ne peut rien écrire directement', async () => {
  await db.exec(`set role authenticated`);
  try {
    await as(U1);
    const mine = await db.query('select id from public.profiles');
    assert.equal(mine.rows.length, 1);
    assert.equal(mine.rows[0].id, U1);
    const tx = await db.query('select distinct user_id from public.transactions');
    assert.ok(tx.rows.every((x) => x.user_id === U1));
    await fails(db.query(`update public.profiles set balance = 999999999 where id = '${U1}'`), 'permission denied');
    await fails(db.query(`insert into public.transactions (user_id, kind, amount, balance_after) values ('${U1}', 'admin_credit', 1, 1)`), 'permission denied');
    await fails(db.query(`select * from public.game_sessions`), 'permission denied');
    await fails(db.query(`select * from public.admin_steam_ids`), 'permission denied');
    await fails(db.query(`select public._take('${U1}', 1)`), 'permission denied');
    await fails(db.query(`select public._credit('${U1}', 'slots', 0, 999999, '{}')`), 'permission denied');
    await fails(db.query(`select public._rand_int(2)`), 'permission denied');
    // les fonctions publiques restent utilisables
    await give(U1, 1000).catch(() => {});
  } finally {
    await db.exec(`reset role`);
  }
});

test('l\'admin voit tous les joueurs, les stats et peut régler les limites', async () => {
  await as(ADM);
  const players = await rpc('admin_list_players', null);
  assert.equal(players.length, 3);
  const found = await rpc('admin_list_players', 'tanji');
  assert.equal(found.length, 1);
  const stats = await rpc('admin_stats');
  assert.equal(stats.games.length, 10);
  assert.equal(Number(stats.players), 3);
  const slots = stats.games.find((g) => g.game === 'slots');
  assert.ok(Number(slots.rounds) >= N);
  const recent = await rpc('admin_recent_transactions', 20);
  assert.equal(recent.length, 20);

  await rpc('admin_set_game_config', 'slots', 50, 500, true);
  await as(U2);
  await give(U2, 10000);
  await fails(rpc('play_instant', 'slots', 10, '{}'), 'invalid_bet');
  await fails(rpc('play_instant', 'slots', 501, '{}'), 'invalid_bet');
  await rpc('play_instant', 'slots', 50, '{}');
  await as(ADM);
  await rpc('admin_set_game_config', 'slots', 50, 500, false);
  await as(U2);
  await fails(rpc('play_instant', 'slots', 50, '{}'), 'game_disabled');
  await as(ADM);
  await fails(rpc('admin_set_game_config', 'slots', 0, 10, true), 'invalid_bet');
  await fails(rpc('admin_set_game_config', 'nope', 10, 100, true), 'unknown_game');
});

test('classement : top joueurs sans données sensibles', async () => {
  await as(U1);
  await give(U1, 777);
  const lb = await rpc('leaderboard');
  assert.ok(lb.length >= 1);
  assert.deepEqual(Object.keys(lb[0]).sort(), ['avatar_url', 'balance', 'display_name']);
  const bals = lb.map((x) => Number(x.balance));
  assert.deepEqual(bals, [...bals].sort((a, b) => b - a));
});

test('ajouter un admin via la table met à jour is_admin', async () => {
  await db.exec(`insert into public.admin_steam_ids values ('76561198000000002')`);
  let r = await db.query(`select is_admin from public.profiles where id = '${U2}'`);
  assert.equal(r.rows[0].is_admin, true);
  await db.exec(`delete from public.admin_steam_ids where steam_id = '76561198000000002'`);
  r = await db.query(`select is_admin from public.profiles where id = '${U2}'`);
  assert.equal(r.rows[0].is_admin, false);
});
