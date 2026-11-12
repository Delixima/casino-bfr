// Textes d'aide généraux (accueil, connexion, bouton « Aide »).
import { h } from './core.js';

export function stepsEl() {
  return h('ol', { class: 'steps3' },
    h('li', {}, h('b', {}, 'Connecte-toi avec Steam'), 'Tes jetons sont liés à ton compte : tu les retrouves sur tous tes appareils.'),
    h('li', {}, h('b', {}, 'Obtiens des jetons'), 'Ils sont donnés par le staff de la brigade Finance Relation, en RP.'),
    h('li', {}, h('b', {}, 'Choisis un jeu et joue'), 'Règle ta mise, lis la consigne affichée au-dessus du jeu, puis clique sur le gros bouton rouge.'));
}

export function helpEl() {
  const q = (title, ...text) => [h('h4', {}, title), ...text.map((t) => h('p', {}, t))];
  return h('div', { class: 'rules-doc' },
    ...q('Les jetons, c\'est quoi ?',
      'Une monnaie fictive du jeu de rôle. Il n\'y a aucun argent réel dans ce casino : on ne peut ni en acheter ni en retirer.'),
    ...q('Comment obtenir des jetons ?',
      'Demande-les au staff de la brigade Finance Relation (en RP). Ils les ajoutent à ton compte depuis leur panneau, et ils apparaissent ici tout de suite. Tu ne peux pas en acheter.'),
    ...q('Comment jouer ?'),
    h('ol', {},
      h('li', {}, 'Choisis un jeu sur la page d\'accueil. Les règles s\'affichent la première fois, et le bouton « 📖 Comment jouer ? » les rouvre.'),
      h('li', {}, 'Règle ta mise (les boutons sous la mise vont plus vite que de taper).'),
      h('li', {}, 'Fais ton choix si le jeu en demande un, puis clique sur le gros bouton rouge.'),
      h('li', {}, 'Le résultat s\'affiche, et tes jetons sont mis à jour en haut de la page.')),
    ...q('Que veut dire « ×2 », « ×1,5 » ?',
      'C\'est ce que tu reçois par rapport à ta mise, mise comprise. Avec une mise de 100 : ×2 te rend 200 (tu gagnes 100), ×1,5 te rend 150 (tu gagnes 50), « mise rendue » te rend 100 (tu ne perds rien).'),
    ...q('Mes jetons sont-ils en sécurité ?',
      'Oui : ils sont rattachés à ton compte Steam et enregistrés sur le serveur. Tu peux les retrouver depuis n\'importe quel appareil. Tout le détail de tes parties est dans l\'onglet « Historique ».'),
    ...q('Les jeux sont-ils truqués ?',
      'Non : les résultats sont tirés au sort par le serveur, et le navigateur ne peut pas les modifier. Comme dans un vrai casino, la banque garde un petit avantage : le hasard peut te sourire, mais à très long terme on perd un peu plus qu\'on ne gagne. Joue pour le plaisir.'),
    ...q('Un problème ?', 'Préviens le staff de la brigade Finance Relation en RP, avec l\'heure et le jeu concernés : ils retrouvent chaque partie dans le journal.'));
}
