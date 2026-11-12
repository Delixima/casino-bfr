-- ============================================================================
-- Casino de la Brigade Finance Relation - schéma Supabase
-- Monnaie fictive (jetons) UNIQUEMENT. Aucun moyen de paiement réel.
-- Tout (soldes, tirages, mises) est géré côté serveur : le navigateur ne peut
-- ni modifier un solde ni choisir un résultat.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- SteamID64 des administrateurs (staff de la brigade)
create table if not exists public.admin_steam_ids (
  steam_id text primary key
);
insert into public.admin_steam_ids (steam_id) values ('76561199213350970')
  on conflict do nothing;

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  steam_id     text not null unique,
  display_name text not null default 'Joueur',
  avatar_url   text,
  balance      bigint not null default 0 check (balance >= 0),
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now(),
  last_login   timestamptz not null default now()
);

create table if not exists public.game_config (
  game     text primary key,
  label    text not null,
  min_bet  bigint not null default 10 check (min_bet > 0),
  max_bet  bigint not null default 10000 check (max_bet >= min_bet),
  enabled  boolean not null default true,
  sort     int not null default 0
);

insert into public.game_config (game, label, sort) values
  ('chohan',    'Chō-Han des Hashira',            1),
  ('roulette',  'Roulette de la Lune',            2),
  ('blackjack', 'Vingt-et-un de la Brigade',      3),
  ('slots',     'Les Cinq Respirations',          4),
  ('scratch',   'Cartes Hanafuda',                5),
  ('ravens',    'Course des Corbeaux Kasugai',    6),
  ('cups',      'Trois Coupes, une Nichirin',     7),
  ('war',       'Bataille des Piliers',           8),
  ('wheel',     'Roue du Destin de Muzan',        9),
  ('double',    'Quitte ou double de la Glycine', 10)
on conflict (game) do nothing;

create table if not exists public.transactions (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('game', 'admin_credit', 'admin_debit')),
  game          text,
  bet           bigint,
  payout        bigint,
  amount        bigint not null,           -- variation du solde (signée)
  balance_after bigint not null,
  details       jsonb,
  note          text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists transactions_user_idx
  on public.transactions (user_id, created_at desc);
create index if not exists transactions_created_idx
  on public.transactions (created_at desc);

-- Parties en cours (blackjack, quitte ou double). Jamais lisible par le client
-- (elle contient la carte cachée du croupier) : tout passe par des fonctions.
create table if not exists public.game_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  game       text not null,
  bet        bigint not null,
  state      jsonb not null,
  status     text not null default 'active' check (status in ('active', 'done')),
  created_at timestamptz not null default now()
);
create unique index if not exists game_sessions_one_active
  on public.game_sessions (user_id, game) where status = 'active';

-- ---------------------------------------------------------------------------
-- Admins : synchronisation automatique du drapeau is_admin
-- ---------------------------------------------------------------------------

create or replace function public._profile_set_admin() returns trigger
language plpgsql as $$
begin
  new.is_admin := exists (select 1 from public.admin_steam_ids a where a.steam_id = new.steam_id);
  return new;
end $$;

drop trigger if exists profiles_set_admin on public.profiles;
create trigger profiles_set_admin before insert on public.profiles
  for each row execute function public._profile_set_admin();

create or replace function public._admin_ids_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set is_admin = true where steam_id = new.steam_id;
    return new;
  else
    update public.profiles set is_admin = false where steam_id = old.steam_id;
    return old;
  end if;
end $$;

drop trigger if exists admin_ids_sync on public.admin_steam_ids;
create trigger admin_ids_sync after insert or delete on public.admin_steam_ids
  for each row execute function public._admin_ids_sync();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------------
-- Aléatoire : 48 bits issus de gen_random_uuid() (CSPRNG de PostgreSQL)
-- Retourne un entier uniforme dans [0, n-1].
-- ---------------------------------------------------------------------------

create or replace function public._rand_int(n int) returns int
language sql volatile as $$
  select ((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))::bit(48)::bigint) % n)::int;
$$;

-- ---------------------------------------------------------------------------
-- Gestion des jetons (fonctions internes, non appelables par le client)
-- ---------------------------------------------------------------------------

