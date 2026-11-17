const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mount, text } = require('./component-harness.cjs');
const { Manuscript, WagerManuscript, paperRows } = require('../src/Manuscript.tsx');
const { StoryPaperStack, StoryHistory } = require('../src/StoryHistory.tsx');
const { GenerationSkeleton } = require('../src/GambleMotion.tsx');
const App = require('../src/App.tsx').default;
const source = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
const tx = { id: 'tx', status: 'committed', source_version: 1, before: '猫が来た。', after: '犬が来た。', stakes: ['猫'], offer: { title: '出会い' }, outcome: 'win' };
const session = { id: 'saved', betting_mode: 'count-v1', status: 'ready', view: 'result', version: 2, text: tx.after, transactions: [tx], offers: [], lost_concepts: [], title: '物語', model: 'PRIVATE_MODEL', usage: { input: 999, output: 999 } };
const flush = () => new Promise(resolve => setImmediate(resolve));
function environment(saved) {
  const values = new Map(saved ? [['story-wager-session-count-v1', 'saved']] : []);
  global.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const requests = [];
  global.fetch = async url => { requests.push(url); return { ok: true, json: async () => url.endsWith('/games') ? { games: [] } : session }; };
  return requests;
}
test('title always contains subtitle and help; resume only after a session is available', async () => {
  environment(false);
  let ui = mount(App, {}); await flush(); ui.draw();
  assert.match(text(ui.tree), /言葉を賭けて、物語を書き換える/);
  assert.match(text(ui.tree), /遊び方/);
  assert.doesNotMatch(text(ui.tree), /つづきから/);
  ui.click('遊び方'); assert.match(text(ui.tree), /勝てば報酬/);
  const requests = environment(true);
  ui = mount(App, {}); await flush(); ui.draw(); ui.draw();
  assert.match(text(ui.tree), /つづきから/);
  ui.click('つづきから'); await flush(); ui.draw();
  assert.ok(ui.find(n => n.props.className === 'story-title'));
  assert.equal(requests.filter(url => url.endsWith('/sessions/saved')).length, 2);
  ui.click('タイトルへ');
  assert.match(text(ui.tree), /進行は残っています/);
  assert.match(text(ui.tree), /遊び方/);
});
test('long manuscripts use fixed rows, fixed cells, and place every glyph inside the grid', () => {
  for (const body of ['短い。', '長い本文。'.repeat(50), '一行目。\n\n二行目。'.repeat(8), '🐈と月。'.repeat(30)]) {
    const ui = mount(Manuscript, { text: body, dust: { grains: new Map() }, losses: [] });
    const paper = ui.find(n => n.props.className === 'vertical-paper');
    assert.equal(paperRows(), 10);
    const glyphs = ui.all(n => n.props.className?.split(' ').includes('ink-glyph')).map(text).join('');
    assert.equal(glyphs, body.replace(/\n/g, ''));
    for (const node of ui.all(n => n.props.style?.gridRow)) {
      const [start, span = 'span 1'] = String(node.props.style.gridRow).split(' / ');
      assert.ok(Number(start) + Number(span.replace('span ', '')) - 1 <= paperRows());
    }
  }
  assert.equal(paperRows(), 10);
});
test('stakeable fragments keep the same selection across a column boundary', () => {
  const units = [{ id: 'a', text: 'これは長い前置きで', stakeable: false }, { id: 'b', text: '花の上を', stakeable: true }, { id: 'c', text: '歩いた。', stakeable: false }];
  const toggles = [];
  const ui = mount(WagerManuscript, { text: units.map(u => u.text).join(''), units, selected: ['b'], disabled: false, onToggle: id => toggles.push(id), dust: { grains: new Map() }, losses: [] });
  assert.equal(ui.all(n => n.type === 'button').length, 2);
  const button = ui.find(n => n.type === 'button');
  assert.equal(ui.all(n => n.type === 'button').map(text).join(''), '花の上を');
  for (const fragment of ui.all(n => n.type === 'button')) {
    assert.equal(fragment.props['aria-pressed'], true);
    fragment.props.onClick();
  }
  assert.deepEqual(toggles, ['b', 'b']);
});
test('history uses plays and shares controlled page index; changes stay highlighted on latest manuscript', () => {
  let current;
  const props = { session, dust: { grains: new Map() }, losses: [], pageIndex: 0, onPageChange: i => { current = i; }, highlight: true };
  const ui = mount(StoryPaperStack, props);
  assert.match(text(ui.tree), /第1版/);
  const corner = ui.find(n => n.props.role === 'slider');
  corner.props.onKeyDown({ key: 'Enter', preventDefault() {} }); ui.draw(); ui.tick();
  assert.equal(current, 1);
  ui.draw({ ...props, pageIndex: current });
  assert.ok(ui.find(n => n.props.className?.includes('show-changes')));
  assert.ok(ui.find(n => n.props.className?.includes('result-change')));
  const history = mount(StoryHistory, { session, pageIndex: current });
  assert.match(text(history.tree), /第2版/); assert.match(text(history.tree), /プレイ 1回/);
  assert.doesNotMatch(text(history.tree), /PRIVATE_MODEL|tokens|999|生成 \d回/);
});
test('generation uses the same paper while waiting and ready, with elapsed clue and completion', () => {
  const ui = mount(GenerationSkeleton, {});
  assert.match(text(ui.tree), /秒経過/);
  assert.ok(ui.find(n => n.props.className === 'skeleton-paper'));
  ui.draw({ complete: true });
  assert.match(text(ui.tree), /準備完了/);
  assert.equal(ui.find(n => n.props.className === 'generation-skeleton').props['aria-busy'], false);
  assert.ok(ui.find(n => n.props.className === 'skeleton-paper'));
});
test('round reset, help copy, history availability and fixed cell definition remain explicit', () => {
  const app = source('App.tsx');
  assert.match(app, /setGameTier\('beginner'\)/);
  assert.match(app, /赤線の言葉をタップ/);
  assert.match(app, /あと\{MIN_STORY - customCount\}文字/);
  assert.doesNotMatch(app, /disabled=\{gambleMode\}|33％|％〜/);
  assert.match(app, /setPaperIndex\(session.transactions/);
  assert.match(source('manuscript.css'), /--cell-size: 32px/);
  assert.doesNotMatch(source('Manuscript.tsx'), /MAX_ROWS|rows = 9/);
});
test('gamble tier resets to beginner after a new version and history opens during a gamble', async () => {
  environment(true);
  const offer = { id: 'offer', title: '報酬候補', description: '物語が変わる', required_count: 1 };
  let response = { ...session, view: 'game', version: 3, transactions: [], offers: [offer], analysis: { units: [{ id: 'unit', text: '猫', stakeable: true }, { id: 'rest', text: 'が来た。', stakeable: false }] }, text: '猫が来た。' };
  global.fetch = async url => ({ ok: true, json: async () => url.endsWith('/games') ? { games: [{ id: 'rps', tier: 'beginner', name: 'じゃんけん', win_probability: .33 }, { id: 'slot', name: 'スロット', win_probability: .5 }] } : response });
  const ui = mount(App, {}); await flush(); ui.draw(); ui.draw();
  ui.click('つづきから'); await flush(); ui.draw();
  const choose = () => { ui.click('報酬候補'); ui.click('猫'); ui.click('ギャンブルを選ぶ'); };
  choose(); ui.click('上級者');
  assert.equal(ui.find(n => n.type === 'button' && text(n) === '上級者').props['aria-pressed'], true);
  ui.click('閉じる'); ui.click('タイトルへ');
  response = { ...response, version: 4 };
  ui.click('つづきから'); await flush(); ui.draw(); ui.draw();
  choose();
  assert.equal(ui.find(n => n.type === 'button' && text(n) === '初心者').props['aria-pressed'], true);
  ui.click('閉じる'); ui.click('タイトルへ');
  response = { ...response, version: 5, status: 'playing', transactions: [{ ...tx, status: 'playing', presentation_completed: false, gamble: { kind: 'rps', moves: [] } }] };
  ui.click('つづきから'); await flush(); ui.draw(); ui.draw();
  assert.match(text(ui.tree), /賭けた言葉：猫/);
  ui.click('取引履歴'); assert.match(text(ui.tree), /物語の変遷/);
});
