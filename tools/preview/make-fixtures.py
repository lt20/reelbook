#!/usr/bin/env python3
"""Write the synthetic preview fixtures: tests/fixtures/preview/data.json and its images.

    python3 tools/preview/make-fixtures.py            # needs Pillow (pip install pillow)

The preview (tools/preview/build.sh) shows the app on a fake backend. Its default data is this
synthetic set, committed: 4 notebooks, 30 sheets (25 in Strength, for the notebook page) built like templates/sheet.html and
templates/exercise.html, one Kitesurf sheet built like templates/technique.html (L16; French content written for the
preview), 4 video sessions with doses,
one note and 4 requests (queued, processing, error, done). Images are plain colour + label JPEGs made
here: never a frame from a real video (the repository is public).

Storage layout, as in the real bucket: files/<sheet slug>/img/<file>.jpg (the fake client maps
the signed path <user id>/<slug>/img/<file> to it).
"""
import json
import os
import sys
import textwrap
import unicodedata

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'tests', 'fixtures', 'preview')
COLOURS = {'strength': (196, 92, 62), 'yoga': (74, 140, 118), 'fight': (70, 96, 160), 'kitesurf': (36, 122, 140)}


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def step(n, img, title, text, alt):
    return (f'  <div class="step"><figure><img src="img/{img}" alt="{esc(alt)}" loading="lazy">'
            f'<span class="k">{n}</span></figure><h3>{esc(title)}</h3><p>{esc(text)}</p></div>')


def footer(src, note=''):
    return (f'<footer>Photos : images de démonstration générées pour l\'aperçu. '
            f'<a href="{esc(src["url"])}">Voir la vidéo</a>.{" " + esc(note) if note else ""}</footer>')


# Section titles. Sheets written before L15 keep the older ones (existing sheets are not reprocessed); a sheet with
# l15=True follows the L15 templates: one label per function, « Erreurs fréquentes » (.step.bad) after the steps.
OLD = {'steps': 'L\'enchaînement', 'move': 'Le mouvement', 'cues': 'Repères', 'easier': 'Version plus facile'}
L15 = {'steps': 'Étapes', 'move': 'Étapes', 'cues': 'Points clés', 'easier': 'Plus facile / plus dur'}


def mistakes(s):
    """« Erreurs fréquentes »: the wrong movement, out of the numbered steps (no number, class step bad)."""
    if not s.get('mistakes'):
        return ''
    rows = '\n'.join(f'  <div class="step bad"><figure><img src="img/x{i + 1}.jpg" alt="Erreur : {esc(a)}" loading="lazy">'
                     f'</figure><h3>{esc(t)}</h3><p>{esc(p)}</p></div>' for i, (t, p, a) in enumerate(s['mistakes']))
    return f'\n<h2>Erreurs fréquentes</h2>\n<div class="steps">\n{rows}\n</div>'


def sheet_html(s):
    """A single-exercise sheet, structure of templates/sheet.html."""
    dose = ''.join(f'  <div class="d"><b>{esc(b)}</b><span>{esc(t)}</span></div>\n' for b, t in s['dose'])
    keys = ''.join(f'  <li><b>{esc(b)}</b> {esc(t)}</li>\n' for b, t in s['keys'])
    kit = ''.join(f'<span>{esc(k)}</span>' for k in s['kit'])
    steps = '\n'.join(step(i + 1, f'0{i + 1}.jpg', t, p, a) for i, (t, p, a) in enumerate(s['steps']))
    h = L15 if s.get('l15') else OLD
    return f'''<div class="wrap fiche">
<header>
  <div>
    <p class="eyebrow">{esc(s['eyebrow'])}</p>
    <h1>{esc(s['title'])}</h1>
  </div>
  <img src="img/thumb.jpg" alt="{esc(s['title'])}" width="112" height="112">
</header>
<p class="lead">{esc(s['lead'])}</p>
<div class="kit">{kit}</div>

<h2>Pourquoi</h2>
<p>{esc(s['why'])}</p>

<h2>Dose <small>suggestion, pas dans la vidéo</small></h2>
<div class="dose">
{dose}</div>

<h2>Points clés</h2>
<ol class="keys">
{keys}</ol>
</div>

<div class="wide">
<h2>{esc(h['steps'])}</h2>
<div class="steps">
{steps}
</div>
<p class="loop"><span class="arrow">↻</span> {esc(s['loop'])}</p>{mistakes(s)}
</div>

<div class="wrap">
{footer(s['source'], s.get('note', ''))}
</div>
'''


