const { drawStories, startStory } = require('./app-flow-harness.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mount, text } = require('./component-harness.cjs');
const { stageMount, PortraitPublisher } = require('./anoma-stage-harness.cjs');
const { expressionPools, expressionForTrigger, expressionForEnding, expressionForExtension, reactionTrigger } = require('../src/scenario.ts');
const { resultReaction } = require('../src/Anoma.tsx');
const App = require('../src/App.tsx').default;
const flush = () => new Promise(resolve => setImmediate(resolve));
const tx = (id, strength = 0, lost = 0) => ({ id, status: 'committed', outcome: 'loss', gamble: { strength }, lost: Array(lost).fill({}) });

test('expression pools have the specified ranges, cover all candidates and are deterministic', () => {
  assert.deepEqual(expressionPools, { gain: ['smile', 'wink', 'satisfied'], winStreak: ['laugh', 'giggle'], loss: ['taunt', 'composed'], lossStreak: ['deadpan', 'composed'], change: ['smile', 'giggle'] });
  for (const [trigger, pool] of Object.entries(expressionPools)) {
    const seen = new Set();
    for (let i = 0; i < 100; i++) {
      const round = tx(`round-${i}`);
      const face = expressionForTrigger(trigger, round);
      assert.ok(pool.includes(face));
      assert.equal(expressionForTrigger(trigger, JSON.parse(JSON.stringify(round))), face);
      seen.add(face);
    }
    assert.deepEqual([...seen].sort(), [...pool].sort());
  }
  for (const [difference, pool] of [[5, ['smile', 'satisfied']], [0, ['deadpan']], [-5, ['deadpan', 'composed']]]) {
    const seen = new Set();
    for (let i = 0; i < 100; i++) {
      const key = JSON.stringify({ rounds: i, difference });
      const face = expressionForEnding(difference, key);
      assert.ok(pool.includes(face));
      assert.equal(expressionForEnding(difference, key), face);
      seen.add(face);
    }
    assert.deepEqual([...seen].sort(), pool.sort());
  }
  const extension = Array.from({ length: 100 }, (_, i) => expressionForExtension(String(i)));
  assert.deepEqual([...new Set(extension)].sort(), ['composed', 'taunt']);
  assert.deepEqual(extension, Array.from({ length: 100 }, (_, i) => expressionForExtension(String(i))));
});

test('change classification stays at 6/2 and uncanny is never selected', () => {
  for (const strength of [0, 5, 6, 7, 8, 9]) for (const lost of [0, 1, 2, 3, 4]) {
    const history = [tx('threshold', strength, lost)];
    const change = strength >= 6 || lost >= 2;
    assert.equal(reactionTrigger(history), change ? 'change' : 'loss');
    const result = resultReaction(history);
    assert.notEqual(result.expression, 'uncanny');
    if (change) assert.ok(['smile', 'giggle'].includes(result.expression));
    assert.deepEqual(resultReaction(JSON.parse(JSON.stringify(history))), result);
  }
});

test('new faces use named open/closed assets and missing assets preserve dialogue', () => {
  for (const expression of ['wink', 'giggle', 'satisfied', 'exasperated', 'worried', 'deadpan', 'composed']) {
    const ui = stageMount(PortraitPublisher, { expression, line: '台詞を保持' });
    const image = ui.find(n => n.type === 'img' && n.props.className.includes('current'));
    assert.equal(image.props.src, `/anoma/${expression}.webp`);
    image.props.onLoad(); ui.draw(); image.props.onAnimationEnd(); ui.draw();
    const closed = ui.find(n => n.props.className?.startsWith('anoma-portrait-closed'));
    assert.equal(closed.props.src, `/anoma/${expression}-closed.webp`);
    closed.props.onError(); ui.draw();
    assert.ok(ui.find(n => n.type === 'img' && n.props.className.includes('current')));
    image.props.onError(); ui.draw();
    assert.equal(ui.all(n => n.type === 'img').length, 0);
    assert.match(text(ui.tree), /台詞を保持/);
    ui.unmount();
  }
});

test('game hides intro, omits reward descriptions and opens only on selection completion', async () => {
  for (const required_count of [1, 2, 3]) {
    const session = { id: 'saved', betting_mode: 'count-v1', status: 'ready', view: 'select', version: 1,
      title: '長い物語のタイトル', intro: 'ゲーム画面では隠す導入', text: '猫犬鳥月', transactions: [], lost_concepts: [], usage: {},
      offers: [{ id: 'reward', title: '出会い', description: '新しい相手に出会う', required_count, family: 'plot' }],
      analysis: { units: [...'猫犬鳥月'].map((word, i) => ({ id: String(i), text: word, start: i, end: i + 1, stakeable: true })) } };
    const requests = [];
    global.fetch = async (url, options) => {
      requests.push([url, options.method]);
      return { ok: true, json: async () => url.endsWith('/games') ? { games: [{ id: 'dice', name: 'サイコロ', tier: 'beginner' }] } : drawStories(url) ?? session };
    };
    const ui = mount(App, {}); await flush(); ui.draw();
    await startStory(ui);
    assert.doesNotMatch(text(ui.tree), /ゲーム画面では隠す導入/);
    assert.doesNotMatch(text(ui.tree), /新しい相手に出会う/);
    assert.doesNotMatch(text(ui.tree), /展開系|表現系/);
    ui.click('出会い');
    assert.equal(ui.find(n => n.props.className === 'reward-summary'), undefined);
    const bar = ui.find(n => n.props.className === 'paper-tabs wager-tabs');
    assert.match(text(bar), new RegExp(`出会い・${required_count}個 変更`));
    assert.match(text(bar), new RegExp(`0 / ${required_count}`));
    const gameModal = () => ui.find(n => n.props.className === 'scene-object object-games');
    for (let i = 0; i < required_count; i++) {
      assert.equal(gameModal(), undefined);
      ui.click([...'猫犬鳥'][i]);
    }
    assert.ok(gameModal());
    ui.click('閉じる'); ui.draw(); ui.draw();
    assert.equal(gameModal(), undefined);
    ui.click('変更');
    ui.find(n => n.type === 'button' && n.props.className === 'reward-option').props.onClick(); ui.draw();
    assert.equal(gameModal(), undefined);
    ui.click('ギャンブルを選ぶ'); assert.ok(gameModal()); ui.click('閉じる');
    ui.click('月'); assert.equal(gameModal(), undefined); // Too many.
    ui.click('月'); assert.ok(gameModal()); ui.click('閉じる'); // Ready again.
    ui.click('猫'); assert.equal(gameModal(), undefined);
    ui.click('猫'); assert.ok(gameModal());
    assert.ok(requests.every(([url]) => !url.endsWith('/transactions')), 'opening never starts a wager');
    assert.equal(session.intro, 'ゲーム画面では隠す導入');
    ui.unmount();
  }
  const app = fs.readFileSync('frontend/src/App.tsx', 'utf8');
  assert.match(app, /story\.intro/); // Story selection card keeps its intro.
  assert.doesNotMatch(app, /session\.intro/);
  const css = fs.readFileSync('frontend/src/notebook.css', 'utf8');
  assert.match(css, /\.game-heading \{[^}]*display: flex/);
  assert.match(css, /\.game-heading \.story-title \{[^}]*min-width: 0[^}]*white-space: nowrap[^}]*text-overflow: ellipsis/);
});
