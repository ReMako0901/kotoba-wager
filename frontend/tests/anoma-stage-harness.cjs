const { mount } = require('./component-harness.cjs');
const { jsx, jsxs } = require('react/jsx-runtime');
const { AnomaStageProvider, AnomaStage, StagePublisher } = require('../src/Anoma.tsx');
function stageMount(Component, props) {
  function StageScreen(screenProps) {
    return jsxs(AnomaStageProvider, { children: [jsx(AnomaStage, {}), jsx(Component, screenProps)] });
  }
  return mount(StageScreen, props);
}
function PortraitPublisher({ line, expression }) {
  return jsx(StagePublisher, { lines: [line], expression });
}
module.exports = { stageMount, PortraitPublisher };
