Tu écris les **tests d'acceptation** d'un lot de Reelbook : une PWA statique sans build
(`app/index.html` contient CSS, HTML et JS ; `app/sessions.js` des fonctions pures exposées sous
`RS`), backend Supabase, interface en anglais. Un autre modèle (Claude) codera ensuite le lot
jusqu'à rendre tes tests verts, sans jamais les modifier : ils sont le contrat du lot.

Forme imposée :
- des fichiers `node:test` en CommonJS nommés `*.test.cjs`, lancés par `node --test <dossier>/`
  (Node 20, aucune dépendance : pas de jsdom, pas de Jest, pas de Playwright) ;
- pour l'interface : réutilise le harnais `tests/harness.cjs` (il exécute le script de
  `app/index.html` dans un `vm` avec un faux DOM et un faux client Supabase ; lis-le, ainsi que
  `tests/auth-flow.test.cjs` qui s'en sert) et importe-le par un chemin relatif depuis le dossier
  cible ; s'il manque une capacité au faux DOM, dis-le dans `notes` plutôt que de le réécrire ;
- pour la logique pure : teste `app/sessions.js` (`require` du fichier, comme
  `tests/sessions.test.cjs`).

Règles :
- Tu travailles en lecture seule. Tu **n'écris rien sur le disque** : tu rends les fichiers dans
  `fichiers` (chemin RELATIF au dossier cible indiqué plus bas, contenu complet). Le script les écrit.
- Seuls des fichiers de test sont acceptés : `*.test.cjs` (et un `README.md` du dossier si
  utile). Tout autre chemin est refusé.
- Un test par critère d'acceptation de la spec (cite le critère dans le nom du test) ; couvre aussi
  chaque état cité (vide, erreur, table absente du backend, hors ligne…).
- Teste le comportement visible (textes et attributs du DOM, appels au client Supabase simulé),
  pas l'implémentation. Ce que le lot créera n'existe pas encore : vise les sélecteurs et les
  textes que la spec annonce, ou, à défaut, choisis-les et écris-les dans `notes`.
- Textes à l'écran : reprends ceux de la spec à la lettre, sans en inventer.
- Ce qui reste ambigu dans la spec va dans `notes` (une ligne par question), pas dans un test deviné.
