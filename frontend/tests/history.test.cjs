// Run: node --test frontend/tests/history.test.cjs
// Compile the real TS/TSX modules in memory; no generated files or extra dependencies.
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const local = createRequire(path.resolve(__dirname, '../package.json'));
const ts = local('typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  }, fileName: filename });
  module._compile(result.outputText, filename);
};
const React = local('react');
const { renderToStaticMarkup } = local('react-dom/server');
const { storyVersions, changedCharacters } = require('../src/storyVersions.ts');
const { StoryComparison, StoryHistory } = require('../src/StoryHistory.tsx');
const tx = (source, before, after, outcome = 'win') => ({ id: `tx-${source}`, source_version: source,
  before, after, outcome, status: 'committed', stakes: ['鍵'], offer: { title: '新しい出会い' } });
const session = transactions => ({ version: 3, text: '最新の本文。', transactions,
  lost_concepts: [], api_calls: 0, model: 'test', usage: { input: 0, output: 0 } });
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test('versions use source version order and exclude uncommitted drafts without mutating data', () => {
  const s = session([tx(2, '中間。', '最新の本文。', 'loss'), tx(1, '最初。', '中間。'),
    { ...tx(3, '最新の本文。', '秘密の下書き。'), status: 'awaiting_reveal' }]);
  const original = JSON.stringify(s);
  assert.deepEqual(storyVersions(s).map(v => [v.version, v.round, v.text]),
    [[1, 0, '最初。'], [2, 1, '中間。'], [3, 2, '最新の本文。']]);
  assert.equal(JSON.stringify(s), original);
});
test('initial session and legacy transactions without source_version remain readable', () => {
  assert.deepEqual(storyVersions({ ...session([]), version: 1 }).map(v => v.text), ['最新の本文。']);
  const old = tx(1, '最初。', '中間。'); delete old.source_version;
  assert.deepEqual(storyVersions(session([old])).map(v => v.version), [1, 2]);
});
test('diff highlights additions, deletions, replacements, repeated characters and Unicode', () => {
  for (const [before, after, removed, added] of [
    ['鍵。', '金の鍵。', '', '金の'], ['金の鍵。', '鍵。', '金の', ''],
    ['猫。', '犬。', '猫', '犬'], ['ああ。', 'あ。', 'あ', ''], ['🐈。', '🌙。', '🐈', '🌙'],
  ]) {
    const diff = changedCharacters(before, after);
    const selected = (text, indices) => Array.from(text).filter((_, i) => indices.has(i)).join('');
    assert.equal(selected(before, diff.before), removed);
    assert.equal(selected(after, diff.after), added);
  }
  assert.equal(changedCharacters('同じ。', '同じ。').after.size, 0);
});
test('win and loss results render both full texts and persistent highlighted changes together', () => {
  for (const outcome of ['win', 'loss']) {
    const transaction = tx(1, '猫。', '犬。', outcome);
    const html = render(StoryComparison, transaction);
    assert.match(html, /変化前/); assert.match(html, /変化後/);
    assert.match(html, /class="diff-before">猫/); assert.match(html, /class="diff-after">犬/);
  }
  const app = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8');
  assert.match(app, /<StoryComparison before=\{last.before\} after=\{last.after \?\? session.text\}/);
});
test('history opens every version and compares initial and latest snapshots', () => {
  const html = render(StoryHistory, { session: session([tx(1, '最初。', '中間。'), tx(2, '中間。', '最新の本文。', 'loss')]) });
  for (const label of ['最初と最新を比べる', '最初・第1版', '最新・第3版', '第1ラウンド', '第2ラウンド', '勝利', '敗北', '賭けた言葉：鍵', '報酬：新しい出会い']) assert.ok(html.includes(label), label);
  assert.match(html, /<details><summary>最初の物語/);
  assert.match(html, /class="version-text" tabindex="0">中間。/);
});
test('history contains only supplied session and escapes player text', () => {
  const html = render(StoryHistory, { session: session([tx(1, '<script>危険</script>', '自分の本文。')]) });
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('別セッションの本文')); assert.ok(!html.includes('fetch('));
});