def technique_html(s):
    """A trick worked by tries (L16), structure of templates/technique.html, profile « technique » (no roles, no tap)."""
    li = lambda xs: ''.join(f'<li>{esc(x)}</li>' for x in xs)  # noqa: E731
    kit = ''.join(f'<span>{esc(k)}</span>' for k in s['kit'])
    cond = ''.join(f'  <div class="c"><b>{esc(b)}</b><span>{esc(t)}</span></div>\n' for b, t in s['cond'])
    tries = ''.join(f'  <div class="d"><b>{esc(b)}</b><span>{esc(t)}</span></div>\n' for b, t in s['tries'])
    keys = ''.join(f'  <li><b>{esc(b)}</b> {esc(t)}</li>\n' for b, t in s['keys'])
    steps = '\n'.join(step(i + 1, f'0{i + 1}.jpg', t, p, a) for i, (t, p, a) in enumerate(s['steps']))
    return f'''<div class="wrap fiche">
<header>
  <div>
    <p class="eyebrow">{esc(s['eyebrow'])}</p>
    <h1>{esc(s['title'])}</h1>
  </div>
  <img src="img/thumb.jpg" alt="{esc(s['title'])}" width="112" height="112">
</header>
<p class="lead">{esc(s['lead'])}</p>
<div class="kit">{kit}</div>

<h2>Prérequis</h2>
<ul class="prereq">{li(s['prereq'])}</ul>

<h2>Conditions</h2>
<div class="cond">
{cond}</div>

<h2>Go / no-go</h2>
<div class="gonogo">
  <div class="go"><h3>Go</h3><ul>{li(s['go'])}</ul></div>
  <div class="nogo"><h3>No-go</h3><ul>{li(s['nogo'])}</ul></div>
</div>
</div>

<div class="wide">
<h2>Étapes</h2>
<div class="steps">
{steps}
</div>{mistakes(s)}
</div>

<div class="wrap">
<h2>Points clés</h2>
<ol class="keys">
{keys}</ol>

<h2>Plan d'essais <small>suggestion, absente de la vidéo</small></h2>
<div class="dose">
{tries}</div>
<p class="note">{esc(s['tries_note'])}</p>

<h2>Sécurité <small>conseil général, absent de la vidéo</small></h2>
<div class="safety"><ul>{li(s['safety'])}</ul></div>

{footer(s['source'])}
</div>
'''


def exercise_html(s):
    """One exercise of a video session, structure of templates/exercise.html."""
    keys = ''.join(f'  <li><b>{esc(b)}</b> {esc(t)}</li>\n' for b, t in s['keys'])
    kit = ''.join(f'<span>{esc(k)}</span>' for k in s['kit'])
    steps = '\n'.join(step(i + 1, f'0{i + 1}.jpg', t, p, a) for i, (t, p, a) in enumerate(s['steps']))
    h = L15 if s.get('l15') else OLD
    return f'''<div class="wrap fiche">
<header>
  <div>
    <p class="eyebrow">{esc(s['eyebrow'])}</p>
    <h1>{esc(s['title'])}</h1>
  </div>
  <img src="img/thumb.jpg" alt="{esc(s['title'])}" width="112" height="112">
</header>
<p class="lead">{esc(s['lead'])}</p>
<div class="kit">{kit}</div>
</div>

<div class="wide">
<h2>{esc(h['move'])}</h2>
<div class="steps">
{steps}
</div>{mistakes(s)}
</div>

<div class="wrap">
<h2>{esc(h['cues'])}</h2>
<ol class="keys">
{keys}</ol>

<h2>{esc(h['easier'])}</h2>
<p>{esc(s['easier'])}</p>

{footer(s['source'])}
</div>
'''


def src(n, platform='Instagram', author='Coach Démo'):
    url = {'Instagram': f'https://www.instagram.com/reel/PREVIEW{n:04d}/',
           'TikTok': f'https://www.tiktok.com/@coach.demo/video/{7400000000000000000 + n}',
           'YouTube': f'https://www.youtube.com/shorts/PREVIEW{n:04d}'}[platform]
    return {'author': author, 'url': url, 'platform': platform}


