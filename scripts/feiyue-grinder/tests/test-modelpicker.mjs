// v2.10 模型下拉(对齐 Solver/希冀)纯逻辑测试。
// 回归点:旧版「自定义端点」点刷新读的是已保存 CFG 而非实时框 → 拉不到/选不了模型。
// 新版改成常驻下拉:缓存(拉取结果)+内置建议+当前/预设模型去重,未命中走「其他/自定义…」文本框兜底。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { modelOptions, fillModelSelect, pickModel, OTHER } from './sxz-core.mjs';

const SUGGEST = ['gpt-5.5', 'deepseek-v4-flash', 'deepseek-v4-pro'];

// 造一对 <select>+<input>,跟脚本 ④栏一致
function makeWidget() {
  const { window } = new JSDOM('<select id="sel"></select><input id="inp">');
  const doc = window.document;
  return { doc, sel: doc.querySelector('#sel'), inp: doc.querySelector('#inp') };
}
const optTexts = (sel) => [...sel.options].map((o) => o.value);

test('modelOptions:去重 + 含建议 + 滤空 + 缓存在前', () => {
  const list = modelOptions({ cache: ['mimo-v2.5', 'mimo-v2.5-pro'], suggest: SUGGEST, current: 'mimo-v2.5', providerDefault: '' });
  // 缓存里的 mimo-v2.5 与 current 重复 → 只留一个
  assert.deepEqual(list.filter((m) => m === 'mimo-v2.5').length, 1);
  // 建议都在
  SUGGEST.forEach((m) => assert.ok(list.includes(m), `应含建议 ${m}`));
  // 缓存项排在建议前
  assert.ok(list.indexOf('mimo-v2.5') < list.indexOf('gpt-5.5'));
  // 没有空串
  assert.ok(!list.includes(''));
});

test('fillModelSelect:命中列表 → 选中走下拉,文本框隐藏', () => {
  const { doc, sel, inp } = makeWidget();
  const list = modelOptions({ cache: ['mimo-v2.5'], suggest: SUGGEST });
  fillModelSelect(doc, sel, inp, 'gpt-5.5', list);
  assert.equal(sel.value, 'gpt-5.5');
  assert.equal(inp.value, '');
  assert.equal(inp.style.display, 'none');
  assert.ok(optTexts(sel).includes(OTHER), '末尾应有「其他」选项');
});

test('fillModelSelect:未命中(自定义模型名) → 选「其他」,文本框露出并带值', () => {
  const { doc, sel, inp } = makeWidget();
  const list = modelOptions({ suggest: SUGGEST });
  fillModelSelect(doc, sel, inp, 'my-private-model', list);
  assert.equal(sel.value, OTHER);
  assert.equal(inp.value, 'my-private-model');
  assert.equal(inp.style.display, 'block');
});

test('fillModelSelect:空值 → 落到首项,文本框隐藏', () => {
  const { doc, sel, inp } = makeWidget();
  const list = modelOptions({ suggest: SUGGEST });
  fillModelSelect(doc, sel, inp, '', list);
  assert.equal(sel.value, 'gpt-5.5');
  assert.equal(inp.style.display, 'none');
});

test('fillModelSelect:刷新拉到的模型(缓存)即出现在下拉里(核心:bug 修复后)', () => {
  const { doc, sel, inp } = makeWidget();
  const fetched = ['mimo-v2-omni', 'mimo-v2.5', 'mimo-v2.5-pro'];
  const list = modelOptions({ cache: fetched, suggest: SUGGEST });
  fillModelSelect(doc, sel, inp, 'mimo-v2.5', list);
  fetched.forEach((m) => assert.ok(optTexts(sel).includes(m), `下拉应含拉取到的 ${m}`));
  assert.equal(sel.value, 'mimo-v2.5');
});

test('pickModel:下拉选中走下拉值', () => {
  const { doc, sel, inp } = makeWidget();
  fillModelSelect(doc, sel, inp, 'deepseek-v4-pro', modelOptions({ suggest: SUGGEST }));
  assert.equal(pickModel(sel, inp, 'fallback'), 'deepseek-v4-pro');
});

test('pickModel:选「其他」读文本框', () => {
  const { doc, sel, inp } = makeWidget();
  fillModelSelect(doc, sel, inp, '', modelOptions({ suggest: SUGGEST }));
  sel.value = OTHER; inp.value = '  custom-x  ';
  assert.equal(pickModel(sel, inp, 'fallback'), 'custom-x'); // trim
});

test('pickModel:「其他」但文本框空 → 回退 fallback', () => {
  const { doc, sel, inp } = makeWidget();
  fillModelSelect(doc, sel, inp, '', modelOptions({ suggest: SUGGEST }));
  sel.value = OTHER; inp.value = '';
  assert.equal(pickModel(sel, inp, 'deepseek-v4-flash'), 'deepseek-v4-flash');
});
