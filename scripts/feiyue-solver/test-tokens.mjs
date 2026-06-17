// 纯函数单测：autoTokens(按思考开关+用户设置+学习上限决定 max_tokens) 与 decideRetry(starved 加大重试)。
// v2.6.0 自适应 max_tokens 的判定核心，vm 沙箱、无依赖、无 DOM。
import fs from 'node:fs';
import vm from 'node:vm';
const src = fs.readFileSync(new URL('./feiyue-solver.user.js', import.meta.url), 'utf8');
const noop = () => {};
const ctx = { document: { readyState: 'loading', addEventListener: noop, querySelector: () => null, getElementById: () => null, body: { innerHTML: '' }, title: '' }, location: { origin: 'http://x', pathname: '/x', search: '', href: 'http://x/' }, navigator: { userAgent: 'node' }, GM_addStyle: noop, GM_getValue: (k, d) => d, GM_setValue: noop, GM_deleteValue: noop, GM_registerMenuCommand: noop, GM_xmlhttpRequest: noop, GM_setClipboard: noop, GM_info: { script: { version: 'x' } }, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, console, Date, JSON, Math, RegExp, String, Object, Array, Number };
ctx.window = ctx; ctx.globalThis = ctx; ctx.window.__CGAI_EXPOSE__ = true;
vm.createContext(ctx); vm.runInContext(src, ctx);
const { autoTokens, decideRetry, isCapErr } = ctx.window.__CGAI_API__;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x != null ? '— ' + JSON.stringify(x) : ''); } };

console.log('[autoTokens]');
ok('思考开 → 32768', autoTokens({ thinking: true }, {}, 0) === 32768, autoTokens({ thinking: true }, {}, 0));
ok('思考关 → 8192', autoTokens({ thinking: false }, {}, 0) === 8192, autoTokens({ thinking: false }, {}, 0));
ok('用户设了 maxTokens → 优先用用户值', autoTokens({ thinking: true }, { maxTokens: 12000 }, 0) === 12000);
ok('cap 钳制（思考开但学习到模型上限 8192）', autoTokens({ thinking: true }, {}, 8192) === 8192);
ok('cap 只钳小不放大（cap 大于默认时仍取默认）', autoTokens({ thinking: false }, {}, 100000) === 8192);
ok('用户值也被 cap 钳制', autoTokens({ thinking: true }, { maxTokens: 60000 }, 16384) === 16384);

console.log('[decideRetry]');
ok('starved 第0次 → 翻倍到 16384', (() => { const d = decideRetry('starved', 8192, 0); return d.retry && d.tokens === 16384; })());
ok('starved 第1次 → 翻倍到 65536(封顶)', (() => { const d = decideRetry('starved', 32768, 1); return d.retry && d.tokens === 65536; })());
ok('starved 第2次 → 不再重试(bumps 已达上限)', decideRetry('starved', 16384, 2).retry === false);
ok('已到 65536 → next 不大于 cur，不重试', decideRetry('starved', 65536, 0).retry === false);
ok('非 starved(empty) → 不重试', decideRetry('empty', 8192, 0).retry === false);
ok('非 starved(capped) → 不重试', decideRetry('capped', 8192, 0).retry === false);

console.log('[isCapErr] 仅真正的 max_tokens(输出)超限算 capped；输入上下文超限/限流不算(否则污染上限缓存)');
ok('max_tokens 超限 → capped', isCapErr('max_tokens is too large: 32768. The maximum is 8192') === true);
ok('max tokens(空格) → capped', isCapErr('Invalid max tokens value') === true);
ok('maximum completion tokens → capped', isCapErr('maximum completion tokens exceeded') === true);
ok('输入上下文超限 → 不 capped', isCapErr("This model's maximum context length is 64000 tokens, however you requested 70000") === false);
ok('context length → 不 capped', isCapErr('context length exceeded') === false);
ok('too many tokens(输入) → 不 capped', isCapErr('Input contains too many tokens') === false);
ok('限流 reduce length → 不 capped', isCapErr('Rate limit exceeded. Please reduce the length of your request.') === false);
ok('maximum number of tokens in context → 不 capped(NONCAP 兜底)', isCapErr('exceeds the maximum number of tokens allowed in the context window') === false);
ok('普通模型错误 → 不 capped', isCapErr('model not found') === false);

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
