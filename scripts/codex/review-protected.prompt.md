
## Zone protégée

Cette PR touche une zone protégée de Reelbook (fichiers listés plus bas). Ton verdict `ok`
**autorise le merge**, et le merge publie l'app sans regard humain. Laurent pousse lui-même
`supabase/schema.sql` sur le projet hébergé (`db push`), parfois longtemps après le merge. Sois
exigeant :
- `supabase/schema.sql` : destructif (DROP, TRUNCATE, DELETE, suppression ou changement de type
  de colonne, renommage) ? table nouvelle sans `enable row level security` ou sans policy « own
  rows » (`auth.uid() = user_id`) ? policy `using (true)` ou `to public` ? `SECURITY DEFINER` sans
  `set search_path = ''` ? script non rejouable (`create table` sans `if not exists`, policy recréée
  sans `drop policy if exists`) ou qui échoue sur une base déjà peuplée (NOT NULL sans défaut,
  contrainte unique sur des doublons existants) ? l'app publiée avant le `db push` marche-t-elle
  encore sur l'ancien schéma ?
- `app/config.js`, `app/install.sh`, `app/install.ps1` : clé autre que la clé publique (anon) en
  clair, URL de backend changée pour tous les utilisateurs, installeur qui écrase la configuration
  ou les fiches d'un utilisateur existant, commande téléchargée et exécutée sans contrôle ;
- `tools/rb.py` : écriture dans le backend d'un autre utilisateur, suppression ou réécriture de
  fiches existantes, jeton ou mot de passe journalisé ou écrit en clair ;
- `.github/` : élargissement de droits, secret exposé, workflow qui s'exécute sur du code non relu.
La règle de sévérité ci-dessus vaut ici aussi : un point `bloquant` décrit son scénario concret
(`Scénario : <entrée> → <effet>`) ; une réponse vide ou évasive sur les données existantes reste
bloquante en soi.

Réponds obligatoirement, dans `donnees_existantes`, à la question :
**« Que se passe-t-il pour les données existantes et les utilisateurs au déploiement ? »** — ligne
par ligne si besoin : ce qui est conservé, transformé, perdu ; si une sauvegarde suffit à revenir en
arrière ; ce que voit un utilisateur dont l'app est déjà publiée mais dont le backend n'a pas encore
reçu le nouveau schéma (ou l'inverse). Une réponse vide ou évasive rend la revue `bloquant`.
