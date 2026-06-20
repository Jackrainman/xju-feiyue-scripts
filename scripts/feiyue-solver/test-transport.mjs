// 传输层单测：模拟 GM_xmlhttpRequest 的两条路径，验证 v2.4.6 callLLM。
//  路径A 流式(脚本猫式)：responseType:'stream'，onloadstart 给一个 ReadableStream<Uint8Array>，按 chunk enqueue、永不 close，最后 onload。
//  路径B 退化(VM/老版式)：无可读流，仅 onload 给整段 responseText。
// 断言：两条路径都返回正确正文；流式路径 phase 走 think→gen、探针报真增量；退化路径探针报整段；流内 error 不吞；非 SSE 错误体 reject。
import fs from 'node:fs';
import vm from 'node:vm';
const SRC = fs.readFileSync(new URL('./feiyue-solver.user.js', import.meta.url), 'utf8');
const enc = new TextEncoder();

function makeCtx(gmHandler, clock) {
  const noop = () => {};
  const ctx = {
    document: { readyState: 'loading', addEventListener: noop, querySelector: () => null, getElementById: () => null, body: { innerHTML: '' }, title: '' },
    location: { origin: 'http://x', pathname: '/x', search: '', href: 'http://x/' },
    navigator: { userAgent: 'node' },
    GM_addStyle: noop, GM_getValue: (k, d) => d, GM_setValue: noop, GM_deleteValue: noop,
    GM_registerMenuCommand: noop, GM_setClipboard: noop, GM_info: { script: { version: '2.4.6' } },
    GM_xmlhttpRequest: gmHandler,
    TextDecoder, TextEncoder, ReadableStream, Uint8Array,
    setTimeout, clearTimeout, clearInterval, queueMicrotask,
    setInterval: clock ? clock.setInterval : setInterval,
    console, Date: clock ? clock.Date : Date,
    JSON, Math, RegExp, String, Object, Array, Number, Promise, Error,
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.window.__CGAI_EXPOSE__ = true;
  vm.createContext(ctx); vm.runInContext(SRC, ctx);
  return { ctx, api: ctx.window.__CGAI_API__ };
}

const SSE = [
  'data: {"choices":[{"delta":{"reasoning_content":"先想算法"}}]}\n\n',
  'data: {"choices":[{"delta":{"reasoning_content":"用辗转相除"}}]}\n\n',
  'data: {"choices":[{"delta":{"con',                                  // 故意切半行，测累积重解析容错
  'tent":"```java\\n"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"class Main{}"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"\\n```"}}]}\n\n',
  'data: [DONE]\n\n',
];
const EXPECT = '```java\nclass Main{}\n```';
const tick = () => new Promise(r => setImmediate(r));

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x != null ? '— ' + JSON.stringify(x) : ''); } };

// ---- T1: 流式(脚本猫式) ----
async function t1() {
  console.log('T1 流式路径（responseType:stream，ReadableStream<Uint8Array>，永不 close）');
  let controller, sawType = null;
  const gm = opts => {
    sawType = opts.responseType;
    const rs = new ReadableStream({ start(c) { controller = c; } });
    (async () => {
      opts.onloadstart({ response: rs });
      for (const part of SSE) { await tick(); controller.enqueue(enc.encode(part)); }
      await tick(); await tick();           // 让 pump 读完已入队 chunk（模拟消息间 microtask 抽干）
      opts.onload({ status: 200 });          // 脚本猫不 close 流，靠 onload 收口
    })();
  };
  const { api } = makeCtx(gm);
  const phases = []; let probe = null;
  const hooks = {
    onProgress: ({ phase }) => { if (phases[phases.length - 1] !== phase) phases.push(phase); },
    onStall: noopHook, onStreamMode: (real, ticks) => { probe = { real, ticks }; }, onServerError: noopHook,
  };
  const out = await api.callLLM([{ role: 'user', content: 'gcd' }], { model: 'm', temperature: 0 }, 'k', 5000, hooks);
  ok('返回正文正确', out === EXPECT, out);
  ok('responseType 设为 stream', sawType === 'stream', sawType);
  ok('phase 走过 think 再到 gen', phases.includes('think') && phases.indexOf('gen') > phases.indexOf('think'), phases);
  ok('探针报「真增量」且 ticks>0', probe && probe.real === true && probe.ticks > 0, probe);
}