SHEETS = [
    dict(slug='pompes-inclinees', theme='strength', group='Chest', title='Pompes inclinées', l15=True,
         eyebrow='Pectoraux · triceps · 5 min', duration='5 min', source=src(1),
         note='Dose lue dans les commentaires.',
         mistakes=[('Bassin qui tombe', 'Le ventre s\'affaisse vers le support : serre les fessiers, épaules, hanches et talons alignés.',
                    'bassin affaissé, dos creusé')],
         summary='Mains sur un banc ou une table, corps gainé : la pompe pour débuter ou finir une séance.',
         lead='Des pompes les mains en appui sur un support surélevé : plus le support est haut, plus c\'est facile.',
         kit=['un banc ou une table stable', 'un tapis'],
         why='La pompe classique est trop dure au début ; l\'inclinaison garde le même geste avec moins de charge.',
         dose=[('3', 'séries'), ('8–12', 'répétitions'), ('60 s', 'repos')],
         keys=[('Corps en planche.', 'Les fesses ne montent pas, le ventre ne s\'affaisse pas.'),
               ('Coudes à 45°.', 'Ni collés au corps, ni ouverts en croix.'),
               ('Poitrine au support.', 'Descends jusqu\'à frôler le bord avec le sternum.')],
         steps=[('Départ', 'Mains un peu plus larges que les épaules, bras tendus.', 'Position haute, bras tendus sur le banc'),
                ('Descente', 'Trois secondes, coudes à 45°, jusqu\'au support.', 'Poitrine près du banc, coudes fléchis')],
         loop='Remonte en poussant le support loin de toi ; si le dos se creuse, prends un support plus haut.'),
    dict(slug='fente-arriere', theme='strength', group='Legs', title='Fente arrière',
         eyebrow='Cuisses · fessiers · 6 minutes', duration='6 min', source=src(2, 'TikTok'),
         summary='Un pas en arrière, le genou frôle le sol : la fente la plus douce pour les genoux.',
         lead='Debout, tu recules une jambe et descends jusqu\'à ce que le genou arrière frôle le sol.',
         kit=['poids du corps', 'ou deux haltères légers'],
         why='Reculer plutôt qu\'avancer garde le poids sur le talon avant : moins de pression sur le genou.',
         dose=[('3', 'séries'), ('10', 'par jambe'), ('45 s', 'repos')],
         keys=[('Buste droit.', 'Regarde devant toi, pas tes pieds.'),
               ('Poids sur le talon avant.', 'Les orteils avant peuvent se soulever.')],
         steps=[('Debout', 'Pieds largeur de hanches, mains sur les hanches.', 'Debout, pieds parallèles'),
                ('En bas', 'Genou arrière à un doigt du sol, genou avant au-dessus de la cheville.', 'Fente basse, genou arrière près du sol')],
         loop='Reviens en poussant dans le talon avant ; alterne les jambes ou enchaîne toute une série du même côté.'),
    dict(slug='chien-tete-en-bas', theme='yoga', group='Poses', title='Chien tête en bas',
         eyebrow='Posture · dos · ischios · 2 minutes', duration='2 min', source=src(3, 'YouTube', 'Studio Démo'),
         summary='Le V inversé : étire l\'arrière des jambes et allonge le dos.',
         lead='Mains et pieds au sol, bassin vers le plafond : le corps dessine un V à l\'envers.',
         kit=['un tapis'],
         why='Une posture de transition qui étire tout l\'arrière du corps et soulage le bas du dos.',
         dose=[('5', 'respirations'), ('3', 'fois'), ('libre', 'repos')],
         keys=[('Dos long avant jambes tendues.', 'Plie les genoux si le dos s\'arrondit.'),
               ('Pousse le sol.', 'Les épaules s\'éloignent des oreilles.')],
         steps=[('À quatre pattes', 'Mains sous les épaules, genoux sous les hanches.', 'À quatre pattes sur le tapis'),
                ('Le V', 'Décolle les genoux, envoie le bassin haut et loin.', 'Corps en V inversé')],
         loop='Respire lentement par le nez ; reviens à quatre pattes entre deux tenues.'),
    dict(slug='jab-cross', theme='fight', group='Striking', title='Jab-cross',
         eyebrow='Boxe · enchaînement de base', duration='4 min', source=src(4),
         summary='Direct du bras avant puis du bras arrière, garde haute.',
         lead='Le premier enchaînement de la boxe : un jab rapide, puis un cross qui part de la hanche.',
         kit=['des bandes', 'un sac ou dans le vide'],
         why='Le jab mesure la distance, le cross porte : les deux ensemble construisent tout le reste.',
         dose=[('3', 'rounds'), ('2 min', 'par round'), ('1 min', 'repos')],
         keys=[('Le menton rentré.', 'L\'épaule protège la mâchoire à chaque frappe.'),
               ('La hanche tourne.', 'Le pied arrière pivote sur le cross.')],
         steps=[('Jab', 'Bras avant tendu, poing tourné, l\'autre main reste à la joue.', 'Jab bras avant tendu'),
                ('Cross', 'Pivot du pied arrière, la hanche entraîne le bras.', 'Cross bras arrière tendu')],
         loop='Ramène chaque poing à la garde par le même chemin ; si la garde tombe, ralentis.'),
]

