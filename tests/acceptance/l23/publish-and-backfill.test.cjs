const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const rbPath = path.join(__dirname, '../../../tools/rb.py');
const prelude = "import importlib.util, json, sys, tempfile, pathlib, contextlib, io\nspec = importlib.util.spec_from_file_location('rb', sys.argv[1])\nrb = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(rb)\n";
function python(source) {
  const result = spawnSync('python3', ['-B', '-c', prelude + source, rbPath], {encoding: 'utf8', env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

const setup = `
CFG = {'url': 'https://example.test', 'anon_key': 'k', 'access_token': 't', 'user_id': 'u1'}
rb.session = lambda: CFG
rb._known_themes = lambda cfg: {'strength'}
def folder(root, tags):
    d = pathlib.Path(root) / 'sheet'
    d.mkdir()
    (d / 'meta.json').write_text(json.dumps({'slug': 'sheet', 'kind': 'sheet', 'theme': 'strength', 'group': 'Shoulders', 'title': 'Band rotation', 'duration': '8 min', 'tags': tags}))
    (d / 'index.html').write_text('<p>Band rotation</p>')
    return d
`;

test('Publish — a new sheet with unknown facet values is refused before any write', () => {
  const result = python(setup + `
calls = []
def rest(cfg, method, table, data=None, prefer=None, params=None, tolerate=()):
    calls.append((method, table))
    return []
rb.rest = rest
with tempfile.TemporaryDirectory() as root:
    d = folder(root, {'zone': ['elbow'], 'gear': ['band'], 'minutes': 8, 'type': 'mobility'})
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        try: rb.cmd_publish([str(d)]); refused = False
        except SystemExit: refused = True
print(json.dumps({'refused': refused, 'calls': calls, 'error': err.getvalue()}))
`);
  assert.equal(result.refused, true);
  assert.equal(result.calls.some(([method]) => method !== 'GET'), false);
  assert.match(result.error, /elbow/);
});

test('Publish — an existing sheet with an unknown facet value gets a warning and is still updated', () => {
  const result = python(setup + `
calls = []
def rest(cfg, method, table, data=None, prefer=None, params=None, tolerate=()):
    calls.append((method, table, data))
    if method == 'GET' and table == 'sheets': return [{'slug': 'sheet'}]
    if method == 'POST': return [{'id': 'saved'}]
    return []
rb.rest = rest
with tempfile.TemporaryDirectory() as root:
    d = folder(root, {'zone': ['elbow'], 'gear': ['band'], 'minutes': 8, 'type': 'mobility'})
    err = io.StringIO()
    with contextlib.redirect_stderr(err): rb.cmd_publish([str(d)])
print(json.dumps({'calls': calls, 'warning': err.getvalue()}))
`);
  const post = result.calls.find(([method, table]) => method === 'POST' && table === 'sheets');
  assert.ok(post);
  assert.deepEqual(post[2].tags, {zone: ['elbow'], gear: ['band'], minutes: 8, type: 'mobility'});
  assert.match(result.warning, /warning[\s\S]*elbow/i);
});

test('Publish — valid tags are sent; a backend without sheets.tags is retried without that column', () => {
  const result = python(setup + `
calls = []
def rest(cfg, method, table, data=None, prefer=None, params=None, tolerate=()):
    if method == 'POST':
        calls.append(dict(data))
        if 'tags' in data: raise rb.RbHTTPError(400, '{"code":"PGRST204","message":"Could not find the tags column of sheets in the schema cache"}')
        return [{'id': 'saved'}]
    return []
rb.rest = rest
with tempfile.TemporaryDirectory() as root:
    d = folder(root, {'zone': ['shoulders'], 'gear': ['band'], 'minutes': 8, 'type': 'mobility'})
    with contextlib.redirect_stderr(io.StringIO()): rb.cmd_publish([str(d)])
print(json.dumps(calls))
`);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].tags, {zone: ['shoulders'], gear: ['band'], minutes: 8, type: 'mobility'});
  assert.equal(Object.hasOwn(result[1], 'tags'), false);
  assert.equal(result[1].slug, 'sheet');
});

test('Backfill-tags — group, search text or title, and duration derive tags without Claude; dry run writes nothing', () => {
  const result = python(`
CFG = {'url': 'https://example.test', 'anon_key': 'k', 'access_token': 't', 'user_id': 'u1'}
rb.session = lambda: CFG
rows = [
  {'slug': 'rotation', 'theme': 'strength', 'group': 'Shoulders', 'title': 'Band rotation', 'search_text': 'A gentle mobility drill with a band', 'duration': '8 min', 'tags': {}},
  {'slug': 'legacy', 'theme': 'strength', 'group': 'Knees', 'title': 'Mat stretch', 'search_text': '', 'duration': '4 min', 'tags': {}}
]
calls = []
def rest(cfg, method, table, data=None, prefer=None, params=None, tolerate=()):
    calls.append((method, table, data, params))
    if method == 'GET': return rows
    return [{'id': 'saved'}]
rb.rest = rest
with contextlib.redirect_stdout(io.StringIO()): rb.COMMANDS['backfill-tags'](['--dry-run'])
dry = list(calls)
calls.clear()
with contextlib.redirect_stdout(io.StringIO()): rb.COMMANDS['backfill-tags']([])
print(json.dumps({'dry': dry, 'calls': calls}))
`);
  assert.equal(result.dry.some(([method]) => method !== 'GET'), false);
  const writes = result.calls.filter(([method, table]) => method === 'PATCH' && table === 'sheets');
  assert.equal(writes.length, 2);
  const bySlug = Object.fromEntries(writes.map(([, , data, params]) => [params.slug.slice(3), data.tags]));
  assert.deepEqual(bySlug.rotation, {zone: ['shoulders'], gear: ['band'], minutes: 8, type: 'mobility'});
  assert.equal(bySlug.legacy.minutes, 4);
  assert.deepEqual(bySlug.legacy.zone, ['knees']);
  assert.ok(bySlug.legacy.gear.includes('mat'));
  assert.equal(bySlug.legacy.type, 'stretch');
  for (const [, , , params] of writes) assert.equal(params.user_id, 'eq.u1');
});
