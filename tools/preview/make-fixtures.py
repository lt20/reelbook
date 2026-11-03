#!/usr/bin/env python3
"""Write the synthetic preview fixtures: tests/fixtures/preview/data.json and its images.

    python3 tools/preview/make-fixtures.py            # needs Pillow (pip install pillow)

The preview (tools/preview/build.sh) shows the app on a fake backend. Its default data is this
synthetic set, committed: 3 notebooks, 9 sheets built like templates/sheet.html and
templates/exercise.html (French content written for the preview), 2 video sessions with doses,
one note and 4 requests (queued, processing, error, done). Images are plain colour + label JPEGs made
here: never a frame from a real video (the repository is public).

Storage layout, as in the real bucket: files/<sheet slug>/img/<file>.jpg (the fake client maps
the signed path <user id>/<slug>/img/<file> to it).
"""
import json
import os
import sys
import unicodedata

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'tests', 'fixtures', 'preview')
COLOURS = {'strength': (196, 92, 62), 'yoga': (74, 140, 118), 'fight': (70, 96, 160)}


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def step(n, img, title, text, alt):
    return (f'  <div class="step"><figure><img src="img/{img}" alt="{esc(alt)}" loading="lazy">'
            f'<span class="k">{n}</span></figure><h3>{esc(title)}</h3><p>{esc(text)}</p></div>')


def footer(src):
    return (f'<footer>Photos : images de démonstration générées pour l\'aperçu. '
            f'<a href="{esc(src["url"])}">Voir la vidéo</a>.</footer>')


def sheet_html(s):
    """A single-exercise sheet, structure of templates/sheet.html."""
    dose = ''.join(f'  <div class="d"><b>{esc(b)}</b><span>{esc(t)}</span></div>\n' for b, t in s['dose'])
    keys = ''.join(f'  <li><b>{esc(b)}</b> {esc(t)}</li>\n' for b, t in s['keys'])
    kit = ''.join(f'<span>{esc(k)}</span>' for k in s['kit'])
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
<h2>L'enchaînement</h2>
<div class="steps">
{steps}
</div>
<p class="loop"><span class="arrow">↻</span> {esc(s['loop'])}</p>
</div>

<div class="wrap">
{footer(s['source'])}
</div>
'''


def exercise_html(s):
    """One exercise of a video session, structure of templates/exercise.html."""
    keys = ''.join(f'  <li><b>{esc(b)}</b> {esc(t)}</li>\n' for b, t in s['keys'])
    kit = ''.join(f'<span>{esc(k)}</span>' for k in s['kit'])
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
</div>

<div class="wide">
<h2>Le mouvement</h2>
<div class="steps">
{steps}
</div>
</div>

<div class="wrap">
<h2>Repères</h2>
<ol class="keys">
{keys}</ol>

<h2>Version plus facile</h2>
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
    dict(slug='pompes-inclinees', theme='strength', group='Chest', title='Pompes inclinées',
         eyebrow='Pectoraux · triceps · 5 minutes', duration='5 min', source=src(1),
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
             dict(slug='session-gainage-planche', title='Planche', group='Core', dose='3 × 30 s',
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
    stamp = lambda: f'2026-10-{10 + n:02d}T09:00:00Z'  # noqa: E731
    # « now-<N>h »: resolved when the preview is built (fake-data.py), for the home « New » row (L7, 72 h)
    RECENT = {'jab-cross': 'now-5h', 'chien-tete-en-bas': 'now-30h', 'session-shadow-boxing': 'now-20h'}

    def images(slug, theme, title, steps):
        c = COLOURS[theme]
        label_image(os.path.join(OUT, 'files', slug, 'img', 'thumb.jpg'), (224, 224), c, f'{title}\n(preview)')
        for i, st in enumerate(steps):
            label_image(os.path.join(OUT, 'files', slug, 'img', f'0{i + 1}.jpg'), (360, 450), c, f'{i + 1}. {st[0]}\n{title}')

    for s in SHEETS:
        n += 1
        images(s['slug'], s['theme'], s['title'], s['steps'])
        sheets.append({'slug': s['slug'], 'kind': 'sheet', 'theme': s['theme'], 'group': s['group'], 'title': s['title'],
                       'summary': s['summary'], 'duration': s['duration'], 'thumbnail': 'img/thumb.jpg',
                       'source': s['source'], 'added_at': RECENT.get(s['slug']) or stamp(), 'html': sheet_html(s)})
    for ses in SESSIONS:
        for it in ses['items']:
            n += 1
            it = dict(it, source=ses['source'])
            images(it['slug'], ses['theme'], it['title'], it['steps'])
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
                        for i, t in enumerate(['strength', 'yoga', 'fight'])],
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