SESSIONS = [
    dict(slug='session-gainage-10-min', theme='strength', title='Gainage en 10 minutes',
         format='3 exercices en circuit, 40 s de travail et 20 s de transition · 3 tours · 30 s de repos entre les tours ; le dernier tour au tempo lent, 3 s par répétition', source=src(5),
         why='Une routine courte pour la sangle abdominale, sans matériel, à placer en fin de séance.',
         key_points=['Le dos reste neutre : pas de creux dans les lombaires.',
                     'Respire pendant la tenue, ne bloque pas.'],
         items=[
             dict(slug='session-gainage-planche', title='Planche', group='Core', dose='3 × 30 s', l15=True,
                  mistakes=[('Fesses en l\'air', 'Le bassin monte au-dessus de la ligne : rentre le nombril, descends les hanches.',
                             'bassin trop haut, corps en V')],
                  eyebrow='Abdominaux · épaules', lead='Sur les avant-bras et la pointe des pieds, le corps droit comme une planche.',
                  kit=['un tapis'], keys=[('Fesses serrées.', 'Le bassin ne tombe pas.'), ('Coudes sous les épaules.', 'Pousse le sol.')],
                  easier='Genoux au sol, la ligne épaules-genoux reste droite.',
                  steps=[('Installation', 'Avant-bras au sol, coudes sous les épaules.', 'Avant-bras au sol'),
                         ('Tenue', 'Décolle les genoux, corps aligné.', 'Planche tenue')]),
             dict(slug='session-gainage-planche-laterale', title='Planche latérale', group='Core', dose='3 × 20 s par côté',
                  eyebrow='Obliques · hanches', lead='Sur un avant-bras et le bord des pieds, le bassin haut.',
                  kit=['un tapis'], keys=[('Hanches hautes.', 'Elles ne s\'affaissent pas vers le sol.'), ('Épaule active.', 'Pousse le sol avec l\'avant-bras.')],
                  easier='Genou du dessous au sol.',
                  steps=[('Sur le côté', 'Coude sous l\'épaule, jambes tendues.', 'Allongé sur le côté'),
                         ('Bassin haut', 'Monte le bassin, corps aligné.', 'Planche latérale tenue')]),
             dict(slug='session-gainage-dead-bug', title='Dead bug', group='Core', dose='3 × 10',
                  eyebrow='Abdominaux profonds', lead='Sur le dos, bras et jambes en l\'air, tu allonges un bras et la jambe opposée.',
                  kit=['un tapis'], keys=[('Lombaires au sol.', 'Le bas du dos reste collé.'), ('Lentement.', 'Trois secondes pour allonger.')],
                  easier='Allonge seulement les jambes, bras vers le plafond.',
                  steps=[('Départ', 'Genoux à 90°, bras vers le plafond.', 'Sur le dos, genoux pliés en l\'air'),
                         ('Allonger', 'Bras droit et jambe gauche vers le sol.', 'Bras et jambe opposés allongés')]),
         ]),
    dict(slug='session-shadow-boxing', theme='fight', title='Shadow boxing pour débuter',
         format='2 exercices · rounds de 2 min · 1 min de repos', source=src(6, 'TikTok', 'Club Démo'),
         why='Travailler la garde et les esquives sans partenaire, avant de taper dans un sac.',
         key_points=['Garde haute du début à la fin.', 'Reste sur l\'avant des pieds.'],
         items=[
             dict(slug='session-shadow-garde', title='Garde et déplacements', group='Footwork', dose='2 min',
                  eyebrow='Boxe · déplacements', lead='En garde, petits pas avant, arrière et sur les côtés, sans croiser les pieds.',
                  kit=['de la place'], keys=[('Pas glissés.', 'Le pied qui part en premier est celui du côté où tu vas.'), ('Mains aux joues.', 'Les coudes protègent les côtes.')],
                  easier='Seulement avant et arrière.',
                  steps=[('En garde', 'Pied avant devant, poings aux joues.', 'Position de garde'),
                         ('Pas latéral', 'Glisse le pied du côté où tu vas, l\'autre suit.', 'Pas latéral en garde')]),
             dict(slug='session-shadow-esquives', title='Esquives rotatives', group='Defense', dose='3 × 1 min',
                  eyebrow='Boxe · défense', lead='Fléchis les jambes et tourne le buste pour passer sous un coup imaginaire.',
                  kit=['de la place'], keys=[('Les jambes travaillent.', 'On ne se penche pas du dos.'), ('Les yeux devant.', 'Ne regarde jamais le sol.')],
                  easier='Sans rotation, seulement la flexion des jambes.',
                  steps=[('En garde', 'Jambes souples, poids réparti.', 'Position de garde'),
                         ('Sous le coup', 'Flexion et rotation, la tête passe sous la ligne.', 'Esquive en flexion')]),
         ]),
]


