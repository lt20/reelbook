const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const rbPath = path.join(__dirname, '../../../tools/rb.py');
const prelude = `import importlib.util, json, sys\nspec = importlib.util.spec_from_file_location('rb', sys.argv[1])\nrb = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(rb)\n`;
function python(source) {
  const result = spawnSync('python3', ['-B', '-c', prelude + source, rbPath], {encoding: 'utf8', env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

test('Writing it — publish derives search_text from visible sheet HTML and kit pills, collapses space and caps it at 4 000 characters', () => {
  const row = python(`
class File:
    def read_text(self):
        return '<html><head><style>.secret{display:none}</style><script>hidden_script</script></head><body><p>  Visible  words </p><div class="kit"><span>tapis</span></div><p>' + 'x' * 4100 + '</p></body></html>'
class Images:
    def is_dir(self): return False
class Folder:
    def __truediv__(self, name): return Images() if name == 'img' else File()
def rest(cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
    assert method == 'POST' and path == 'sheets'
    print(json.dumps(data))
    return [{'id': 'saved'}]
rb.rest = rest
rb._publish_sheet({'user_id': 'u1'}, Folder(), {'slug': 'floor', 'theme': 'strength', 'group': 'Arms', 'title': 'Floor'})
`);
  assert.match(row.search_text, /Visible words/);
  assert.match(row.search_text, /tapis/);
  assert.doesNotMatch(row.search_text, /hidden_script|\.secret|<[^>]+>/);
  assert.doesNotMatch(row.search_text, /\s{2,}/);
  assert.ok(row.search_text.length <= 4000);
});

test('Writing it — backfill-search updates only empty search_text rows of the signed-in account; --dry-run writes none', () => {
  const result = python(`
calls = []
rows = [
    {'slug': 'empty', 'html': '<p>  tapis   au sol </p>', 'search_text': ''},
    {'slug': 'filled', 'html': '<p>changed</p>', 'search_text': 'already indexed'}
]
def rest(cfg, method, path, data=None, prefer=None, params=None, tolerate=()):
    assert cfg['user_id'] == 'u1' and path == 'sheets'
    calls.append((method, params, data))
    if method == 'GET': return rows
    return [{'id': 'saved'}]
rb.session = lambda: {'url': 'https://example.test', 'anon_key': 'k', 'access_token': 't', 'user_id': 'u1'}
rb.rest = rest
rb.COMMANDS['backfill-search'](['--dry-run'])
dry = [c for c in calls if c[0] in ('POST', 'PATCH', 'PUT', 'DELETE')]
calls.clear()
rb.COMMANDS['backfill-search']([])
print(json.dumps({'dry': dry, 'calls': calls}))
`);
  assert.deepEqual(result.dry, []);
  const writes = result.calls.filter(([method]) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method));
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0][1].slug, 'eq.empty');
  assert.match(writes[0][2].search_text, /tapis au sol/);
});
