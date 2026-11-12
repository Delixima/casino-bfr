-- Bonneteau en jeu d'adresse : la lame est mélangée sous les yeux du joueur.
-- À exécuter dans le SQL Editor si 001 a déjà été lancée. Rejouable sans risque.

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
  if p_game not in ('chohan','roulette','slots','scratch','ravens','war','wheel') then
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
-- Bonneteau (3 coupes) : la lame est montrée, puis les coupes sont mélangées
-- sous les yeux du joueur, qui doit la suivre. Le serveur décide de la
-- position de départ et de la suite d'échanges (donc de la position finale) ;
-- il garde la position finale et vérifie le choix du joueur à la fin.
-- Gain : x1,6 (jeu d'adresse : un bon joueur gagne plus souvent que le hasard).
-- ---------------------------------------------------------------------------

create or replace function public.cups_start(p_bet bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_bal   bigint;
  v_start int;
  v_pos   int;
  v_n     int;
  v_i     int;
  v_p     int;
  v_prev  int := -1;
  v_a     int;
  v_b     int;
  v_swaps jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.game_sessions
             where user_id = v_uid and game = 'cups' and status = 'active') then
    raise exception 'game_in_progress';
  end if;
  v_bal := public._debit('cups', p_bet);

  v_start := public._rand_int(3) + 1;              -- coupe qui cache la lame au départ
  v_pos := v_start;
  v_n := 24 + public._rand_int(9);                 -- 24 à 32 échanges
  for v_i in 1..v_n loop
    loop                                           -- jamais deux fois le même échange de suite
      v_p := public._rand_int(3);
      exit when v_p <> v_prev;
    end loop;
    v_prev := v_p;
    v_a := case when v_p = 2 then 2 else 1 end;    -- 0:(1,2)  1:(1,3)  2:(2,3)
    v_b := case when v_p = 0 then 2 else 3 end;
    if v_pos = v_a then v_pos := v_b; elsif v_pos = v_b then v_pos := v_a; end if;
    v_swaps := v_swaps || jsonb_build_array(jsonb_build_array(v_a, v_b));
  end loop;

  insert into public.game_sessions (user_id, game, bet, state)
    values (v_uid, 'cups', p_bet, jsonb_build_object('final', v_pos));

  return jsonb_build_object('game', 'cups', 'finished', false, 'balance', v_bal,
    'details', jsonb_build_object('start', v_start, 'swaps', v_swaps));
end $$;

create or replace function public.cups_pick(p_pick int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  s public.game_sessions;
  v_final int; v_win boolean; v_payout bigint; v_bal bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_pick is null or p_pick < 1 or p_pick > 3 then raise exception 'invalid_choice'; end if;
  select * into s from public.game_sessions
    where user_id = v_uid and game = 'cups' and status = 'active' for update;
  if not found then raise exception 'no_active_game'; end if;

  v_final := (s.state->>'final')::int;
  v_win := p_pick = v_final;
  v_payout := case when v_win then floor(s.bet * 1.6)::bigint else 0 end;
  v_bal := public._credit(v_uid, 'cups', s.bet, v_payout,
    jsonb_build_object('pick', p_pick, 'winning_cup', v_final, 'mult', case when v_win then 1.6 else 0 end));
  update public.game_sessions set status = 'done' where id = s.id;

  return jsonb_build_object('game', 'cups', 'finished', true,
    'result', public._result_of(s.bet, v_payout),
    'bet', s.bet, 'payout', v_payout, 'balance', v_bal,
    'details', jsonb_build_object('pick', p_pick, 'winning_cup', v_final));
end $$;

-- Partie en cours (page rechargée) : on ne renvoie jamais la position de la lame
create or replace function public.cups_current() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); s public.game_sessions; v_bal bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into s from public.game_sessions
    where user_id = v_uid and game = 'cups' and status = 'active';
  if not found then return null; end if;
  select balance into v_bal from public.profiles where id = v_uid;
  return jsonb_build_object('game', 'cups', 'finished', false, 'balance', v_bal,
    'details', jsonb_build_object('resumed', true, 'bet', s.bet));
end $$;


-- Droits : le navigateur ne peut appeler que ces fonctions
revoke all on function public.cups_start(bigint), public.cups_pick(int), public.cups_current()
  from public, anon, authenticated;
grant execute on function public.cups_start(bigint), public.cups_pick(int), public.cups_current()
  to authenticated;

-- Mise maximale plus basse par défaut pour ce jeu (seulement si tu ne l'avais pas déjà modifiée)
update public.game_config set max_bet = 1000 where game = 'cups' and max_bet = 10000;
