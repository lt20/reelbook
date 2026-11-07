# Visuels de l’accueil : MMA

Images **générées** (Codex, 5-6 nov. 2026) pour l’accueil v3 (lot L36, `app/landing.js`), copiées de
`outputs/site-artifact/img/` (hors dépôt, mêmes noms). Scènes fictives : aucune image n’est une capture d’une vidéo
tierce ; les poses de certaines séquences suivent une vidéo de référence, la personne, les vêtements et le lieu
sont remplacés (voir `docs/audit-design/lots/L36.md`). Laurent a validé leur publication dans le dépôt public (6 nov.).

- `<nom>.jpg` : étape d’une séquence (la fiche animée, le téléphone de partage, Chrome), 640 px de large.
- `<nom>-t.jpg` : vignette (séances, tablette, téléphone, progression), 240 px de large.

Refaire : `sips --resampleWidth 640 -s format jpeg -s formatOptions 70 <source> --out <nom>.jpg` (240 et `-t` pour une
vignette ; jamais `sips -c`, qui recadre au centre). La liste et les poids sont dans `image-map.json`. Ces fichiers ne
sont pas dans le cache de l’app (`app/sw.js`) : ils se chargent à la demande.
