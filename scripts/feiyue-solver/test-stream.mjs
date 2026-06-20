// 离线单测：流式 SSE 解析（parseSSE）。用 vm 沙箱加载脚本（readyState='loading' 故 boot 不跑，不需 DOM）。
// 跑法：node scripts/feiyue-solver/test-stream.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('./feiyue-solver.user.js', import.meta.url), 'utf8');
const noop = () => {};
const store = {};
const ctx = {
    document: { readyState: 'loading', addEventListener: noop, querySelector: () => null, getElementById: () => null, body: { innerHTML: '' }, title: '' },
    location: { origin: 'http://10.109.120.139', pathname: '/assignment/programList.jsp', search: '?proNum=1&assignID=51', href: 'http://10.109.120.139/x' },
    navigator: { userAgent: 'node-test' },
    GM_addStyle: noop, GM_getValue: (k, d) => (k in store ? store[k] : d), GM_setValue: (k, v) => { store[k] = v; },
    GM_deleteValue: k => { delete store[k]; }, GM_registerMenuCommand: noop, GM_xmlhttpRequest: noop, GM_setClipboard: noop,
    GM_info: { script: { version: '2.3.0', supportURL: 'https://example/issues' } },
    TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, console, Date, JSON, Math, RegExp, String, Object, Array, Number,
};
ctx.window = ctx; ctx.window.top = ctx.window; ctx.window.self = ctx.window; ctx.globalThis = ctx;
ctx.window.__CGAI_EXPOSE__ = true;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const api = ctx.window.__CGAI_API__;
assert(api && typeof api.parseSSE === 'function', 'parseSSE 应被暴露');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x != null ? '— ' + x : ''); } };
const sse = o => 'data: ' + JSON.stringify(o) + '\n\n';

console.log('[parseSSE]');
{
    // 思考(reasoning) 在前、正文(content) 在后，最后 [DONE]
    let buf = sse({ choices: [{ delta: { reasoning_content: 'think ' } }] })
        + sse({ choices: [{ delta: { reasoning_content: 'more' } }] })
        + sse({ choices: [{ delta: { content: 'HEL' } }] })
        + sse({ choices: [{ delta: { content: 'LO' } }] })
        + 'data: [DONE]\n\n';
    const r = api.parseSSE(buf);
    ok('reasoning 累积', r.reasoning === 'think more', JSON.stringify(r.reasoning));
    ok('content 累积', r.content === 'HELLO', JSON.stringify(r.content));
    ok('sawSSE=true', r.sawSSE === true);
    ok('done=true', r.done === true);
}
{
    // 尾部半行（不完整 JSON）被跳过，不报错，已完整部分照常解析（模拟流式中途快照）
    const partial = sse({ choices: [{ delta: { content: 'AB' } }] }) + 'data: {"choices":[{"delta":{"content":"C';
    const r = api.parseSSE(partial);
    ok('半行被跳过', r.content === 'AB', JSON.stringify(r.content));
    ok('半行不抛异常', r.sawSSE === true);
}
{
    // message 形态（非 delta，火山 stream:false 兜底或某些实现）
    const r = api.parseSSE(sse({ choices: [{ message: { content: 'X', reasoning_content: 'y' } }] }));
    ok('message.content', r.content === 'X');
    ok('message.reasoning_content', r.reasoning === 'y');
}
{
    // SSE 内嵌 error（火山 UnsupportedModel 也可能走流式错误）
    const r = api.parseSSE(sse({ error: { message: 'does not support the coding plan', code: 'UnsupportedModel' } }));
    ok('errObj 捕获', !!r.errObj && /coding plan/.test(r.errObj.message));
}
{
    // 非 SSE（普通 JSON 体）→ sawSSE=false，让 callLLM 走 JSON 兜底分支
    const r = api.parseSSE('{"choices":[{"message":{"content":"Z"}}]}');
    ok('非 SSE sawSSE=false', r.sawSSE === false);
    ok('非 SSE content 空', r.content === '');
}
{
    // CRLF 行尾 + 前导空格
    const r = api.parseSSE('data:  ' + JSON.stringify({ choices: [{ delta: { content: 'R' } }] }) + '\r\ndata: [DONE]\r\n');
    ok('CRLF/前导空格', r.content === 'R' && r.done === true);
}
{
    // 真实 mimo 首帧（role + 空 content）+ 真实 kimi 帧混合，确保不把 null 当字符串
    const r = api.parseSSE(
        sse({ choices: [{ delta: { content: '', role: 'assistant', reasoning_content: null } }] })
        + sse({ choices: [{ delta: { content: null, role: null, reasoning_content: 'r1' } }] })
        + sse({ choices: [{ delta: { content: 'c1' } }] }));
    ok('null 字段不污染', r.reasoning === 'r1' && r.content === 'c1', JSON.stringify(r));
}
{
    // finish_reason：末帧 length 捕获（max_tokens 截断 → starved 判据）
    const r = api.parseSSE(
        sse({ choices: [{ delta: { content: 'A' }, finish_reason: null }] })
        + sse({ choices: [{ delta: { content: 'B' }, finish_reason: 'length' }] })
        + 'data: [DONE]\n\n');
    ok('finishReason=length 捕获', r.finishReason === 'length', JSON.stringify(r.finishReason));
}
{
    // usage-only 尾帧(choices:[])不可把已捕获的 finish_reason 清空（仅非 null 才覆盖）
    const r = api.parseSSE(
        sse({ choices: [{ delta: { content: 'A' }, finish_reason: 'length' }] })
        + sse({ choices: [], usage: { total_tokens: 9 } }));
    ok('usage-only 尾帧不清空 finishReason', r.finishReason === 'length', JSON.stringify(r.finishReason));
}
{
    // 全程 finish_reason=null → 返回 null（流式中途快照，未结束）
    const r = api.parseSSE(sse({ choices: [{ delta: { content: 'A' }, finish_reason: null }] }));
    ok('全程 null → finishReason null', r.finishReason === null, JSON.stringify(r.finishReason));
}
{
    // stop 与 length 区分（stop=模型自愿收尾，不应判 starved）
    const r = api.parseSSE(sse({ choices: [{ delta: { content: 'A' }, finish_reason: 'stop' }] }));
    ok('finishReason=stop', r.finishReason === 'stop', JSON.stringify(r.finishReason));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