// ---- T2: 退化(无流，仅 onload responseText) ----
async function t2() {
  console.log('T2 退化路径（无可读流，onload 一次性 responseText）');
  const gm = opts => {
    opts.onloadstart({ response: undefined });        // 没有可读流
    setImmediate(() => opts.onload({ status: 200, responseText: SSE.join('') }));
  };
  const { api } = makeCtx(gm);
  let probe = null;
  const out = await api.callLLM([{ role: 'user', content: 'x' }], { model: 'm' }, 'k', 5000,
    { onProgress: noopHook, onStall: noopHook, onStreamMode: (real, t) => { probe = { real, t }; }, onServerError: noopHook });
  ok('退化路径仍返回正确正文', out === EXPECT, out);
  ok('探针报「整段返回」(real=false)', probe && probe.real === false, probe);
}

// ---- T3: 非 SSE 错误体 → reject(model/http) ----
async function t3() {
  console.log('T3 非 SSE 错误体（服务商忽略 stream，返回 JSON error）');
  const gm = opts => { opts.onloadstart({ response: undefined }); setImmediate(() => opts.onload({ status: 200, responseText: '{"error":{"message":"model X not found","code":"UnsupportedModel"}}' })); };
  const { api } = makeCtx(gm);
  let err = null;
  try { await api.callLLM([{ role: 'user', content: 'x' }], { model: 'm' }, 'k', 5000, base()); } catch (e) { err = e; }
  ok('reject 且 kind=model', err && err.kind === 'model', err && { msg: err.message, kind: err.kind });
}

// ---- T4: 流内同时有 content + error → 返回 content 且记 onServerError ----
async function t4() {
  console.log('T4 流内 content + error 共存（不吞 error）');
  const body = 'data: {"choices":[{"delta":{"content":"```java\\nclass Main{}\\n```"}}]}\n\n' +
    'data: {"error":{"message":"upstream truncated"}}\n\n';
  const gm = opts => { opts.onloadstart({ response: undefined }); setImmediate(() => opts.onload({ status: 200, responseText: body })); };
  const { api } = makeCtx(gm);
  let svErr = null;
  const out = await api.callLLM([{ role: 'user', content: 'x' }], { model: 'm' }, 'k', 5000,
    { onProgress: noopHook, onStall: noopHook, onStreamMode: noopHook, onServerError: (e) => { svErr = e; } });
  ok('仍返回已有正文', out === EXPECT, out);
  ok('onServerError 记下原始 error', svErr && /truncated/.test(svErr.message), svErr);
}

// ---- T5: 生成静默到 STALL_HARD(60s) → 主动收口已拿到正文（假时钟 + 快速 interval）----
async function t5() {
  console.log('T5 生成阶段静默 60s 硬收口（不再干等到超时）');
  // 假时钟：Date.now 可推进；setInterval 收集回调，手动快速触发
  let now = 1_000_000; const intervals = [];
  const clock = {
    Date: Object.assign(function () { return new Date(); }, { now: () => now }),
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
  };
  let controller;
  const gm = opts => {
    const rs = new ReadableStream({ start(c) { controller = c; } });
    (async () => {
      opts.onloadstart({ response: rs });
      // 出了一段正文(gen 阶段)，然后服务端不发 [DONE]、不关连接、不再来数据
      controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"partial code here"}}]}\n\n'));
      await tick(); await tick();
      // 推进时钟 61s，手动跳 interval（脚本里 1s 一次；这里直接触发）
      now += 61_000;
      for (const fn of intervals) fn();
      // 不调用 onload，模拟干等
    })();
  };
  const { api } = makeCtx(gm, clock);
  let out = null, err = null;
  try { out = await api.callLLM([{ role: 'user', content: 'x' }], { model: 'm' }, 'k', 999_000, base()); } catch (e) { err = e; }
  ok('60s gen 静默后收口、返回已拿到的正文', out === 'partial code here', err ? { err: err.message } : out);
}