# L12: a Strength notebook full enough for its page (one row per group, « See all », « From sessions »):
# 14 more standalone sheets and 2 more video sessions, written compactly and filled with generic content.
# Their photos are portrait (9:16), like the frames of a real video, so the 4:5 card crop shows.
def filled(n, slug, group, title, eyebrow, duration, summary, s1, s2):
    return dict(slug=slug, theme='strength', group=group, title=title, eyebrow=eyebrow, duration=duration,
                source=src(n, ('Instagram', 'TikTok', 'YouTube')[n % 3]), summary=summary, lead=summary,
                kit=['poids du corps', 'un tapis'],
                why='Un mouvement simple à placer en début ou en fin de séance, sans matériel lourd.',
                dose=[('3', 'séries'), ('10', 'répétitions'), ('60 s', 'repos')],
                keys=[('Lentement.', 'Trois secondes dans la phase difficile.'),
                      ('Respire.', 'Souffle pendant l\'effort, ne bloque pas.')],
                steps=[(s1[0], s1[1], s1[0]), (s2[0], s2[1], s2[0])],
                loop='Reviens au départ par le même chemin ; arrête la série dès que le geste se dégrade.')


EXTRA_SHEETS = [filled(10 + i, *row) for i, row in enumerate([
    ('ange-au-sol', 'Shoulders', 'Ange au sol', 'Épaules · haut du dos · 4 minutes', '4 min',
     'Allongé sur le dos, les bras glissent au sol du haut vers le bas, comme un ange dans la neige.',
     ('Bras en W', 'Coudes et dos des mains au sol.'), ('Bras en Y', 'Glisse les bras au-dessus de la tête.')),
    ('rotation-externe-elastique', 'Shoulders', 'Rotation externe à l\'élastique', 'Coiffe des rotateurs · 3 minutes', '3 min',
     'Coude collé au corps, l\'avant-bras s\'ouvre vers l\'extérieur contre l\'élastique.',
     ('Départ', 'Coude à 90°, main devant le ventre.'), ('Ouverture', 'L\'avant-bras pivote vers l\'extérieur.')),
    ('elevations-laterales', 'Shoulders', 'Élévations latérales', 'Deltoïdes · 5 minutes', '5 min',
     'Bras presque tendus, les haltères montent sur les côtés jusqu\'à hauteur d\'épaules.',
     ('Bras le long du corps', 'Haltères légers, coudes souples.'), ('En haut', 'Mains à hauteur d\'épaules, pas plus.')),
    ('pompes-piquees', 'Shoulders', 'Pompes piquées', 'Épaules · triceps · 5 minutes', '5 min',
     'Bassin haut, la tête descend entre les mains : la pompe qui charge les épaules.',
     ('Le V', 'Bassin haut, mains et pieds au sol.'), ('Descente', 'Le front vient entre les mains.')),
    ('face-pull-elastique', 'Shoulders', 'Face pull à l\'élastique', 'Arrière d\'épaule · 4 minutes', '4 min',
     'L\'élastique vient vers le visage, coudes hauts, omoplates serrées.',
     ('Bras tendus', 'Élastique accroché à hauteur de visage.'), ('Tirage', 'Mains de part et d\'autre des oreilles.')),
    ('curl-marteau', 'Arms', 'Curl marteau', 'Biceps · avant-bras · 4 minutes', '4 min',
     'Paumes face à face, les haltères montent sans balancer le buste.',
     ('Bras tendus', 'Paumes vers les cuisses.'), ('En haut', 'Coudes fixes, poings vers les épaules.')),
    ('dips-banc', 'Arms', 'Dips sur banc', 'Triceps · 4 minutes', '4 min',
     'Mains sur le bord d\'un banc derrière toi, tu descends en pliant les coudes.',
     ('Départ', 'Bras tendus, fesses près du banc.'), ('En bas', 'Coudes à 90°, dirigés vers l\'arrière.')),
    ('extension-triceps', 'Arms', 'Extension triceps au-dessus de la tête', 'Triceps · 4 minutes', '4 min',
     'Un haltère à deux mains derrière la tête, les avant-bras se déplient vers le plafond.',
     ('Derrière la tête', 'Coudes vers le plafond.'), ('Bras tendus', 'Seuls les avant-bras bougent.')),
    ('rowing-sous-table', 'Back', 'Rowing inversé sous la table', 'Dos · biceps · 5 minutes', '5 min',
     'Allongé sous une table solide, tu tires la poitrine vers le bord.',
     ('Suspendu', 'Mains au bord, corps gainé.'), ('Tirage', 'Poitrine au bord, coudes près du corps.')),
    ('superman', 'Back', 'Superman', 'Lombaires · fessiers · 3 minutes', '3 min',
     'À plat ventre, bras et jambes décollent ensemble quelques secondes.',
     ('À plat ventre', 'Bras devant, front au sol.'), ('Envol', 'Bras et jambes décollent, regard au sol.')),
    ('tirage-horizontal-elastique', 'Back', 'Tirage horizontal à l\'élastique', 'Dos · 4 minutes', '4 min',
     'Assis jambes tendues, l\'élastique autour des pieds, tu tires les coudes vers l\'arrière.',
     ('Bras tendus', 'Dos droit, élastique tendu.'), ('Coudes en arrière', 'Omoplates serrées une seconde.')),
    ('squat-gobelet', 'Legs', 'Squat gobelet', 'Cuisses · fessiers · 6 minutes', '6 min',
     'Un poids tenu contre la poitrine, tu descends entre tes talons, dos droit.',
     ('Debout', 'Poids contre le sternum, pieds un peu ouverts.'), ('En bas', 'Coudes entre les genoux.')),
    ('pont-fessier', 'Legs', 'Pont fessier', 'Fessiers · ischios · 4 minutes', '4 min',
     'Sur le dos, pieds au sol, tu montes le bassin en serrant les fessiers.',
     ('Au sol', 'Pieds près des fesses.'), ('Bassin haut', 'Épaules-hanches-genoux alignés.')),
    ('rotation-thoracique', 'Mobility', 'Rotations thoraciques à quatre pattes', 'Haut du dos · 3 minutes', '3 min',
     'Une main derrière la tête, le coude part vers le plafond puis revient sous le buste.',
     ('À quatre pattes', 'Main derrière la tête.'), ('Ouverture', 'Le coude monte, le regard suit.')),
])]
SHEETS += EXTRA_SHEETS

