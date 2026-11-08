#!/usr/bin/env python3
"""Write <out>/vendor/fake-data.js and <out>/files/ for the preview (called by build.sh).

    python3 -I tools/preview/fake-data.py <out> --fixtures <dir>   # synthetic data (tests/fixtures/preview)
    python3 -I tools/preview/fake-data.py <out> --work <dir>       # Laurent's local work/ folder

--fixtures copies <dir>/data.json and <dir>/files/. --work reads the sheets and sessions published
from work/ (meta.json + index.html per sheet, session folders holding their exercise sheets) and
links each sheet folder as files/<slug> (symlinks: nothing is copied, nothing is committed).
Standard library only.
"""
import glob
import json
import os
import shutil
import sys


def relative_stamps(data):
    """« now-5h » in a fixture's added_at / created_at becomes that time at build: the home « New » row (L7,
    last 72 h) keeps something to show whatever the day the preview is built."""
    import datetime, re
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    for rows in data.values():
        for r in rows if isinstance(rows, list) else []:
            for k in ('added_at', 'created_at'):
                m = re.fullmatch(r'now-(\d+)h', str(r.get(k) or ''))
                if m:
                    r[k] = (now - datetime.timedelta(hours=int(m.group(1)))).isoformat().replace('+00:00', 'Z')
    return data


def from_fixtures(src, out):
    with open(os.path.join(src, 'data.json'), encoding='utf-8') as f:
        data = json.load(f)
    shutil.copytree(os.path.join(src, 'files'), os.path.join(out, 'files'), dirs_exist_ok=True)
    return relative_stamps(data)


def from_work(work, out):
    work = os.path.abspath(work)
    files = os.path.join(out, 'files')
    os.makedirs(files, exist_ok=True)
    sheets, sessions = [], []

    def add_sheet(d):
        with open(os.path.join(d, 'meta.json'), encoding='utf-8') as f:
            m = json.load(f)
        with open(os.path.join(d, 'index.html'), encoding='utf-8') as f:
            m['html'] = f.read()
        m.setdefault('added_at', '2026-10-20T10:00:00Z')
        m.pop('exercises', None)
        link = os.path.join(files, m['slug'])
        if not os.path.lexists(link):
            os.symlink(d, link)
        sheets.append(m)

    for d in sorted(glob.glob(os.path.join(work, '*', ''))):
        d = d.rstrip('/')
        if os.path.basename(d).startswith('_') or not os.path.exists(os.path.join(d, 'meta.json')):
            continue
        with open(os.path.join(d, 'meta.json'), encoding='utf-8') as f:
            m = json.load(f)
        if m.get('kind') == 'session':
            if 'items' not in m:  # a v1 one-page session: not shown by the app any more
                continue
            for sub in sorted(glob.glob(os.path.join(d, '*', 'meta.json'))):
                add_sheet(os.path.dirname(sub))
            m.pop('kind', None)
            m['origin'] = 'video'
            # work/ keeps the session thumbnail relative to the session folder (<sheet slug>/img/...);
            # the bucket path is <user id>/<sheet slug>/img/...
            if m.get('thumbnail') and not m['thumbnail'].startswith('u1/'):
                m['thumbnail'] = 'u1/' + m['thumbnail']
            sessions.append(m)
        elif os.path.exists(os.path.join(d, 'index.html')):
            add_sheet(d)
    return {
        'user_themes': [{'id': t, 'title': None, 'description': '', 'groups': None, 'builtin': True, 'position': i}
                        for i, t in enumerate(['strength', 'yoga', 'fight', 'kitesurf'])],
        'sheets': sheets, 'sessions': sessions, 'notes': [], 'requests': [],
    }


def add_search_text(data):
    """L14: each sheet gets the search_text `rb.py publish` would write (the same function); the preview's
    ?missing=sheets.search_text then plays a backend before the column."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('rb', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'rb.py'))
    rb = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rb)
    for s in data.get('sheets') or []:
        if 'search_text' not in s:
            s['search_text'] = rb.search_text(s.get('html') or '')


def main(argv):
    if len(argv) != 3 or argv[1] not in ('--fixtures', '--work'):
        sys.exit('usage: fake-data.py <out> --fixtures <dir> | --work <dir>')
    out, mode, src = argv
    if not os.path.isdir(src):
        sys.exit(f'not a folder: {src}')
    data = from_fixtures(src, out) if mode == '--fixtures' else from_work(src, out)
    add_search_text(data)
    os.makedirs(os.path.join(out, 'vendor'), exist_ok=True)
    with open(os.path.join(out, 'vendor', 'fake-data.js'), 'w', encoding='utf-8') as f:
        f.write('window.__FAKE = ' + json.dumps(data, ensure_ascii=False) + ';\n')
    print(f"fake data: {len(data['sheets'])} sheets, {len(data['sessions'])} sessions, "
          f"{len(data['requests'])} requests ({mode[2:]})")


if __name__ == '__main__':
    main(sys.argv[1:])
