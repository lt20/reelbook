# Visuels de l’accueil : MMA

Images **générées** pour Reelbook (accueil, `app/landing.js`) ; publication validée par le mainteneur. Scènes
fictives : aucune image n’est une capture d’une vidéo tierce ; les poses de certaines séquences suivent une vidéo de
référence, la personne, les vêtements et le lieu sont remplacés.

- `<nom>.jpg` : étape d’une séquence (la fiche animée, le téléphone de partage, Chrome), 640 px de large.
- `<nom>-t.jpg` : vignette (séances, tablette, téléphone, progression), 240 px de large.

Refaire : `sips --resampleWidth 640 -s format jpeg -s formatOptions 70 <source> --out <nom>.jpg` (240 et `-t` pour une
vignette ; jamais `sips -c`, qui recadre au centre). La liste et les poids sont dans `image-map.json`. Ces fichiers ne
sont pas dans le cache de l’app (`app/sw.js`) : ils se chargent à la demande.