-- Retire des jetons (verrouille la ligne du joueur). Lève une erreur si solde insuffisant.
create or replace function public._take(p_uid uuid, p_amount bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_bal bigint;
begin
  select balance into v_bal from public.profiles where id = p_uid for update;
  if not found then raise exception 'no_profile'; end if;
  if v_bal < p_amount then raise exception 'insufficient_funds'; end if;
  update public.profiles set balance = balance - p_amount where id = p_uid
    returning balance into v_bal;
  return v_bal;
end $$;

-- Vérifie la mise (limites du jeu) puis la retire.
create or replace function public._debit(p_game text, p_bet bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_cfg public.game_config;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_cfg from public.game_config where game = p_game;
  if not found or not v_cfg.enabled then raise exception 'game_disabled'; end if;
  if p_bet is null or p_bet < v_cfg.min_bet or p_bet > v_cfg.max_bet then
    raise exception 'invalid_bet';
  end if;
  return public._take(v_uid, p_bet);
end $$;

-- Crédite le gain et enregistre la manche dans l'historique.
create or replace function public._credit(
  p_uid uuid, p_game text, p_bet bigint, p_payout bigint, p_details jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_bal bigint;
begin
  update public.profiles set balance = balance + p_payout where id = p_uid
    returning balance into v_bal;
  insert into public.transactions (user_id, kind, game, bet, payout, amount, balance_after, details)
    values (p_uid, 'game', p_game, p_bet, p_payout, p_payout - p_bet, v_bal, p_details);
  return v_bal;
end $$;

create or replace function public._result_of(p_bet bigint, p_payout bigint) returns text
language sql immutable as $$
  select case when p_payout > p_bet then 'win' when p_payout = p_bet then 'push' else 'lose' end;
$$;

-- ---------------------------------------------------------------------------
-- Jeux instantanés
-- ---------------------------------------------------------------------------

create or replace function public.play_instant(
  p_game text, p_bet bigint, p_choice jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_mult    numeric := 0;
  v_payout  bigint;
  v_details jsonb;
  v_bal     bigint;
  v_r       int;
  v_d1      int;
  v_d2      int;
  v_pick    text;
  v_n       int;
  v_slot    int;
  v_win     boolean;
  v_type    text;
  v_color   text;
  v_order   int[];
  v_tmp     int;
  v_j       int;
  v_i       int;
  v_pc      int;
  v_dc      int;
  v_reds    int[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_game not in ('chohan','roulette','slots','scratch','ravens','cups','war','wheel') then
    raise exception 'unknown_game';
  end if;
  p_choice := coalesce(p_choice, '{}'::jsonb);

  -- Validation des choix AVANT de prendre la mise
  v_pick := p_choice->>'pick';
  v_type := p_choice->>'type';
  if p_game = 'chohan' and (v_pick is null or v_pick not in ('pair','impair')) then
    raise exception 'invalid_choice';
  end if;
  if p_game = 'roulette' then
    if v_type is null or v_type not in ('red','black','even','odd','low','high','number') then raise exception 'invalid_choice'; end if;
    if v_type = 'number' then
      begin v_n := (p_choice->>'number')::int; exception when others then raise exception 'invalid_choice'; end;
      if v_n is null or v_n < 0 or v_n > 37 then raise exception 'invalid_choice'; end if;
    end if;
  end if;
  if p_game = 'ravens' then
    if v_type is null or v_type not in ('win','podium') then raise exception 'invalid_choice'; end if;
    begin v_n := (p_choice->>'pick')::int; exception when others then raise exception 'invalid_choice'; end;
    if v_n is null or v_n < 1 or v_n > 6 then raise exception 'invalid_choice'; end if;
  end if;
  if p_game = 'cups' then
    begin v_n := (p_choice->>'pick')::int; exception when others then raise exception 'invalid_choice'; end;
    if v_n is null or v_n < 1 or v_n > 3 then raise exception 'invalid_choice'; end if;
  end if;

  perform public._debit(p_game, p_bet);

  if p_game = 'chohan' then
    v_d1 := public._rand_int(6) + 1;
    v_d2 := public._rand_int(6) + 1;
    v_win := ((v_d1 + v_d2) % 2 = 0) = (v_pick = 'pair');
    v_mult := case when v_win then 1.9 else 0 end;
    v_details := jsonb_build_object('dice', jsonb_build_array(v_d1, v_d2),
                                    'total', v_d1 + v_d2, 'pick', v_pick, 'mult', v_mult);

  elsif p_game = 'roulette' then
    v_slot := public._rand_int(38);               -- 0..36, 37 = "00"
    v_color := case when v_slot in (0, 37) then 'green'
                    when v_slot = any (v_reds) then 'red' else 'black' end;
    v_win := case v_type
      when 'red'    then v_color = 'red'
      when 'black'  then v_color = 'black'
      when 'even'   then v_slot between 1 and 36 and v_slot % 2 = 0
      when 'odd'    then v_slot between 1 and 36 and v_slot % 2 = 1
      when 'low'    then v_slot between 1 and 18
      when 'high'   then v_slot between 19 and 36
      when 'number' then v_slot = v_n
    end;
    v_mult := case when not v_win then 0 when v_type = 'number' then 36 else 2 end;
    v_details := jsonb_build_object('slot', v_slot,
                   'label', case when v_slot = 37 then '00' else v_slot::text end,
                   'color', v_color, 'type', v_type, 'number', v_n, 'mult', v_mult);

  elsif p_game = 'slots' then
    v_r := public._rand_int(100) + 1;
    v_mult := case when v_r = 1 then 20
                   when v_r <= 4 then 5
                   when v_r <= 12 then 2
                   when v_r <= 37 then 1
                   when v_r <= 47 then 1.5
                   else 0 end;
    v_details := jsonb_build_object('roll', v_r, 'mult', v_mult);

  elsif p_game = 'scratch' then
    v_r := public._rand_int(100) + 1;
    v_mult := case when v_r = 1 then 30
                   when v_r <= 6 then 5
                   when v_r <= 20 then 2
                   when v_r <= 30 then 1
                   else 0 end;
    v_details := jsonb_build_object('roll', v_r, 'mult', v_mult);

  elsif p_game = 'ravens' then
    v_order := array[1,2,3,4,5,6];
    for v_i in reverse 6..2 loop                    -- Fisher-Yates
      v_j := public._rand_int(v_i) + 1;
      v_tmp := v_order[v_i]; v_order[v_i] := v_order[v_j]; v_order[v_j] := v_tmp;
    end loop;
    if v_type = 'win' then
      v_win := v_order[1] = v_n;
      v_mult := case when v_win then 5.5 else 0 end;
    else
      v_win := v_n = any (v_order[1:3]);
      v_mult := case when v_win then 1.8 else 0 end;
    end if;
    v_details := jsonb_build_object('order', to_jsonb(v_order), 'pick', v_n,
                                    'type', v_type, 'mult', v_mult);

  elsif p_game = 'cups' then
    v_slot := public._rand_int(3) + 1;
    v_win := v_slot = v_n;
    v_mult := case when v_win then 2.7 else 0 end;
    v_details := jsonb_build_object('winning_cup', v_slot, 'pick', v_n, 'mult', v_mult);

  elsif p_game = 'war' then
    v_pc := public._rand_int(13) + 2;               -- 2..14 (14 = As)
    v_dc := public._rand_int(13) + 2;
    v_mult := case when v_pc > v_dc then 2 else 0 end;
    v_details := jsonb_build_object('player', v_pc, 'dealer', v_dc,
                   'outcome', case when v_pc > v_dc then 'win'
                                   when v_pc = v_dc then 'tie' else 'lose' end,
                   'mult', v_mult);

  elsif p_game = 'wheel' then
    v_slot := public._rand_int(20);
    v_mult := case when v_slot = 0 then 6
                   when v_slot <= 2 then 2
                   when v_slot <= 5 then 1.5
                   when v_slot <= 9 then 1
                   else 0 end;
    v_details := jsonb_build_object('segment', v_slot, 'mult', v_mult);
  end if;

  v_payout := floor(p_bet * v_mult)::bigint;
  v_bal := public._credit(v_uid, p_game, p_bet, v_payout, v_details);

  return jsonb_build_object(
    'game', p_game, 'bet', p_bet, 'payout', v_payout,
    'result', public._result_of(p_bet, v_payout),
    'balance', v_bal, 'details', v_details);
end $$;

-- ---------------------------------------------------------------------------
-- Blackjack (sabot infini, croupier s'arrête sur tout 17, blackjack payé 3:2)
-- Actions : hit, stand, double (sur les deux premières cartes)
-- ---------------------------------------------------------------------------

create or replace function public._jint_array(p jsonb) returns int[]
language sql immutable as $$
  select coalesce(array_agg(t.v::int order by t.ord), '{}'::int[])
  from jsonb_array_elements_text(p) with ordinality as t(v, ord);
$$;

create or replace function public._bj_card() returns int
language sql volatile as $$ select public._rand_int(13) + 1; $$;   -- 1 = As, 11..13 = figures

create or replace function public._bj_value(h int[]) returns int
language plpgsql immutable as $$
declare v_total int := 0; v_aces int := 0; c int;
begin
  foreach c in array h loop
    if c = 1 then v_aces := v_aces + 1; v_total := v_total + 11;
    elsif c >= 10 then v_total := v_total + 10;
    else v_total := v_total + c; end if;
  end loop;
  while v_total > 21 and v_aces > 0 loop
    v_total := v_total - 10; v_aces := v_aces - 1;
  end loop;
  return v_total;
end $$;

create or replace function public._bj_view(
  p_player int[], p_dealer int[], p_bet bigint, p_hide boolean
) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'player', to_jsonb(p_player),
    'dealer', case when p_hide then to_jsonb(p_dealer[1:1]) else to_jsonb(p_dealer) end,
    'player_value', public._bj_value(p_player),
    'dealer_value', case when p_hide then public._bj_value(p_dealer[1:1])
                         else public._bj_value(p_dealer) end,
    'dealer_hidden', p_hide,
    'bet', p_bet,
    'can_double', p_hide and array_length(p_player, 1) = 2
  );
$$;

create or replace function public._bj_settle(
  p_sess uuid, p_uid uuid, p_bet bigint, p_player int[], p_dealer int[], p_initial boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pv int := public._bj_value(p_player);
  v_dv int;
  v_dealer int[] := p_dealer;
  v_payout bigint;
  v_why text;
  v_bal bigint;
  v_details jsonb;
  v_view jsonb;
begin
  if p_initial then
    v_dv := public._bj_value(v_dealer);
    if v_pv = 21 and v_dv = 21 then v_payout := p_bet; v_why := 'push_blackjack';
    elsif v_pv = 21 then v_payout := floor(p_bet * 2.5)::bigint; v_why := 'blackjack';
    else v_payout := 0; v_why := 'dealer_blackjack'; end if;
  elsif v_pv > 21 then
    v_payout := 0; v_why := 'bust';
  else
    while public._bj_value(v_dealer) < 17 loop
      v_dealer := v_dealer || public._bj_card();
    end loop;
    v_dv := public._bj_value(v_dealer);
    if v_dv > 21 then v_payout := p_bet * 2; v_why := 'dealer_bust';
    elsif v_pv > v_dv then v_payout := p_bet * 2; v_why := 'higher';
    elsif v_pv = v_dv then v_payout := p_bet; v_why := 'push';
    else v_payout := 0; v_why := 'lower'; end if;
  end if;

  v_view := public._bj_view(p_player, v_dealer, p_bet, false);
  v_details := v_view || jsonb_build_object('why', v_why);
  v_bal := public._credit(p_uid, 'blackjack', p_bet, v_payout, v_details);
  update public.game_sessions set status = 'done',
    state = jsonb_build_object('player', to_jsonb(p_player), 'dealer', to_jsonb(v_dealer))
    where id = p_sess;

  return jsonb_build_object('game', 'blackjack', 'finished', true,
    'result', public._result_of(p_bet, v_payout), 'why', v_why,
    'bet', p_bet, 'payout', v_payout, 'balance', v_bal,
    'details', v_view);
end $$;

create or replace function public.bj_start(p_bet bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_player int[]; v_dealer int[]; v_sess uuid; v_bal bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.game_sessions
             where user_id = v_uid and game = 'blackjack' and status = 'active') then
    raise exception 'game_in_progress';
  end if;
  v_bal := public._debit('blackjack', p_bet);
  v_player := array[public._bj_card(), public._bj_card()];
  v_dealer := array[public._bj_card(), public._bj_card()];
  insert into public.game_sessions (user_id, game, bet, state)
    values (v_uid, 'blackjack', p_bet,
            jsonb_build_object('player', to_jsonb(v_player), 'dealer', to_jsonb(v_dealer)))
    returning id into v_sess;

  if public._bj_value(v_player) = 21 or public._bj_value(v_dealer) = 21 then
    return public._bj_settle(v_sess, v_uid, p_bet, v_player, v_dealer, true);
  end if;
  return jsonb_build_object('game', 'blackjack', 'finished', false, 'balance', v_bal,
    'details', public._bj_view(v_player, v_dealer, p_bet, true)
               || jsonb_build_object('can_double', true));
end $$;

create or replace function public.bj_action(p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  s public.game_sessions;
  v_player int[]; v_dealer int[]; v_bet bigint; v_bal bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_action not in ('hit','stand','double') then raise exception 'invalid_action'; end if;
  select * into s from public.game_sessions
    where user_id = v_uid and game = 'blackjack' and status = 'active' for update;
  if not found then raise exception 'no_active_game'; end if;

  v_player := public._jint_array(s.state->'player');
  v_dealer := public._jint_array(s.state->'dealer');
  v_bet := s.bet;

  if p_action = 'hit' then
    v_player := v_player || public._bj_card();
    if public._bj_value(v_player) >= 21 then
      -- 21 ou plus : la main se termine automatiquement
      return public._bj_settle(s.id, v_uid, v_bet, v_player, v_dealer, false);
    end if;
    update public.game_sessions set
      state = jsonb_build_object('player', to_jsonb(v_player), 'dealer', to_jsonb(v_dealer))
      where id = s.id;
    select balance into v_bal from public.profiles where id = v_uid;
    return jsonb_build_object('game', 'blackjack', 'finished', false, 'balance', v_bal,
      'details', public._bj_view(v_player, v_dealer, v_bet, true));

  elsif p_action = 'double' then
    if array_length(v_player, 1) <> 2 then raise exception 'cannot_double'; end if;
    perform public._take(v_uid, v_bet);
    v_bet := v_bet * 2;
    v_player := v_player || public._bj_card();
    update public.game_sessions set bet = v_bet where id = s.id;
    return public._bj_settle(s.id, v_uid, v_bet, v_player, v_dealer, false);

  else -- stand
    return public._bj_settle(s.id, v_uid, v_bet, v_player, v_dealer, false);
  end if;
end $$;

create or replace function public.bj_current() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); s public.game_sessions; v_player int[]; v_dealer int[]; v_bal bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into s from public.game_sessions
    where user_id = v_uid and game = 'blackjack' and status = 'active';
  if not found then return null; end if;
  v_player := public._jint_array(s.state->'player');
  v_dealer := public._jint_array(s.state->'dealer');
  select balance into v_bal from public.profiles where id = v_uid;
  return jsonb_build_object('game', 'blackjack', 'finished', false, 'balance', v_bal,
    'details', public._bj_view(v_player, v_dealer, s.bet, true)
               || jsonb_build_object('can_double', array_length(v_player, 1) = 2));
end $$;

-- ---------------------------------------------------------------------------
-- Quitte ou double de la Glycine : 45 % de réussite par étape, 3 étapes max
-- ---------------------------------------------------------------------------

create or replace function public._double_view(p_step int, p_bet bigint) returns jsonb
language sql immutable as $$
  select jsonb_build_object('step', p_step, 'max_steps', 3, 'bet', p_bet,
    'current', p_bet * (2 ^ p_step)::bigint,
    'next', p_bet * (2 ^ (p_step + 1))::bigint,
    'can_cash', p_step >= 1);
$$;

create or replace function public.qd_start(p_bet bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_bal bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.game_sessions
             where user_id = v_uid and game = 'double' and status = 'active') then
    raise exception 'game_in_progress';
  end if;
  v_bal := public._debit('double', p_bet);
  insert into public.game_sessions (user_id, game, bet, state)
    values (v_uid, 'double', p_bet, jsonb_build_object('step', 0));
  return jsonb_build_object('game', 'double', 'finished', false, 'balance', v_bal,
                            'details', public._double_view(0, p_bet));
end $$;

create or replace function public.qd_step() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); s public.game_sessions;
  v_step int; v_payout bigint; v_bal bigint; v_ok boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into s from public.game_sessions
    where user_id = v_uid and game = 'double' and status = 'active' for update;
  if not found then raise exception 'no_active_game'; end if;
  v_step := (s.state->>'step')::int;
  v_ok := public._rand_int(100) < 45;

  if not v_ok then
    v_bal := public._credit(v_uid, 'double', s.bet, 0,
      jsonb_build_object('steps', v_step, 'failed_at', v_step + 1));
    update public.game_sessions set status = 'done' where id = s.id;
    return jsonb_build_object('game', 'double', 'finished', true, 'result', 'lose',
      'bet', s.bet, 'payout', 0, 'balance', v_bal,
      'details', public._double_view(v_step, s.bet) || jsonb_build_object('failed', true));
  end if;

  v_step := v_step + 1;
  if v_step >= 3 then
    v_payout := s.bet * (2 ^ v_step)::bigint;
    v_bal := public._credit(v_uid, 'double', s.bet, v_payout,
      jsonb_build_object('steps', v_step, 'cashed', true));
    update public.game_sessions set status = 'done', state = jsonb_build_object('step', v_step)
      where id = s.id;
    return jsonb_build_object('game', 'double', 'finished', true, 'result', 'win',
      'bet', s.bet, 'payout', v_payout, 'balance', v_bal,
      'details', public._double_view(v_step, s.bet) || jsonb_build_object('maxed', true));
  end if;

  update public.game_sessions set state = jsonb_build_object('step', v_step) where id = s.id;
  select balance into v_bal from public.profiles where id = v_uid;
  return jsonb_build_object('game', 'double', 'finished', false, 'balance', v_bal,
                            'details', public._double_view(v_step, s.bet));
end $$;

create or replace function public.qd_cash() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); s public.game_sessions;
  v_step int; v_payout bigint; v_bal bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into s from public.game_sessions
    where user_id = v_uid and game = 'double' and status = 'active' for update;
  if not found then raise exception 'no_active_game'; end if;
  v_step := (s.state->>'step')::int;
  if v_step < 1 then raise exception 'nothing_to_cash'; end if;
  v_payout := s.bet * (2 ^ v_step)::bigint;
  v_bal := public._credit(v_uid, 'double', s.bet, v_payout,
    jsonb_build_object('steps', v_step, 'cashed', true));
  update public.game_sessions set status = 'done' where id = s.id;
  return jsonb_build_object('game', 'double', 'finished', true, 'result', 'win',
    'bet', s.bet, 'payout', v_payout, 'balance', v_bal,
    'details', public._double_view(v_step, s.bet));
end $$;

create or replace function public.qd_current() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); s public.game_sessions; v_bal bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into s from public.game_sessions
    where user_id = v_uid and game = 'double' and status = 'active';
  if not found then return null; end if;
  select balance into v_bal from public.profiles where id = v_uid;
  return jsonb_build_object('game', 'double', 'finished', false, 'balance', v_bal,
    'details', public._double_view((s.state->>'step')::int, s.bet));
end $$;

-- ---------------------------------------------------------------------------
-- Classement public (pseudo, avatar, solde uniquement)
-- ---------------------------------------------------------------------------

create or replace function public.leaderboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('display_name', display_name,
                                        'avatar_url', avatar_url, 'balance', balance)
                     order by balance desc)
    from (select display_name, avatar_url, balance from public.profiles
          where balance > 0 order by balance desc limit 20) t
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Administration (réservé aux SteamID de admin_steam_ids)
-- ---------------------------------------------------------------------------

create or replace function public._require_admin() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
end $$;

create or replace function public.admin_list_players(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.last_login desc)
    from (
      select id, steam_id, display_name, avatar_url, balance, is_admin, created_at, last_login
      from public.profiles
      where p_search is null or p_search = ''
         or steam_id ilike '%' || p_search || '%'
         or display_name ilike '%' || p_search || '%'
      order by last_login desc limit 200
    ) t
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_adjust_balance(
  p_steam_id text, p_amount bigint, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := auth.uid(); v_target public.profiles; v_bal bigint;
begin
  perform public._require_admin();
  if p_amount is null or p_amount = 0 then raise exception 'invalid_amount'; end if;
  select * into v_target from public.profiles where steam_id = p_steam_id for update;
  if not found then raise exception 'player_not_found'; end if;
  if v_target.balance + p_amount < 0 then raise exception 'insufficient_funds'; end if;
  update public.profiles set balance = balance + p_amount where id = v_target.id
    returning balance into v_bal;
  insert into public.transactions (user_id, kind, amount, balance_after, note, created_by)
    values (v_target.id, case when p_amount > 0 then 'admin_credit' else 'admin_debit' end,
            p_amount, v_bal, p_note, v_admin);
  return jsonb_build_object('steam_id', p_steam_id, 'display_name', v_target.display_name,
                            'balance', v_bal);
end $$;

create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
        'game', g.game, 'label', g.label,
        'rounds', coalesce(s.rounds, 0), 'wagered', coalesce(s.wagered, 0),
        'paid', coalesce(s.paid, 0), 'house_profit', coalesce(s.wagered, 0) - coalesce(s.paid, 0))
        order by g.sort)
      from public.game_config g
      left join (
        select game, count(*) rounds, sum(bet) wagered, sum(payout) paid
        from public.transactions where kind = 'game' group by game
      ) s on s.game = g.game
    ), '[]'::jsonb),
    'players', (select count(*) from public.profiles),
    'tokens_in_circulation', (select coalesce(sum(balance), 0) from public.profiles)
  );
