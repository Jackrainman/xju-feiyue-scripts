// 无头浏览器视觉验证：把脚本注入桩页面，用「会流式回放的 GM_xmlhttpRequest 桩」驱动真实代码路径，
// 截取：默认面板(铃铛在齿轮旁) / 日志诊断浮层 / 流式「思考中」「生成中」状态 / 解题后日志时间线 / 无Key引导 banner。
// 跑法：cd 此目录 && npm i playwright && node shot.mjs
import { chromium } from 'playwright';
import iconv from 'iconv-lite';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('./feiyue-solver.user.js', import.meta.url), 'utf8');
const PAGE_URL = 'http://10.109.120.139/assignment/programList.jsp?proNum=1&assignID=51';
const FAKE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>CourseGrading</title></head>
<body style="font-family:sans-serif;padding:24px;background:#f3f4f6;color:#444">
<div id="cgcontainerID"><div class="col-10">
<nav aria-label="breadcrumb"><ol class="breadcrumb"><li class="breadcrumb-item">第一次作业</li><li class="breadcrumb-item active">两数之和</li></ol></nav>
<p>读入两个整数 a 和 b，输出它们的和。多组数据，读到 EOF。</p>
<pre>样例输入：1 2  样例输出：3</pre><hr>
<iframe id="showmessageFRAME" name="showmessage1" src="longtimerun.jsp?assignID=51&problemID=1626" style="display:none"></iframe>
<form id="uploadFORM"></form></div></div>
<h2 style="color:#9ca3af">希冀 CourseGrading · 测试桩页面</h2></body></html>`;

const sse = (() => {
    const reason = '我需要读入两个整数并输出它们的和。注意是多组数据，要用 while 循环读到 EOF。用 Scanner.hasNextInt() 判断结束，每组输出一行。';
    const code = '```java\nimport java.util.*;\npublic class Main{\n  public static void main(String[] a){\n    Scanner s=new Scanner(System.in);\n    while(s.hasNextInt()){int x=s.nextInt(),y=s.nextInt();System.out.println(x+y);}\n  }\n}\n```';
    const out = [];
    for (const c of reason.match(/.{1,5}/gs)) out.push({ reasoning_content: c });
    for (const c of code.match(/.{1,7}/gs)) out.push({ content: c });
    return out;
})();

// 判题结果用真实 GBK 字节（脚本以 TextDecoder('gbk') 解码）→ 演示「满分」绿色态
const VERDICT_GBK = [...iconv.encode('[{"ret":"1"},{"content":"<b>评测结果</b>：共有测试数据：3，测试点1 完全正确，测试点2 完全正确，测试点3 完全正确，得分 100。"}]', 'gbk')];

function shimInit(seedKey) {
    const store = seedKey
        ? { ds_api_key: 'sk-demo-not-real', ds_base_url: 'https://token-plan-cn.xiaomimimo.com/v1', ds_model: 'mimo-v2.5-pro' }
        : {};
    return `(function(){
        const VERDICT_GBK = ${JSON.stringify(VERDICT_GBK)};
        const store = ${JSON.stringify(store)};
        window.__SSE__ = ${JSON.stringify(sse)};
        window.GM_addStyle = css => { const s=document.createElement('style'); s.textContent=css; document.head.appendChild(s); };
        window.GM_getValue = (k,d)=> (k in store?store[k]:d);
        window.GM_setValue = (k,v)=>{ store[k]=v; };
        window.GM_deleteValue = k=>{ delete store[k]; };
        window.GM_registerMenuCommand = ()=>{};
        window.GM_setClipboard = ()=>{};
        window.GM_info = { script:{ version:'2.3.0', supportURL:'https://github.com/XjuSelab/xju-feiyue-scripts/issues' } };
        window.GM_xmlhttpRequest = function(o){
            const u = o.url||'';
            if (/chat\\/completions/.test(u)){
                let buf='', i=0;
                const tick=()=>{
                    if (i < window.__SSE__.length){
                        buf += 'data: '+JSON.stringify({choices:[{delta:window.__SSE__[i]}]})+'\\n\\n'; i++;
                        if (o.onprogress) o.onprogress({responseText:buf});
                        setTimeout(tick, 90);
                    } else { buf += 'data: [DONE]\\n\\n'; if (o.onprogress) o.onprogress({responseText:buf}); if (o.onload) o.onload({status:200, responseText:buf}); }
                };
                setTimeout(tick, 350); return;
            }
            if (/longtimerunJSON/.test(u)){
                if (o.onload) o.onload({status:200, response:new Uint8Array(VERDICT_GBK).buffer}); return;
            }
            if (/showProcessMsg/.test(u)){ if (o.onload) o.onload({status:200, responseText:'ok'}); return; }
            if (o.onload) o.onload({status:200, responseText:'', response:new ArrayBuffer(0)});
        };
    })();`;
}

const browser = await chromium.launch({ headless: true });
async function newPage(seedKey) {
    const ctx = await browser.newContext({ viewport: { width: 560, height: 920 }, deviceScaleFactor: 2 });
    await ctx.route('http://10.109.120.139/**', r => r.request().url() === PAGE_URL
        ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FAKE_PAGE })
        : r.fulfill({ status: 200, contentType: 'text/html', body: '' }));
    const page = await ctx.newPage();
    await page.addInitScript(shimInit(seedKey));
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: SRC });
    await page.waitForSelector('#cgai-panel', { timeout: 6000 });
    await page.waitForTimeout(400);
    return page;
}

// A) 有 Key：默认面板 → 日志浮层 → 解题流式 → 解题后日志
const p = await newPage(true);
await p.screenshot({ path: 'shot1-panel.png' });
await p.click('#cgai-bell'); await p.waitForTimeout(250);
await p.screenshot({ path: 'shot2-log-empty.png' });
await p.click('#log-x'); await p.waitForTimeout(150);
await p.click('#cgai-solve');
await p.waitForFunction(() => /思考中/.test(document.querySelector('#cgai-status')?.textContent || ''), { timeout: 6000 }).catch(() => {});
await p.waitForTimeout(150); await p.screenshot({ path: 'shot3-thinking.png' });
await p.waitForFunction(() => /生成中/.test(document.querySelector('#cgai-status')?.textContent || ''), { timeout: 6000 }).catch(() => {});
await p.waitForTimeout(150); await p.screenshot({ path: 'shot4-generating.png' });
await p.waitForTimeout(2500);
await p.click('#cgai-bell'); await p.waitForTimeout(250);
await p.screenshot({ path: 'shot5-log-timeline.png' });

// B) 无 Key：新手引导 banner（铃铛红点 + 日志里的引导卡片）
const p2 = await newPage(false);
await p2.click('#cgai-bell'); await p2.waitForTimeout(250);
await p2.screenshot({ path: 'shot6-onboarding-banner.png' });

await browser.close();
console.log('SHOTS DONE');
