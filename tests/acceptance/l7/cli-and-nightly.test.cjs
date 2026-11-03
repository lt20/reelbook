const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const python = String.raw`import contextlib, importlib.util, io, json, sys
spec = importlib.util.spec_from_file_location('rb', sys.argv[1])
rb = importlib.util.module_from_spec(spec); spec.loader.exec_module(rb)
rb.session = lambda: {'user_id': 'u1'}
calls = []
def rest(cfg, method, table, **kw):
    calls.append([method, table, kw.get('params', {})])
    if table == 'requests': return [{'id': 7, 'url': 'https://example.test/video', 'theme': 'strength', 'note': 'Redo: correct the angle', 'created_at': '2026-11-03T08:00:00Z'}]
    if table == 'sheets': return [{'slug': 'curl', 'kind': 'sheet', 'theme': 'strength', 'group': 'Arms', 'title': 'Curl marteau en 5 étapes', 'added_at': '2026-11-03T08:00:00Z'}]
    if table == 'sessions': return [{'slug': 'backroll', 'theme': 'strength', 'title': 'Backroll', 'items': []}]
    return []
rb.rest = rest
out = io.StringIO()
with contextlib.redirect_stdout(out):
    getattr(rb, 'cmd_' + sys.argv[2])([])
print(json.dumps({'output': out.getvalue(), 'calls': calls}, ensure_ascii=False))`;
const runRb = command => {
  const r = spawnSync('python3', ['-c', python, path.join(root, 'tools/rb.py'), command], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test('B4 — tools/rb.py queue returns the note of a queued correction', () => {
  const {output, calls} = runRb('queue');
  assert.equal(JSON.parse(output.trim()).note, 'Redo: correct the angle');
  assert.ok(calls.some(([method, table, params]) => method === 'GET' && table === 'requests' && /note/.test(params.select || '')));
});

test('B2 — tools/rb.py list exposes published sheet and session titles for the night notice', () => {
  const {output} = runRb('list');
  assert.match(output, /Curl marteau en 5 étapes/);
  assert.match(output, /Backroll/);
});

const makeExecutable = (dir, name, body) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, '#!/bin/bash\n' + body + '\n', {mode: 0o755});
};
const runNightly = (titles, appUrl) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reelbook-l7-'));
  try {
    const state = path.join(dir, 'list-count');
    const notice = path.join(dir, 'notice');
    makeExecutable(dir, 'python3', `case "$2" in
      queue) printf '{"id":1}\n';;
      list)
        if [ "${'$'}{3:-}" = --since ]; then
          ${titles.map((title, i) => `printf '%s\\n' 'strength Arms sheet new-${i} ${title}'`).join('\n          ')}
        elif [ ! -e "$RB_LIST_STATE" ]; then
          : > "$RB_LIST_STATE"
          printf '%s\\n' 'strength Arms sheet old Old title'
        else
          printf '%s\\n' 'strength Arms sheet old Old title'
          ${titles.map((title, i) => `printf '%s\\n' 'strength Arms sheet new-${i} ${title}'`).join('\n          ')}
        fi;;
    esac`);
    for (const name of ['open', 'caffeinate']) makeExecutable(dir, name, 'exit 0');
    makeExecutable(dir, 'pmset', 'echo "Now drawing from AC Power"');
    makeExecutable(dir, 'ioreg', 'echo false');
    makeExecutable(dir, 'plutil', 'echo false');
    makeExecutable(dir, 'curl', 'printf "%s\\n" "$@" > "$RB_NOTICE"');
    const env = {...process.env, PATH: `${dir}:${process.env.PATH}`, CLAUDE_BIN: '/bin/true', REELBOOK_NOTIFY_URL: 'https://ntfy.example.test/topic', RB_LIST_STATE: state, RB_NOTICE: notice};
    if (appUrl) env.REELBOOK_APP_URL = appUrl; else delete env.REELBOOK_APP_URL;
    const r = spawnSync('bash', [path.join(root, 'tools/nightly.sh'), 'run'], {env, encoding: 'utf8', timeout: 10000});
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.ok(fs.existsSync(notice), 'nightly sends an ntfy notice');
    return fs.readFileSync(notice, 'utf8');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
};

test('B2 — The night run notice lists titles published during the run and has an ntfy Click header to the app', () => {
  const notice = runNightly(['Curl marteau en 5 étapes', 'Backroll']);
  assert.match(notice, /2 new sheets: Curl marteau en 5 étapes, Backroll/);
  assert.match(notice, /Click: https:\/\/lt20\.github\.io\/reelbook\//);
  assert.doesNotMatch(notice, /queued before|after/);
});

test('B2 — With exactly one new title, ntfy Click uses REELBOOK_APP_URL and #<slug>', () => {
  const notice = runNightly(['Backroll'], 'https://app.example.test/reelbook/');
  assert.match(notice, /Backroll/);
  assert.match(notice, /Click: https:\/\/app\.example\.test\/reelbook\/#new-0/);
});

test('B4 — The Reelbook skill treats a « Redo: » request as a correction, republishes the same slug and reports it', () => {
  const skill = fs.readFileSync(path.join(root, 'skill/reelbook/SKILL.md'), 'utf8');
  assert.match(skill, /Redo:/);
  assert.match(skill, /same slug/i);
  assert.match(skill, /end.of.run report/i);
});