// ---- T6: 思考耗尽 token 预算（reasoning-only + finish_reason:length，无正文）→ reject(starved) ----
async function t6() {
  console.log('T6 思考耗尽 token 预算（reasoning-only + finish_reason:length，无正文）→ reject(starved)');
  const body = 'data: {"choices":[{"delta":{"reasoning_content":"想了很久"},"finish_reason":null}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n' + 'data: [DONE]\n\n';
  const gm = opts => { opts.onloadstart({ response: undefined }); setImmediate(() => opts.onload({ status: 200, responseText: body })); };
  const { api } = makeCtx(gm);
  let err = null;
  try { await api.callLLM([{ role: 'user', content: 'x' }], { model: 'm', maxTokens: 8192 }, 'k', 5000, base()); } catch (e) { err = e; }
  ok('reject 且 kind=starved', err && err.kind === 'starved', err && { msg: err.message, kind: err.kind });
}

// ---- T7: 思考完自愿收尾、无正文（finish_reason:stop）→ reject(empty)，不应判 starved ----
async function t7() {
  console.log('T7 finish_reason:stop 且无正文 → reject(empty)，不应误判 starved');
  const body = 'data: {"choices":[{"delta":{"reasoning_content":"算了不写"},"finish_reason":null}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' + 'data: [DONE]\n\n';
  const gm = opts => { opts.onloadstart({ response: undefined }); setImmediate(() => opts.onload({ status: 200, responseText: body })); };
  const { api } = makeCtx(gm);
  let err = null;
  try { await api.callLLM([{ role: 'user', content: 'x' }], { model: 'm' }, 'k', 5000, base()); } catch (e) { err = e; }
  ok('reject 且 kind=empty（非 starved）', err && err.kind === 'empty', err && { msg: err.message, kind: err.kind });
}

// ---- T8: max_tokens 超模型上限（400 错误体）→ reject(capped)，extra=请求的 maxTokens ----
async function t8() {
  console.log('T8 max_tokens 超模型上限（400 错误体）→ reject(capped)，extra=请求的 maxTokens');
  const gm = opts => { opts.onloadstart({ response: undefined }); setImmediate(() => opts.onload({ status: 400, responseText: '{"error":{"message":"max_tokens is too large: 32768. The maximum is 8192","type":"invalid_request_error"}}' })); };
  const { api } = makeCtx(gm);
  let err = null;
  try { await api.callLLM([{ role: 'user', content: 'x' }], { model: 'deepseek-chat', maxTokens: 32768 }, 'k', 5000, base()); } catch (e) { err = e; }
  ok('reject 且 kind=capped', err && err.kind === 'capped', err && { msg: err.message, kind: err.kind });
  ok('extra 记下请求的 maxTokens(32768)', err && err.extra === 32768, err && err.extra);
}

// ---- T9: 输入上下文超限 400（不是 max_tokens）→ 必须 NOT capped（否则污染 token 上限缓存）----
async function t9() {
  console.log('T9 输入上下文超限 400（context length，非 max_tokens）→ 不可判 capped');
  const gm = opts => { opts.onloadstart({ response: undefined }); setImmediate(() => opts.onload({ status: 400, responseText: '{"error":{"message":"This model\\u0027s maximum context length is 64000 tokens. However, your messages resulted in 70000 tokens.","type":"invalid_request_error"}}' })); };
  const { api } = makeCtx(gm);
  let err = null;
  try { await api.callLLM([{ role: 'user', content: 'x' }], { model: 'deepseek-reasoner', maxTokens: 32768 }, 'k', 5000, base()); } catch (e) { err = e; }
  ok('reject 且 kind 不是 capped（不会被误学成上限）', err && err.kind !== 'capped', err && { msg: err.message, kind: err.kind });
}

function noopHook() {}
function base() { return { onProgress: noopHook, onStall: noopHook, onStreamMode: noopHook, onServerError: noopHook }; }

await t1(); await t2(); await t3(); await t4(); await t5(); await t6(); await t7(); await t8(); await t9();
console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