end $$;

create or replace function public.admin_recent_transactions(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.created_at desc)
    from (
      select x.id, x.kind, x.game, x.bet, x.payout, x.amount, x.balance_after, x.note, x.created_at,
             p.display_name, p.steam_id
      from public.transactions x join public.profiles p on p.id = x.user_id
      order by x.created_at desc, x.id desc
      limit least(greatest(coalesce(p_limit, 100), 1), 500)
    ) t
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_set_game_config(
  p_game text, p_min bigint, p_max bigint, p_enabled boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin();
  if p_min is null or p_max is null or p_min <= 0 or p_max < p_min then
    raise exception 'invalid_bet';
  end if;
  update public.game_config set min_bet = p_min, max_bet = p_max, enabled = coalesce(p_enabled, true)
    where game = p_game;
  if not found then raise exception 'unknown_game'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Sécurité : RLS + permissions
-- ---------------------------------------------------------------------------

alter table public.admin_steam_ids enable row level security;
alter table public.profiles        enable row level security;
alter table public.game_config     enable row level security;
alter table public.transactions    enable row level security;
alter table public.game_sessions   enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists game_config_select on public.game_config;
create policy game_config_select on public.game_config
  for select to authenticated using (true);

-- Aucune écriture directe depuis le navigateur, jamais.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.profiles, public.transactions, public.game_config to authenticated;

grant execute on function
  public.is_admin(),   -- appelée par les politiques RLS avec les droits du joueur
  public.play_instant(text, bigint, jsonb),
  public.bj_start(bigint), public.bj_action(text), public.bj_current(),
  public.qd_start(bigint), public.qd_step(), public.qd_cash(), public.qd_current(),
  public.leaderboard(),
  public.admin_list_players(text),
  public.admin_adjust_balance(text, bigint, text),
  public.admin_stats(),
  public.admin_recent_transactions(int),
  public.admin_set_game_config(text, bigint, bigint, boolean)
to authenticated;
