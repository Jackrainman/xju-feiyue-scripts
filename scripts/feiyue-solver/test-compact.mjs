// compactMessages 单测：v2.5.0 保留「最近两轮」(代码+反馈)，不再只留一轮（难题多版纠错防失忆）。
// 纯函数，vm 沙箱，无依赖。
import fs from 'node:fs';
import vm from 'node:vm';
const src = fs.readFileSync(new URL('./feiyue-solver.user.js', import.meta.url), 'utf8');
const noop = () => {};
const ctx = { document: { readyState: 'loading', addEventListener: noop, querySelector: () => null, getElementById: () => null, body: { innerHTML: '' }, title: '' }, location: { origin: 'http://x', pathname: '/x', search: '', href: 'http://x/' }, navigator: { userAgent: 'node' }, GM_addStyle: noop, GM_getValue: (k, d) => d, GM_setValue: noop, GM_deleteValue: noop, GM_registerMenuCommand: noop, GM_xmlhttpRequest: noop, GM_setClipboard: noop, GM_info: { script: { version: 'x' } }, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, console, Date, JSON, Math, RegExp, String, Object, Array, Number };
ctx.window = ctx; ctx.globalThis = ctx; ctx.window.__CGAI_EXPOSE__ = true;
vm.createContext(ctx); vm.runInContext(src, ctx);
const { compactMessages } = ctx.window.__CGAI_API__;

const problem = { kind: 'file', title: 'T', statement: 'S' };
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x != null ? '— ' + JSON.stringify(x) : ''); } };
const roles = a => a.map(m => m.role).join(',');
const A = t => ({ role: 'assistant', content: t });
const U = t => ({ role: 'user', content: t });

// base = [system, user(题目)]
const base = compactMessages([], problem);
ok('base = [system,user]', roles(base) === 'system,user', roles(base));

// 三轮历史 → 保留最近两轮 (a2,u2,a3,u3)
const msgs3 = [base[0], base[1], A('code1'), U('fail1'), A('code2'), U('fail2'), A('code3'), U('fail3')];
const c3 = compactMessages(msgs3, problem);
ok('三轮→保留最近两轮(6条)', c3.length === 6, roles(c3));
ok('丢掉了 code1/fail1', !c3.some(m => m.content === 'code1' || m.content === 'fail1'), c3.map(m => m.content));
ok('保留了 code2/fail2/code3/fail3', ['code2', 'fail2', 'code3', 'fail3'].every(t => c3.some(m => m.content === t)));
ok('以 user(反馈) 结尾', c3[c3.length - 1].role === 'user');

// 一轮历史 → 全留
const c1 = compactMessages([base[0], base[1], A('code1'), U('fail1')], problem);
ok('一轮→[sys,user,a,u]', roles(c1) === 'system,user,assistant,user', roles(c1));

// 以 assistant 结尾(贴 deadline 无反馈) → 补一句 user，保证 user 结尾(避免 reasoner 400)
const cEndA = compactMessages([base[0], base[1], A('code1'), U('fail1'), A('code2')], problem);
ok('assistant 结尾→补 user 收尾', cEndA[cEndA.length - 1].role === 'user', roles(cEndA));
ok('补的是 code2 之后(保留了 code2)', cEndA.some(m => m.content === 'code2'));

// 幂等性：压缩结果再压缩不应丢失最近两轮
const c3b = compactMessages(c3, problem);
ok('幂等：再压缩仍保最近两轮', ['code2', 'fail2', 'code3', 'fail3'].every(t => c3b.some(m => m.content === t)), roles(c3b));

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
