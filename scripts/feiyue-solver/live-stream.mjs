// 活体流式验证：用脚本「真实的 parseSSE」去解真实 API 的流式响应，证明流式改造端到端可用，
// 并量出「首响应 / 首正文 / 思考字数 / 生成字数」——直接对应面板上的「思考中 / 生成中」指示。
// 跑法（在能直连这些 API 的机器上）：node live-stream.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('./feiyue-solver.user.js', import.meta.url), 'utf8');
const noop = () => {};
const store = {};
const ctx = {
    document: { readyState: 'loading', addEventListener: noop, querySelector: () => null, getElementById: () => null, body: { innerHTML: '' }, title: '' },
    location: { origin: 'http://10.109.120.139', pathname: '/x', search: '', href: 'http://x/' },
    navigator: { userAgent: 'node' }, GM_addStyle: noop, GM_getValue: (k, d) => d, GM_setValue: noop, GM_deleteValue: noop,
    GM_registerMenuCommand: noop, GM_xmlhttpRequest: noop, GM_setClipboard: noop, GM_info: { script: { version: '2.3.0' } },
    TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, console, Date, JSON, Math, RegExp, String, Object, Array, Number,
};
ctx.window = ctx; ctx.window.top = ctx.window; ctx.window.self = ctx.window; ctx.globalThis = ctx; ctx.window.__CGAI_EXPOSE__ = true;
vm.createContext(ctx); vm.runInContext(src, ctx);
const parseSSE = ctx.window.__CGAI_API__.parseSSE;

const PROMPT = 'Write a complete Java program: read N then N integers, print them sorted descending, one per line. Output only one fenced ```java code block, no prose.';

async function run(name, baseURL, key, model, prompt = PROMPT) {
    const t0 = Date.now();
    const url = baseURL.replace(/\/+$/, '') + '/chat/completions';
    const payload = { model, messages: [{ role: 'user', content: prompt }], stream: true, temperature: 0, max_tokens: 8192 };
    let res;
    try { res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key, 'Accept': 'text/event-stream' }, body: JSON.stringify(payload) }); }
    catch (e) { console.log(`\n=== ${name} (${model}) FETCH ERR: ${e.message}`); return; }
    console.log(`\n=== ${name} (${model}) http=${res.status} ===`);
    const dec = new TextDecoder();
    let buf = '', lastLen = 0, firstAt = 0, firstContentAt = 0, phase = '', maxGap = 0, lastAt = Date.now();
    for await (const ch of res.body) {
        buf += dec.decode(ch, { stream: true });
        const r = parseSSE(buf);
        if (!r.sawSSE) continue;
        const len = r.content.length + r.reasoning.length;
        if (len > lastLen) { if (!firstAt) firstAt = Date.now(); maxGap = Math.max(maxGap, Date.now() - lastAt); lastAt = Date.now(); lastLen = len; }
        if (r.content && !firstContentAt) firstContentAt = Date.now();
        const np = r.content ? 'gen' : 'think';
        if (np !== phase) { phase = np; process.stdout.write(`\n  [+${((Date.now() - t0) / 1000).toFixed(1)}s] → ${phase === 'think' ? '思考中' : '生成中'} `); }
        process.stdout.write('.');
    }
    const fin = parseSSE(buf);
    if (!fin.sawSSE) { console.log('  非 SSE 响应（callLLM 会走 JSON 兜底）：', buf.slice(0, 240)); return; }
    const s = ms => (ms / 1000).toFixed(1);
    console.log(`\n  首响应 ${firstAt ? s(firstAt - t0) : '-'}s · 首正文 ${firstContentAt ? s(firstContentAt - t0) : '-'}s · 总 ${s(Date.now() - t0)}s · 最大数据间隔 ${s(maxGap)}s`);
    console.log(`  思考 ${fin.reasoning.length} 字 · 正文 ${fin.content.length} 字 · done=${fin.done} · errObj=${fin.errObj ? JSON.stringify(fin.errObj) : 'none'}`);
    console.log('  正文前 90：', fin.content.slice(0, 90).replace(/\n/g, ' '));
}

const MIMO = { base: 'https://token-plan-cn.xiaomimimo.com/v1', key: process.env.MIMO_KEY };
const ARK = { base: 'https://ark.cn-beijing.volces.com/api/coding/v3', key: process.env.ARK_KEY };

(async () => {
    await run('MIMO', MIMO.base, MIMO.key, 'mimo-v2.5-pro');
    await run('火山coding kimi-k2', ARK.base, ARK.key, 'kimi-k2-250711');
    await run('火山coding 不支持模型(应清晰报错)', ARK.base, ARK.key, 'deepseek-v3-250324', 'hi');
})();
