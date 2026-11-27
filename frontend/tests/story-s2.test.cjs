const { drawStories, startStory } = require('./app-flow-harness.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mount, text } = require('./component-harness.cjs');
const { stageMount } = require('./anoma-stage-harness.cjs');
const { NormalEnding } = require('../src/StoryProgress.tsx');
const { normalEnding, normalEndings, extensionWelcome } = require('../src/scenario.ts');
const progress = (phase, difference=1) => ({ phase, totals: { rounds: 5, gained: 3, lost: 2, difference }, extension_start: 5 });

test('all S2/S3 lines are confirmed and endings use only the sign', () => {
  const design = fs.readFileSync('docs/STORY_DESIGN.md', 'utf8');
  for (const line of [...Object.values(normalEndings).flat(), ...extensionWelcome]) assert.ok(design.includes(line), line);
  for (const value of [1, 20]) assert.deepEqual(normalEnding(value), normalEndings.positive);
  for (const value of [-1, -20]) assert.deepEqual(normalEnding(value), normalEndings.negative);
  assert.deepEqual(normalEnding(0), normalEndings.zero);
});
test('ending renders all final lines and returns to title', () => {
  for (const difference of [-3, 0, 4]) {
    let title = false;
    const ui = stageMount(NormalEnding, { progress: progress('ended', difference), onTitle: () => title = true });
    for (const label of ['総勝負回数', '獲得数', '喪失数', '差分']) assert.ok(text(ui.tree).includes(label));
    for (const line of normalEnding(difference)) {
      ui.click('次へ');
      assert.ok(text(ui.tree).includes(line));
    }
    ui.click('タイトルへ戻る'); assert.ok(title);
  }
});


test('App handles reaching the goal and escaping for all games', async () => {
  const App = require('../src/App.tsx').default;
  const flush = () => new Promise(resolve => setImmediate(resolve));
  for (const kind of ['rps', 'card_guess', 'chinchiro', 'slot', 'blackjack', 'baccarat']) {
    global.crypto = require('node:crypto').webcrypto;
    let saved = { id: 'saved-story', betting_mode: 'count-v1', title: '物語', text: '猫が来た。', version: 6,
      status: 'ready', view: 'result', offers: [], lost_concepts: [], usage: {},
      transactions: [{ id: 'last', status: 'committed', outcome: 'win', before: '猫が来た。', after: '猫が来た。', stakes: ['猫'], lost: [], offer: { title: '報酬' }, gamble: { kind, strength: 1 } }],
      story_progress: progress('escapable') };
    const choices = [];
    global.fetch = async (url, options) => {
      if (url.endsWith('/games')) return { ok: true, json: async () => ({ games: [] }) };
      if (url.endsWith('/story-choice')) {
        const body = JSON.parse(options.body); choices.push(body);
        saved = { ...saved, story_progress: { ...saved.story_progress, phase: 'ended' } };
      }
      return { ok: true, json: async () => drawStories(url) ?? saved };
    };
    const ui = mount(App, {}); await flush(); ui.draw(); ui.draw();
    await startStory(ui);
    assert.ok(!text(ui.tree).includes('さらに賭ける'), kind);
    assert.ok(!text(ui.tree).includes('総勝負回数'));
    assert.ok(text(ui.tree).includes('まだ続ける'));
    assert.ok(!text(ui.tree).includes('次は何をねらう？'));
    ui.click('脱出する'); await flush(); ui.draw();
    assert.equal(choices[0].choice, 'escape');
    assert.equal(choices[0].version, 6);
    assert.equal(text(ui.tree).includes('ノーマルエンディング'), false);
    for (let i = 0; i < normalEnding(1).length; i++) ui.click('次へ');
    assert.ok(text(ui.tree).includes('タイトルへ戻る'));
    ui.click('タイトルへ戻る');
    assert.ok(!text(ui.tree).includes('つづきから'));
  }
});

test('shorter final text uses neutral dialogue and retains positive totals', () => {
  const ui = mount(NormalEnding, { progress: progress('ended', 1), shorter: true, onTitle() {} });
  assert.ok(text(ui.tree).includes('+1個'));
  ui.click('次へ');
  assert.ok(text(ui.tree).includes(normalEnding(0)[0]));
});

test('continuing welcomes the player at reward selection and leaves escape available on later results', async () => {
  const App = require('../src/App.tsx').default;
  const flush = () => new Promise(resolve => setImmediate(resolve));
  let saved = { id: 'extension', betting_mode: 'count-v1', title: '物語', text: '猫が来た。', version: 6,
    status: 'ready', view: 'result', offers: [], lost_concepts: [], usage: {},
    transactions: [{ id: 'last', status: 'committed', presentation_completed: true, outcome: 'win',
      before: '猫が来た。', after: '猫が来た。', stakes: ['猫'], lost: [], offer: { title: '報酬' } }],
    story_progress: progress('escapable') };
  const choices = [];
  global.fetch = async (url, options) => {
    if (url.endsWith('/games')) return { ok: true, json: async () => ({ games: [] }) };
    if (url.endsWith('/story-choice')) {
      const { choice } = JSON.parse(options.body);
      choices.push(choice);
      saved = { ...saved, story_progress: progress(choice === 'continue' ? 'extension' : 'ended') };
    }
    if (url.endsWith('/continue')) saved = { ...saved, view: 'game' };
    return { ok: true, json: async () => drawStories(url) ?? saved };
  };
  let ui = mount(App, {});
  await startStory(ui);
  ui.click('まだ続ける'); await flush(); ui.draw();
  assert.ok(text(ui.tree).includes('あら、もう帰っていいのに。物好きね。'));
  assert.ok(text(ui.tree).includes('何が欲しい？'));
  ui.unmount();

  saved = { ...saved, version: 7, view: 'result' };
  ui = mount(App, {});
  await startStory(ui);
  const labels = text(ui.find(n => n.props?.className === 'paper-tabs result-tabs'));
  assert.match(labels, /脱出する.*次は何をねらう？/);
  assert.ok(!labels.includes('まだ続ける'));
  ui.click('脱出する'); await flush(); ui.draw();
  assert.deepEqual(choices, ['continue', 'escape']);
  assert.ok(text(ui.tree).includes('総勝負回数'));
});
