// 启动冒烟 + 诊断面板集成测试（需 jsdom）：确认面板/铃铛/日志浮层构建无报错、
// 无 Key 时弹引导 banner、点铃铛开日志、复制诊断「绝不含 API Key」。
// 跑法：cd 此目录 && npm i jsdom && node test-boot.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const src = fs.readFileSync(new URL('./feiyue-solver.user.js', import.meta.url), 'utf8');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://10.109.120.139/assignment/programList.jsp?proNum=1&assignID=51',
    runScripts: 'outside-only', pretendToBeVisual: true,
});
const w = dom.window, store = {};
let clip = '';
w.__CGAI_EXPOSE__ = true;
w.GM_addStyle = () => {}; w.GM_getValue = (k, d) => (k in store ? store[k] : d); w.GM_setValue = (k, v) => { store[k] = v; };
w.GM_deleteValue = k => { delete store[k]; }; w.GM_registerMenuCommand = () => {}; w.GM_xmlhttpRequest = () => {};
w.GM_setClipboard = t => { clip = t; };
w.GM_info = { script: { version: '2.3.0', supportURL: 'https://github.com/XjuSelab/xju-feiyue-scripts/issues' } };
w.TextDecoder = TextDecoder; w.DataTransfer = function () { this.items = { add() {} }; this.files = []; };
w.eval(src);
if (!w.document.getElementById('cgai-panel')) w.document.dispatchEvent(new w.Event('DOMContentLoaded'));

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x != null ? '— ' + x : ''); } };
const $ = s => w.document.querySelector(s);

console.log('[启动冒烟]');
ok('面板已建', !!$('#cgai-panel'));
ok('铃铛存在(齿轮旁)', !!$('#cgai-bell') && !!$('#cgai-cfg'));
ok('铃铛红点元素', !!$('#cgai-belldot'));
ok('日志浮层存在', !!$('#cgai-log'));
ok('复制/清空按钮齐全', !!$('#log-copy') && !!$('#log-clear')); // 提issue 按钮已于 v2.4.2 移除

console.log('[无 Key → 新手引导]');
ok('弹出引导 banner', $('#cgai-banners').children.length >= 1, $('#cgai-banners').textContent.slice(0, 40));
ok('红点可见(未读>0)', $('#cgai-belldot').style.display === 'flex');
ok('铃铛脉冲动画', $('#cgai-bell').classList.contains('cgai-attn'));

console.log('[交互]');
$('#cgai-bell').click();
ok('点铃铛→日志打开', $('#cgai-log').classList.contains('open'));
ok('开日志后红点清零', $('#cgai-belldot').style.display === 'none');

console.log('[复制诊断：安全红线——绝不含 API Key]');
store['ds_api_key'] = 'sk-SECRET-MUST-NOT-LEAK-ABCDEF123456';
store['ds_base_url'] = 'https://token-plan-cn.xiaomimimo.com/v1';
store['ds_model'] = 'mimo-v2.5-pro';
$('#log-copy').click();
ok('复制内容非空', clip.length > 0);
ok('★绝不含 API Key', !clip.includes('SECRET') && !clip.includes('LEAK') && !clip.includes(store['ds_api_key']), clip.slice(0, 80));
ok('含服务商 host', clip.includes('token-plan-cn.xiaomimimo.com'));
ok('含模型名', clip.includes('mimo-v2.5-pro'));
ok('含版本号', clip.includes('v2.3.0'));
ok('明示 Key 已隐藏', /已隐藏/.test(clip));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
