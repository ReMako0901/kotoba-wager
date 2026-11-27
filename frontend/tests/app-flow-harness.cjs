const flush = () => new Promise(resolve => setImmediate(resolve));
const initialStory = { id: 'initial', title: '検証用の物語', text: '猫が来た。' };

function drawStories(url) {
  return url.endsWith('/stories/draw') ? { stories: [initialStory], exhausted: false } : undefined;
}

async function startStory(ui) {
  global.crypto = require('node:crypto').webcrypto;
  ui.click('はじめる');
  ui.click('スキップ');
  await flush(); ui.draw(); ui.click('プリセットの文で始める');
  await flush();
  ui.draw();
  ui.click(initialStory.title);
  await flush();
  ui.draw();
  if (ui.find(n => n.props['data-screen'] === 'marks')) {
    const word = ui.find(n => n.props.className === 'vertical-word');
    ui.click(word.props['aria-label']);
    ui.click('これで始める');
    await flush(); ui.draw();
  }
}

module.exports = { drawStories, startStory };