# L16: a Kitesurf sheet on templates/technique.html (notebook profile « technique »).
SHEETS.append(dict(
    slug='backroll', theme='kitesurf', group='Jumps & tricks', title='Backroll', technique=True,
    eyebrow='Rotation · 20 min', duration='20 min', source=src(40, 'YouTube', 'Rider Démo'),
    summary='La première rotation en kite : une vrille arrière, la voile reste haute.',
    lead='Une rotation arrière sur l\'axe du corps, en sautant depuis la carre : la première figure après le saut simple.',
    kit=['twin-tip', 'aile 9–12 m', 'harnais et leash', 'casque'],
    prereq=['Sauts simples posés des deux côtés, sans perdre la voile.', 'Remontée au vent sur les deux bords.'],
    cond=[('15–25 nds', 'vent établi'), ('9–12 m', 'aile'), ('Plat', 'eau à la taille ou plus')],
    go=['Vent régulier, rafales de moins de 8 nds d\'écart.', 'Au moins 50 m libres sous le vent.',
        'Tu poses tes sauts simples à chaque essai.'],
    nogo=['Vent de terre ou rafaleux.', 'Eau trop peu profonde ou du monde sous le vent.',
          'Fatigue : tes réceptions deviennent approximatives.'],
    steps=[('Approche', 'Vitesse moyenne, carre franche, voile à 11 h.', 'Rider en carre, voile haute'),
           ('Appel', 'Pop sur la carre, la tête et les épaules tournent vers l\'arrière.', 'Rider qui décolle en tournant les épaules'),
           ('Rotation', 'Genoux groupés, la barre près des hanches, le regard cherche la voile.', 'Rider en rotation, genoux groupés'),
           ('Réception', 'Planche sous le vent, voile qui descend, tu repars en carre.', 'Rider qui atterrit planche à plat')],
    mistakes=[('Barre tirée en tournant', 'La voile remonte et te soulève trop : garde la barre au même endroit pendant la rotation.',
               'barre tirée, rider soulevé trop haut')],
    keys=[('La tête d\'abord.', 'Les épaules suivent le regard, le reste du corps suit les épaules.'),
          ('Barre immobile.', 'Elle ne bouge pas pendant la rotation.'),
          ('Repère la voile.', 'Dès que tu la revois, ouvre et prépare la réception.')],
    tries=[('3–5', 'essais par côté'), ('1', 'réception propre, puis l\'autre côté'), ('20 min', 'puis navigue sans essayer')],
    tries_note='La vidéo ne donne ni nombre d\'essais ni durée : plan suggéré.',
    safety=['Casque et gilet d\'impact tant que tu l\'apprends.', 'Personne sous le vent, jamais près du bord.']))
PORTRAIT = {s['slug'] for s in EXTRA_SHEETS}


def item(slug, title, group, dose, lead, s1, s2):
    PORTRAIT.add(slug)
    return dict(slug=slug, title=title, group=group, dose=dose, eyebrow=f'{group} · séance', lead=lead,
                kit=['un tapis'], keys=[('Lentement.', 'Le geste avant la vitesse.'), ('Gainé.', 'Le bassin ne bouge pas.')],
                easier='Moins d\'amplitude, ou les genoux au sol.',
                steps=[(s1[0], s1[1], s1[0]), (s2[0], s2[1], s2[0])])


