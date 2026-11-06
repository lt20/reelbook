# Visuels de démonstration MMA

Emplacements MMA de l'accueil (L30, `app/landing.js`). Tant qu'aucune photo n'est listée dans `image-map.json`, la
page dessine des silhouettes (jamais une capture d'une vidéo tierce : dépôt public, décision 4). Les photos prévues
sont **générées** (décision 19 mise à jour, 4 nov.) : des scènes fictives, jamais créditées comme des captures
Instagram ni comme une démonstration technique certifiée.

## Remplacer les dessins, sans toucher au code

1. Déposer les fichiers ci-dessous dans ce dossier (mêmes formats que `app/assets/dance/`).
2. Les lister dans `image-map.json` : `steps` (les six étapes, dans l'ordre : la fiche n'utilise les photos que
   si les six y sont) et `cards` (une entrée par carte, la clé est celle de l'exemple ; une carte absente reste
   dessinée). Chemins relatifs à ce dossier, sans `..` ni adresse : la page refuse le reste.
3. Bumper `VERSION` de `app/sw.js` n'est pas nécessaire (ces fichiers ne sont pas dans le cache de l'app).

```json
{
  "steps": [
    "coup-de-pied-tournant-foie/01-en-garde.jpg",
    "coup-de-pied-tournant-foie/02-pieds-croises.jpg",
    "coup-de-pied-tournant-foie/03-le-tour.jpg",
    "coup-de-pied-tournant-foie/04-genou.jpg",
    "coup-de-pied-tournant-foie/05-coup-de-pied.jpg",
    "coup-de-pied-tournant-foie/06-sur-la-pao.jpg"
  ],
  "cards": {
    "kick": "coup-de-pied-tournant-foie/card.jpg",
    "neck": "prise-de-nuque-card.jpg",
    "osoto": "osoto-gari-card.jpg",
    "crav": "sortie-cravate-debout-card.jpg",
    "foot": "footwork-cerceau-card.jpg",
    "hips": "flow-hanches-card.jpg"
  }
}
```

## Fichiers attendus

| Clé | Fichier | Contenu | Format |
| --- | --- | --- | --- |
| étape 1 | `coup-de-pied-tournant-foie/01-en-garde.jpg` | En garde, pieds écartés, face à la cible | portrait 4:5, 820 px de haut au plus |
| étape 2 | `coup-de-pied-tournant-foie/02-pieds-croises.jpg` | Les pieds se croisent avant de tourner | idem |
| étape 3 | `coup-de-pied-tournant-foie/03-le-tour.jpg` | Le tour sur les pieds croisés, regard vers la cible (sert aussi à « Tes notes ») | idem |
| étape 4 | `coup-de-pied-tournant-foie/04-genou.jpg` | Le genou monte en fin de tour | idem |
| étape 5 | `coup-de-pied-tournant-foie/05-coup-de-pied.jpg` | Jambe tendue vers le foie, buste qui bascule | idem |
| étape 6 | `coup-de-pied-tournant-foie/06-sur-la-pao.jpg` | Même geste sur la pao tenue par un partenaire | idem |
| `kick` | `coup-de-pied-tournant-foie/card.jpg` | Coup de pied tournant au foie (carnet, route, nouveautés) | paysage 3:2, 720 px de large au plus |
| `neck` | `prise-de-nuque-card.jpg` | Prise de nuque : le genou à la ceinture | idem |
| `osoto` | `osoto-gari-card.jpg` | Osoto gari en MMA | idem |
| `crav` | `sortie-cravate-debout-card.jpg` | Sortir d'une cravate debout | idem |
| `foot` | `footwork-cerceau-card.jpg` | Footwork boxe : le pas dans le cerceau | idem |
| `hips` | `flow-hanches-card.jpg` | Flow hanches (fiche Yoga, reprise aussi par la séance de l'exemple danse) | idem |

JPEG qualité ~78 (`sips -Z 820 -s formatOptions 78` pour une étape, `-Z 720` pour une carte). La page affiche
« Vue MMA : images de démonstration générées, pas une vraie vidéo. » dès que les six étapes sont listées.
