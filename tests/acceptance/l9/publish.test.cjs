const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');

test('Publish — rb.py passes every structured item field and the free-text dose through untouched', () => {
  const code = `import importlib.util, json, pathlib
spec = importlib.util.spec_from_file_location('rb', 'tools/rb.py')
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)
item = {'slug': 'move', 'dose': '3×10', 'sets': 4, 'reps': 12, 'seconds': 30, 'rest_s': 45, 'per_side': True}
meta = {'slug': 'session-dose', 'kind': 'session', 'theme': 'strength', 'title': 'Dose session', 'format': '60 s rest', 'why': 'Move.', 'key_points': ['Breathe.'], 'source': {'url': 'https://example.test/video'}, 'items': [item]}
posted = []
rb._read_session = lambda directory, session: [('move', None, {'theme': 'strength'})]
rb.session = lambda: {'user_id': 'u1'}
rb._known_themes = lambda cfg: ['strength']
rb._check_theme = lambda *args: None
rb._publish_sheet = lambda *args: None
rb._drop_v1_sessions = lambda *args: None
def rest(cfg, method, table, data=None, **kwargs):
    if method == 'POST' and table == 'sessions': posted.append(data)
    return [{'id': 'one'}]
rb.rest = rest
rb._publish_session(pathlib.Path('/unused'), meta)
print(json.dumps(posted[0]['items'], ensure_ascii=False))`;
  const run = spawnSync('python3', ['-c', code], {cwd: root, encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  const line = run.stdout.trim().split('\n').at(-1);
  assert.deepEqual(JSON.parse(line), [{slug: 'move', dose: '3×10', sets: 4, reps: 12, seconds: 30, rest_s: 45, per_side: true}]);
});
