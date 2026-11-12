# 🎴 Casino de la Brigade Finance Relation

Casino en ligne pour le RP Demon Slayer. **Monnaie fictive uniquement** : aucun paiement, aucun moyen de paiement, aucun achat de jetons.

- **Connexion Steam** : les jetons sont rattachés au SteamID64, donc impossibles à perdre.
- **10 jeux** réglés entre 90 % et 98 % de retour aux joueurs : le joueur peut gagner régulièrement, la banque gagne à long terme.
- **Tout est côté serveur** (Supabase) : le navigateur ne peut ni modifier un solde ni choisir un résultat.
- **Panneau admin** (`/admin.html`) : le staff donne ou retire des jetons, consulte les stats et règle les mises.
- Pas de capital de départ ni de bonus quotidien pour l'instant : tout nouveau joueur commence à 0.

## Les jeux

| Jeu | Chances de gagner | Gain | Retour (RTP) |
|---|---|---|---|
| Chō-Han (dés) · *Chō-Han des Hashira* | 50 % | ×1,9 | 95 % |
| Roulette (38 cases) · *Roulette de la Lune* | 47,4 % couleur/parité · 2,6 % numéro | ×2 · ×36 | 94,7 % |
| Blackjack · *Vingt-et-un de la Brigade* | ≈ 43 % | ×2 · blackjack ×2,5 | ≈ 97-99 % |
| Machine à sous · *Les Cinq Respirations* | 22 % (+ 25 % remboursé) | jusqu'à ×20 | 91 % |
| Carte à gratter · *Cartes Hanafuda* | 20 % (+ 10 % remboursé) | jusqu'à ×30 | 93 % |
| Course de corbeaux · *Corbeaux Kasugai* | 16,7 % victoire · 50 % podium | ×5,5 · ×1,8 | 91,7 % · 90 % |
| Bonneteau (3 gobelets) · *Trois coupes, une Nichirin* | 33 % | ×2,7 | 90 % |
| Bataille · *Bataille des Piliers* | 46 % | ×2 (égalité = banque) | 92,3 % |
| Roue de la fortune · *Roue du destin de Muzan* | 30 % (+ 20 % remboursé) | jusqu'à ×6 | 92,5 % |
| Quitte ou double · *Glycine* | 45 % par étape | ×2, ×4, ×8 | 90 % → 73 % |

Chaque jeu a une fenêtre « Comment jouer ? » (règles, gains et chances), ouverte automatiquement à la première visite.

Les taux sont vérifiés par des tests automatiques (10 000 manches par jeu, `npm test`).

## Mise en ligne (une seule fois)

### 1. Supabase

1. Crée un projet sur [supabase.com](https://supabase.com).
2. **SQL Editor** : colle le contenu de `supabase/migrations/001_init.sql` et clique sur *Run*.
   Si tu avais déjà lancé une ancienne version, lance aussi `002_game_names.sql` (met à jour les noms des jeux).
3. **Authentication > Sign In / Providers** :
   - laisse le fournisseur **Email** activé (la connexion Steam s'en sert en interne) ;
   - désactive **Allow new users to sign up** : seuls les comptes créés via Steam existent.
4. **Project Settings > API** : note l'URL du projet, la clé `anon` et la clé `service_role`.

### 2. GitHub

Pousse ce dossier sur un dépôt GitHub (public ou privé).

### 3. Netlify

1. **Add new site > Import an existing project**, choisis le dépôt GitHub. Les réglages viennent de `netlify.toml` (rien à saisir).
2. **Site configuration > Environment variables** : ajoute (voir `.env.example`)
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (secrète)
   - `STEAM_API_KEY` (optionnelle : pseudo et avatar Steam)
3. Lance un nouveau déploiement (*Deploys > Trigger deploy*).

### 4. Premier lancement

1. Ouvre le site et connecte-toi avec Steam : le SteamID `76561199213350970` est administrateur d'office.
2. Va sur `/admin.html` pour donner des jetons aux joueurs. Un joueur apparaît dans la liste après sa **première connexion**.

## Ajouter ou retirer un administrateur

Dans le **SQL Editor** de Supabase :

```sql
insert into public.admin_steam_ids (steam_id) values ('76561198XXXXXXXXX');   -- ajouter
delete from public.admin_steam_ids where steam_id = '76561198XXXXXXXXX';       -- retirer
```

Le changement s'applique immédiatement, même si le joueur existe déjà.

## Développement local

```bash
npm install
npm test            # logique des jeux (vrai PostgreSQL embarqué) et connexion Steam
npm run build       # copie supabase-js dans public/vendor
npx netlify dev     # site + fonctions (nécessite un fichier .env, voir .env.example)
```

## Sécurité

- Les tables sont fermées au navigateur : lecture de ses propres données seulement (RLS), **aucune écriture directe**.
- Tirages (`gen_random_uuid`, aléatoire cryptographique de PostgreSQL), mises, gains et soldes sont calculés dans des fonctions SQL ; le solde ne peut pas devenir négatif.
- Le blackjack et le quitte-ou-double gardent leur état côté serveur (la carte cachée du croupier n'est jamais envoyée avant la fin).
- Connexion Steam OpenID vérifiée auprès de Steam (signature, adresse de retour, champs signés, SteamID) ; la clé `service_role` n'est utilisée que dans les fonctions Netlify.
- Chaque manche et chaque ajustement du staff est enregistré dans l'historique.

## Dépannage

- **« Le site n'est pas encore configuré »** : variables d'environnement Netlify manquantes (puis redéployer).
- **Erreur à la connexion après Steam** : vérifie `SUPABASE_SERVICE_ROLE_KEY` et que la migration SQL a bien été exécutée. Les logs sont dans *Netlify > Functions > steam-callback*.
- **Un joueur n'apparaît pas dans l'admin** : il doit s'être connecté au moins une fois.

## Structure

```
public/              site (HTML/CSS/JS sans compilation)
netlify/functions/   connexion Steam (OpenID) + configuration publique
netlify/lib/         vérification Steam
supabase/migrations/ base de données, jeux, sécurité
tests/               tests automatiques
```