SESSIONS += [
    dict(slug='session-epaules-solides', theme='strength', title='Épaules solides',
         format='4 exercices · 3 tours · 45 s de repos entre les exercices', source=src(30, 'YouTube', 'Coach Démo'),
         why='Une routine de prévention pour les épaules qui travaillent beaucoup : nage, sports de raquette, bureau.',
         key_points=['Omoplates basses pendant tout le circuit.', 'Charge légère, mouvement lent.'],
         items=[
             item('session-epaules-ytw', 'Y-T-W allongé', 'Shoulders', '3 × 8',
                  'À plat ventre, les bras dessinent un Y, un T puis un W.',
                  ('Le Y', 'Bras en Y, pouces vers le plafond.'), ('Le W', 'Coudes pliés, omoplates serrées.')),
             item('session-epaules-pompes-scapulaires', 'Pompes scapulaires', 'Shoulders', '3 × 12',
                  'En planche bras tendus, seules les omoplates se rapprochent puis s\'écartent.',
                  ('Planche haute', 'Bras tendus, corps gainé.'), ('Omoplates', 'Elles se rapprochent sans plier les bras.')),
             item('session-epaules-tenue-mur', 'Tenue bras au mur', 'Shoulders', '3 × 30 s',
                  'Dos au mur, les bras glissent le long du mur sans le quitter.',
                  ('Contre le mur', 'Dos, tête et bras au mur.'), ('Glisser', 'Les bras montent sans décoller.')),
             item('session-epaules-rowing-un-bras', 'Rowing un bras', 'Back', '3 × 10 par bras',
                  'Un genou sur le banc, l\'haltère monte vers la hanche.',
                  ('Appui', 'Dos plat, bras tendu vers le sol.'), ('Tirage', 'Le coude file vers le plafond.')),
         ]),
    dict(slug='session-bras-express', theme='strength', title='Bras express',
         format='2 exercices en superset · 3 tours · 1 min de repos', source=src(31, 'Instagram', 'Coach Démo'),
         why='Dix minutes pour les bras, avec un élastique et le sol.',
         key_points=['Coudes fixes sur les curls.', 'Corps gainé sur les pompes.'],
         items=[
             item('session-bras-curl-elastique', 'Curl à l\'élastique', 'Arms', '3 × 15',
                  'Debout sur l\'élastique, les mains montent vers les épaules.',
                  ('Bras tendus', 'Élastique sous les pieds.'), ('En haut', 'Poings aux épaules, coudes fixes.')),
             item('session-bras-pompes-serrees', 'Pompes serrées', 'Arms', '3 × 8',
                  'Mains sous les épaules, coudes le long du corps : la pompe des triceps.',
                  ('Planche haute', 'Mains sous les épaules.'), ('Descente', 'Coudes qui frôlent les côtes.')),
         ]),
]


