#!/usr/bin/env python3
"""Draw the placeholder images of the demo notebook (app/demo/<sheet>/img/*.svg), L27.

Simple silhouettes from joint coordinates: no frame from any video, nothing from a third party. Run it again after
changing a pose; the demo itself never needs it (Laurent's own footage replaces these files: app/demo/README.md).

    python3 scripts/demo-drawings.py
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'app' / 'demo'
W, H = 400, 500
GROUND = 440
BG, INK, FAR, ACCENT, SOFT, WATER = '#e8edf4', '#1f2a3a', '#7d8899', '#e0703a', '#cfd8e5', '#9cc3dd'


def limb(points, color, width=16):
    d = ' '.join(f'{x},{y}' for x, y in points)
    return f'<polyline points="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>'


def figure(p, near='r'):
    """p: head, neck, hip, and per side (l, r) elbow, hand, knee, foot. The far side is drawn first, lighter."""
    far = 'l' if near == 'r' else 'r'
    out = []
    for side, color in ((far, FAR), (near, INK)):
        out.append(limb([p['hip'], p['knee' + side], p['foot' + side]], color))
    out.append(limb([p['neck'], p['hip']], INK, 22))
    for side, color in ((far, FAR), (near, INK)):
        out.append(limb([p['neck'], p['elbow' + side], p['hand' + side]], color, 13))
    hx, hy = p['head']
    out.append(f'<circle cx="{hx}" cy="{hy}" r="25" fill="{INK}"/>')
    return out


def both(**kw):
    """Same joint for both sides unless given: elbow=(x,y) sets elbowl and elbowr."""
    p = {}
    for k, v in kw.items():
        if k in ('elbow', 'hand', 'knee', 'foot'):
            p.setdefault(k + 'l', v)
            p.setdefault(k + 'r', v)
        else:
            p[k] = v
    return p


def ground():
    return [f'<rect x="-100" y="{GROUND}" width="{W + 200}" height="{H - GROUND}" fill="{SOFT}"/>']


def kettlebell(x, y):
    return [f'<path d="M{x - 13},{y - 10} a13,13 0 0 1 26,0" fill="none" stroke="{ACCENT}" stroke-width="7"/>',
            f'<circle cx="{x}" cy="{y + 10}" r="19" fill="{ACCENT}"/>']


def water(y=380):
    wave = ' '.join(f'Q{x + 25},{y - 8} {x + 50},{y} T{x + 100},{y}' for x in range(-150, W + 100, 100))
    return [f'<path d="M-150,{y} {wave} V{H} H-150 Z" fill="{WATER}" opacity=".9"/>']


def kite(x, y, bar):
    bx, by = bar
    return [f'<path d="M{x - 70},{y + 26} Q{x},{y - 34} {x + 70},{y + 26} Q{x},{y - 6} {x - 70},{y + 26} Z" fill="{ACCENT}"/>',
            f'<line x1="{x - 66}" y1="{y + 24}" x2="{bx - 18}" y2="{by}" stroke="{FAR}" stroke-width="2"/>',
            f'<line x1="{x + 66}" y1="{y + 24}" x2="{bx + 18}" y2="{by}" stroke="{FAR}" stroke-width="2"/>',
            f'<line x1="{bx - 22}" y1="{by}" x2="{bx + 22}" y2="{by}" stroke="{INK}" stroke-width="6" stroke-linecap="round"/>']


def board(a, b):
    (x1, y1), (x2, y2) = a, b
    return [f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{ACCENT}" stroke-width="12" stroke-linecap="round"/>']


def mat(x1, x2):
    return [f'<rect x="{x1}" y="{GROUND - 8}" width="{x2 - x1}" height="10" rx="5" fill="{ACCENT}" opacity=".55"/>']



def svg(parts, label, square=False):
    """square: the thumbnail, the whole scene in a 500 x 500 square (a card crops its sides, the sheet header shows it all)."""
    body = '\n  '.join(parts)
    box, w = (f'-50 0 {H} {H}', H) if square else (f'0 0 {W} {H}', W)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" width="{w}" height="{H}" role="img" aria-label="{label}">\n'
            f'  <rect x="-100" width="{W + 200}" height="{H}" fill="{BG}"/>\n  {body}\n</svg>\n')


# ---------- poses (side view; y grows downwards, the ground at 440) ----------
SQUAT_TOP = both(head=(198, 112), neck=(200, 160), hip=(198, 280), elbow=(232, 214), hand=(232, 178), knee=(204, 360), footl=(186, 440), footr=(206, 440))
SQUAT_LOW = both(head=(236, 196), neck=(222, 238), hip=(150, 340), elbow=(262, 288), hand=(256, 252), knee=(244, 344), footl=(188, 440), footr=(206, 440))
SQUAT_MID = both(head=(220, 150), neck=(214, 196), hip=(170, 312), elbow=(250, 250), hand=(246, 214), knee=(232, 352), footl=(188, 440), footr=(206, 440))
SQUAT_BAD = both(head=(276, 222), neck=(250, 254), hip=(150, 316), elbow=(282, 302), hand=(276, 266), knee=(260, 360), footl=(214, 432), footr=(226, 432))

PUSH_HIGH = both(head=(334, 302), neck=(300, 318), hip=(188, 356), elbow=(300, 380), hand=(300, 440), knee=(126, 392), foot=(62, 432))
PUSH_LOW = both(head=(340, 386), neck=(304, 398), hip=(188, 410), elbow=(252, 394), hand=(300, 440), knee=(126, 422), foot=(62, 434))
PUSH_KNEE = both(head=(334, 316), neck=(300, 330), hip=(196, 380), elbow=(300, 386), hand=(300, 440), knee=(140, 436), foot=(84, 410))
PUSH_BAD = both(head=(334, 300), neck=(300, 318), hip=(190, 404), elbow=(300, 380), hand=(300, 440), knee=(126, 420), foot=(62, 432))

BUG_TABLE = both(head=(92, 400), neck=(128, 410), hip=(236, 414), elbow=(130, 340), hand=(132, 268), knee=(240, 330), foot=(306, 332))
BUG_REACH = dict(BUG_TABLE, elbowr=(96, 392), handr=(46, 384), kneer=(296, 396), footr=(366, 410))
BUG_SWITCH = dict(BUG_TABLE, elbowl=(96, 392), handl=(46, 384), kneel=(296, 396), footl=(366, 410))
BUG_BAD = dict(BUG_REACH, hip=(236, 384), neck=(128, 404))

KITE_SIT = both(head=(150, 286), neck=(162, 322), hip=(170, 392), elbow=(214, 340), hand=(250, 316), knee=(232, 344), footl=(276, 372), footr=(286, 366))
KITE_POP = both(head=(176, 222), neck=(194, 260), hip=(212, 338), elbow=(236, 268), hand=(262, 248), knee=(264, 354), footl=(278, 398), footr=(304, 394))
KITE_RIDE = both(head=(214, 176), neck=(222, 214), hip=(236, 304), elbow=(262, 236), hand=(292, 222), kneel=(258, 350), kneer=(290, 348), footl=(254, 396), footr=(316, 392))
KITE_BAD = both(head=(196, 196), neck=(200, 236), hip=(204, 322), elbow=(206, 190), hand=(210, 150), kneel=(226, 360), kneer=(240, 356), footl=(250, 384), footr=(262, 380))

DRAWINGS = {
    'goblet-squat': {
        'thumb': (ground() + kettlebell(246, 186) + figure(SQUAT_TOP), 'Standing, a kettlebell held at the chest'),
        '01-stance': (ground() + figure(SQUAT_TOP) + kettlebell(246, 186), 'Standing tall, feet shoulder-width, the weight at the chest'),
        '02-sit': (ground() + figure(SQUAT_LOW) + kettlebell(270, 260), 'At the bottom: hips between the heels, chest up'),
        '03-drive': (ground() + figure(SQUAT_MID) + kettlebell(260, 222), 'Halfway up, pushing the floor away'),
        '04-heels': (ground() + figure(SQUAT_BAD) + kettlebell(290, 274), 'Mistake: heels off the floor, chest falling forward'),
    },
    'push-up': {
        'thumb': (ground() + figure(PUSH_HIGH), 'High plank, arms straight'),
        '01-plank': (ground() + figure(PUSH_HIGH), 'High plank: hands under the shoulders, body in one line'),
        '02-lower': (ground() + figure(PUSH_LOW), 'Chest a fist above the floor, elbows back'),
        '03-press': (ground() + figure(PUSH_HIGH), 'Pressed back up to the plank'),
        '04-sag': (ground() + figure(PUSH_BAD), 'Mistake: hips sagging towards the floor'),
        '05-knees': (ground() + figure(PUSH_KNEE), 'Easier: knees on the floor, body still in one line'),
    },
    'dead-bug': {
        'thumb': (ground() + mat(40, 380) + figure(BUG_REACH), 'Lying on the back, one arm and the opposite leg reaching out'),
        '01-table': (ground() + mat(40, 380) + figure(BUG_TABLE), 'On the back: arms up, knees over the hips'),
        '02-reach': (ground() + mat(40, 380) + figure(BUG_REACH), 'One arm overhead, the opposite leg long'),
        '03-switch': (ground() + mat(40, 380) + figure(BUG_SWITCH, near='l'), 'Back to the table, then the other side'),
        '04-arch': (ground() + mat(40, 380) + figure(BUG_BAD), 'Mistake: the lower back lifting off the floor'),
    },
    'water-start': {
        'thumb': (water(400) + kite(150, 70, (292, 222)) + board((240, 398), (340, 394)) + figure(KITE_RIDE), 'Riding away, the kite low in front'),
        '01-sit': (water(380) + kite(90, 90, (250, 316)) + board((258, 384), (322, 352)) + figure(KITE_SIT), 'Sitting in the water, board on the feet, kite at 12 o\'clock'),
        '02-dive': (water(400) + kite(330, 120, (262, 248)) + board((246, 404), (338, 398)) + figure(KITE_POP), 'The kite dives, the body comes up over the board'),
        '03-ride': (water(400) + kite(150, 70, (292, 222)) + board((240, 398), (340, 394)) + figure(KITE_RIDE), 'Standing, heels down, riding away'),
        '04-pulled': (water(400) + kite(210, 50, (210, 150)) + board((256, 396), (330, 404)) + figure(KITE_BAD), 'Mistake: the kite at the top, the rider pulled up and off the board'),
    },
}


def main():
    for sheet, files in DRAWINGS.items():
        out = ROOT / sheet / 'img'
        out.mkdir(parents=True, exist_ok=True)
        for name, (parts, label) in files.items():
            (out / f'{name}.svg').write_text(svg(parts, label, name == 'thumb'), encoding='utf-8')
    print(f'{sum(len(f) for f in DRAWINGS.values())} drawings in {ROOT}')


if __name__ == '__main__':
    main()
