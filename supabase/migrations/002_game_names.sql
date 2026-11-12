-- Noms de jeux : vrais noms de casino (le thème Demon Slayer reste dans le site).
-- À exécuter dans le SQL Editor si la migration 001 a déjà été lancée. Rejouable sans risque.

update public.game_config set label = 'Chō-Han (dés)' where game = 'chohan';
update public.game_config set label = 'Roulette' where game = 'roulette';
update public.game_config set label = 'Blackjack' where game = 'blackjack';
update public.game_config set label = 'Machine à sous' where game = 'slots';
update public.game_config set label = 'Carte à gratter' where game = 'scratch';
update public.game_config set label = 'Course de corbeaux' where game = 'ravens';
update public.game_config set label = 'Bonneteau (3 gobelets)' where game = 'cups';
update public.game_config set label = 'Bataille' where game = 'war';
update public.game_config set label = 'Roue de la fortune' where game = 'wheel';
update public.game_config set label = 'Quitte ou double' where game = 'double';