def label_image(path, size, colour, text):
    from PIL import Image, ImageDraw, ImageFont
    # Pillow's bundled font has no accented glyphs: labels are written without accents.
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode()
    img = Image.new('RGB', size, colour)
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default(size=max(14, size[0] // 14))
    except TypeError:  # Pillow < 10.1
        font = ImageFont.load_default()
    d.rectangle([8, 8, size[0] - 9, size[1] - 9], outline=(255, 255, 255), width=2)
    d.multiline_text((size[0] // 2, size[1] // 2), text, fill=(255, 255, 255), font=font, anchor='mm', align='center', spacing=6)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'JPEG', quality=70, optimize=True)


PRACTICE_LOG = [
    {'id': f'log-{i + 1}', 'slug': slug, 'done_on': day, 'text': text, 'created_at': f'{day}T18:{10 + i:02d}:00Z'}
    for i, (slug, day, text) in enumerate([
        ('pompes-inclinees', '2026-10-21', '2 × 8 sur la table'),
        ('pompes-inclinees', '2026-10-24', '3 × 8'),
        ('pompes-inclinees', '2026-10-28', '3 × 10, banc bas'),
        ('chien-tete-en-bas', '2026-10-29', ''),
        ('session/session-gainage-10-min', '2026-10-30', '2 tours, planche à 40 s'),
        ('ancienne-fiche', '2026-10-01', 'fiche supprimée depuis'),
    ])
]

def main():
    try:
        import PIL  # noqa: F401
    except ImportError:
        sys.exit('Pillow is required: pip install pillow (or run with a Python that has it).')
    sheets, sessions, n = [], [], 0
    stamp = lambda: f'2026-10-{min(10 + n, 28):02d}T09:00:00Z'  # noqa: E731
    # « now-<N>h »: resolved when the preview is built (fake-data.py), for the home « New » row (L7, 72 h)
    RECENT = {'jab-cross': 'now-5h', 'chien-tete-en-bas': 'now-30h', 'session-shadow-boxing': 'now-20h'}

    def images(slug, theme, title, steps, bad=()):
        c = COLOURS[theme]
        for i, st in enumerate(bad):
            label_image(os.path.join(OUT, 'files', slug, 'img', f'x{i + 1}.jpg'), (360, 450), c, f'Erreur : {st[0]}\n{title}')
        label_image(os.path.join(OUT, 'files', slug, 'img', 'thumb.jpg'), (270, 480) if slug in PORTRAIT else (224, 224), c,
                    f'{textwrap.fill(title, 16) if slug in PORTRAIT else title}\n(preview)')
        for i, st in enumerate(steps):
            label_image(os.path.join(OUT, 'files', slug, 'img', f'0{i + 1}.jpg'), (360, 450), c, f'{i + 1}. {st[0]}\n{title}')

    for s in SHEETS:
        n += 1
        images(s['slug'], s['theme'], s['title'], s['steps'], s.get('mistakes', ()))
        html = technique_html(s) if s.get('technique') else sheet_html(s)
        sheets.append({'slug': s['slug'], 'kind': 'sheet', 'theme': s['theme'], 'group': s['group'], 'title': s['title'],
                       'summary': s['summary'], 'duration': s['duration'], 'thumbnail': 'img/thumb.jpg',
                       'source': s['source'], 'added_at': RECENT.get(s['slug']) or stamp(), 'html': html})
    for ses in SESSIONS:
        for it in ses['items']:
            n += 1
            it = dict(it, source=ses['source'])
            images(it['slug'], ses['theme'], it['title'], it['steps'], it.get('mistakes', ()))
            sheets.append({'slug': it['slug'], 'kind': 'sheet', 'theme': ses['theme'], 'group': it['group'], 'title': it['title'],
                           'summary': it['lead'], 'duration': '', 'thumbnail': 'img/thumb.jpg',
                           'source': ses['source'], 'added_at': stamp(), 'html': exercise_html(it)})
        sessions.append({'id': f'ses-{len(sessions) + 1}', 'slug': ses['slug'], 'theme': ses['theme'], 'title': ses['title'],
                         'format': ses['format'], 'why': ses['why'], 'key_points': ses['key_points'], 'source': ses['source'],
                         'origin': 'video', 'thumbnail': f"u1/{ses['items'][0]['slug']}/img/thumb.jpg",
                         'items': [{'slug': it['slug'], 'dose': it['dose']} for it in ses['items']],
                         'created_at': RECENT.get(ses['slug'], '2026-10-25T18:00:00Z'), 'updated_at': '2026-10-25T18:00:00Z'})
    data = {
        'user_themes': [{'id': t, 'title': None, 'description': '', 'groups': None, 'builtin': True, 'position': i}
                        for i, t in enumerate(['strength', 'yoga', 'fight', 'kitesurf'])],
        'sheets': sheets,
        'sessions': sessions,
        'notes': [{'slug': 'pompes-inclinees', 'body': 'Mardi : 3 × 10 sur la table de la cuisine. Prochaine fois, le banc plus bas.',
                   'updated_at': '2026-10-28T19:30:00Z'}],
        # L6: the practice log; « ancienne-fiche » is a sheet deleted since (not counted on the home page)
        'practice_log': PRACTICE_LOG,
        'requests': [
            {'id': 'req-1', 'url': 'https://www.instagram.com/reel/PREVIEW0101/', 'status': 'queued', 'theme': 'strength',
             'note': None, 'created_at': '2026-11-02T08:15:00Z'},
            {'id': 'req-2', 'url': 'https://www.tiktok.com/@coach.demo/video/7400000000000000102', 'status': 'processing',
             'theme': 'yoga', 'note': None, 'created_at': '2026-11-02T07:40:00Z', 'processed_at': '2026-11-03T09:20:00Z'},
            {'id': 'req-3', 'url': 'https://www.youtube.com/shorts/PREVIEW0103', 'status': 'error', 'theme': None,
             'note': 'Video unavailable: the post is private or was deleted.', 'created_at': '2026-11-01T21:05:00Z'},
            # done: the computer's last run, shown in the expanded queue (« Last run: … »)
            {'id': 'req-4', 'url': 'https://www.instagram.com/reel/PREVIEW0104/', 'status': 'done', 'theme': 'strength',
             'note': None, 'created_at': '2026-10-31T18:00:00Z', 'processed_at': '2026-11-01T22:10:00Z'},
        ],
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'data.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'{len(sheets)} sheets, {len(sessions)} sessions -> {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
