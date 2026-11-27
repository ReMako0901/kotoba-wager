const test = require('node:test');
const assert = require('node:assert/strict');
const { mount, text } = require('./component-harness.cjs');
const { drawStories } = require('./app-flow-harness.cjs');
const App = require('../src/App.tsx').default;
const flush = () => new Promise(resolve => setImmediate(resolve));

test('印を確定した後だけ報酬を表示し、印付きの賭けだけ確認する', async () => {
  global.crypto = require('node:crypto').webcrypto;
  const words = ['猫', '犬', '花', '星'];
  const units = words.map((word, i) => ({ id: String(i), text: word, start: i, end: i + 1, stakeable: true }));
  const session = { id: 'testmarks', version: 1, text: words.join(''), betting_mode: 'count-v1',
    status: 'ready', title: '原稿', offers: [{ id: 'gift', title: '報酬候補', required_count: 1 }],
    transactions: [], analysis: { units } };
  global.fetch = async (url, options) => {
    if (url.endsWith('/marks')) {
      session.marked_unit_ids = JSON.parse(options.body).unit_ids;
      assert.deepEqual(session.marked_unit_ids, ['0']);
    }
    return { ok: true, json: async () => drawStories(url) ?? (url.endsWith('/games') ? { games: [] } : session) };
  };
  const ui = mount(App, {}, true);
  ui.click('はじめる'); ui.click('スキップ');
  await flush(); ui.draw(); ui.click('プリセットの文で始める');
  await flush(); ui.draw(); ui.click('検証用の物語');
  await flush(); ui.draw();
  assert.doesNotMatch(text(ui.tree), /報酬候補/);
  ui.click('犬');
  ui.click('犬（印付き）');
  assert.match(text(ui.tree), /0 \/ 1/);
  ui.click('犬');
  ui.click('猫');
  assert.match(text(ui.tree), /1 \/ 1/);
  ui.click('これで始める'); await flush(); ui.draw();
  ui.click('報酬候補'); ui.click('猫（印付き）'); ui.click('選び直す');
  assert.equal(ui.find(n => n.props['aria-label'] === '猫（印付き）').props['aria-pressed'], false);
  ui.click('猫（印付き）'); ui.click('このまま賭ける');
  assert.match(text(ui.tree), /どのギャンブルにする/);
  ui.click('閉じる'); ui.click('クリア'); ui.click('星');
  assert.match(text(ui.tree), /どのギャンブルにする/);
  assert.doesNotMatch(text(ui.tree), /選び直す/);
});
