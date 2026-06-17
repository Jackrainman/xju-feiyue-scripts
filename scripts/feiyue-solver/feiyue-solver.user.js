// ==UserScript==
// @name         飞跃·解题 Solver
// @namespace    https://feiyue.selab.top/feiyue-solver
// @version      2.6.0
// @description  希冀(CourseGrading/educg) 编程/填空/接口/在线编辑题：提取题目→DeepSeek 生成→自动提交→读判题结果；一键串行开刷所有作业(校验链接+排序)、开刷前自动抽取未抽题作业、失败读样例多版本重试、自动跳题。v2.3：流式响应(实时看到"思考/生成/卡住"，杜绝长生成时的"无响应")、铃铛日志诊断面板(特殊情况新手引导式提醒+一键复制诊断日志)。v2.4：同题上下文压缩(mod-2)+主模型连错3次后升级强模型(重置单题时间预算)。v2.4.4：支持「在线代码编辑器题」(programList_ce.jsp，源码走 cgsoucecode/byCE 提交)，修复此类题"识别不到"。v2.4.5：思考/生成/卡住状态按阶段判定——只有"出正文后静默"才报卡住，"思考中静默"不再误判为响应慢/卡住(思考阈值放宽到35s)。v2.4.6：用 responseType:stream 自读流——修复脚本猫(ScriptCat MV3)下"假流式/整段缓冲"(默认走原生 XHR 只在 onload 一次性回传正文)，让逐字进度真正实时；附启动探针、生成静默60s收口、流内 error 不再吞。v2.5.0：难题正确率修复——①上下文压缩保留"最近两轮"(代码+失败反馈)而非仅一轮，多版纠错不再失忆/反复踩坑 ②「面向样例」改为反推通用规则并警告硬编码必挂隐藏用例，不再鼓励打表过拟合。v2.6.0：自适应 max_tokens(思考模型默认 32768，思考耗尽预算空手而归时自动加大重试、并按模型学习其 token 上限避免 400)+解耦长思考超时(单次调用给足 6 分钟、不再被单题总时钟挤压秒杀，单题总预算抬到 15 分钟仅作版间闸门)，新增配置页可调 max_tokens/单次超时/单题预算三个旋钮(留空=自动)。
// @author       winbeau
// @homepageURL  https://github.com/XjuSelab/xju-feiyue-scripts
// @supportURL   https://github.com/XjuSelab/xju-feiyue-scripts/issues
// @downloadURL  https://feiyue.selab.top/feiyue-solver.user.js
// @updateURL    https://feiyue.selab.top/feiyue-solver.user.js
// @match        http://10.109.120.139/*
// @icon         http://10.109.120.139/images/cgicon.png
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @connect      api.deepseek.com
// @connect      token-plan-cn.xiaomimimo.com
// @connect      ark.cn-beijing.volces.com
// @connect      aiapis.help
// @connect      10.109.120.139
// @connect      self
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';
    if (window.top !== window.self) return; // 不注入到判题结果 iframe

    const pageT0 = Date.now();

    /* ============================ 配置 / 存储 ============================ */
    const STORE = {
        KEY: 'ds_api_key', BASE_URL: 'ds_base_url', MODEL: 'ds_model', STRONG_MODEL: 'ds_strong_model',
        THINKING: 'ds_thinking', AUTO_SUBMIT: 'cg_auto_submit', MAX_ATTEMPTS: 'cg_max_attempts',
        SKIP_PASSED: 'cg_skip_passed', GRIND: 'cg_grind_state', MODELS_CACHE: 'ds_models_cache', LOG: 'cgai_log',
        MAX_TOKENS: 'cg_max_tokens', CALL_TIMEOUT: 'cg_call_timeout', PROBLEM_BUDGET: 'cg_problem_budget', TOKENS_CAP: 'cg_tokens_cap',
    };
    const VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '2.6.0';
    const DEFAULTS = { baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', strongModel: 'deepseek-reasoner' };
    const MODEL_SUGGEST = ['deepseek-chat', 'deepseek-reasoner', 'gpt-5.5', 'gpt-5.4-pro'];
    const OJ = location.origin;
    const PAGE_OF = { file: 'programList.jsp', ce: 'programList_ce.jsp', iface: 'programWithInterfaceList.jsp', gap: 'programFillGapList.jsp' };

    const getKey = () => (GM_getValue(STORE.KEY, '') || '').trim();
    const getBaseURL = () => (GM_getValue(STORE.BASE_URL, DEFAULTS.baseURL) || DEFAULTS.baseURL).trim().replace(/\/+$/, '');
    const settings = () => ({
        baseURL: getBaseURL(),
        model: (GM_getValue(STORE.MODEL, DEFAULTS.model) || DEFAULTS.model).trim(),
        strongModel: (GM_getValue(STORE.STRONG_MODEL, DEFAULTS.strongModel) || '').trim(),
        thinking: GM_getValue(STORE.THINKING, false),
        autoSubmit: GM_getValue(STORE.AUTO_SUBMIT, true),
        maxAttempts: +GM_getValue(STORE.MAX_ATTEMPTS, 3),
        skipPassed: GM_getValue(STORE.SKIP_PASSED, true),
        maxTokens: +GM_getValue(STORE.MAX_TOKENS, 0) || 0,                        // 0=自动(见 autoTokens)
        callTimeoutMs: (+GM_getValue(STORE.CALL_TIMEOUT, 0) || 0) * 1000,        // UI 存秒；0=默认 CALL_TIMEOUT_MS
        problemBudgetMs: (+GM_getValue(STORE.PROBLEM_BUDGET, 0) || 0) * 1000,    // UI 存秒；0=默认 PROBLEM_BUDGET_MS
    });
    const getGrind = () => { try { return JSON.parse(GM_getValue(STORE.GRIND, '') || 'null'); } catch (_) { return null; } };
    const setGrind = g => GM_setValue(STORE.GRIND, JSON.stringify(g));
    const clearGrind = () => GM_deleteValue(STORE.GRIND);
    // 学习到的「模型 token 上限」缓存（per host|model）：某模型 400(max_tokens 超限)后记住其上限，后续请求自动钳到该值，避免反复 400（如 deepseek-chat 自学回 8192）。
    const getCaps = () => { try { return JSON.parse(GM_getValue(STORE.TOKENS_CAP, '') || '{}') || {}; } catch (_) { return {}; } };
    const capFor = (host, model) => { const n = getCaps()[host + '|' + model]; return (typeof n === 'number' && n > 0) ? n : 0; };
    const setCap = (host, model, n) => { const c = getCaps(), k = host + '|' + model; if (!c[k] || n < c[k]) { c[k] = n; try { GM_setValue(STORE.TOKENS_CAP, JSON.stringify(c)); } catch (_) {} } };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const fmtN = n => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
    const hhmmss = t => { const d = new Date(t); const p = x => String(x).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };

    /* ============================ 日志 / 诊断（持久化，跨页开刷可追溯） ============================ */
    // 只记录「离散里程碑事件」（解题/调用/思考完成/生成/提交/判题/错误），不写逐 token——逐 token 的实时进度走状态行。
    const LEVELS = { info: '·', think: '🧠', gen: '✎', ok: '✓', warn: '⚠', err: '✕' };
    const LOG = {
        MAX: 200, buf: [],
        load() { try { this.buf = JSON.parse(GM_getValue(STORE.LOG, '') || '[]') || []; } catch (_) { this.buf = []; } if (!Array.isArray(this.buf)) this.buf = []; },
        save() { try { GM_setValue(STORE.LOG, JSON.stringify(this.buf.slice(-this.MAX))); } catch (_) {} },
        push(level, msg, detail) {
            const e = { t: Date.now(), level, msg: String(msg || ''), detail: detail ? String(detail).slice(0, 1200) : '' };
            this.buf.push(e); if (this.buf.length > this.MAX) this.buf.splice(0, this.buf.length - this.MAX);
            this.save();
            if (level === 'warn' || level === 'err') bumpAttention();
            renderLog();
            return e;
        },
        clear() { this.buf = []; this.save(); renderLog(); },
    };

    // 特殊情况「新手引导式」提醒：每类一条（同类去重），点开铃铛即见，附操作按钮
    const BANNER_DEFS = {
        noKey:   { lvl: 'warn', title: '还没配置 API Key', body: '点右上角齿轮配置 Base URL 与 API Key（支持 DeepSeek / GPT / 任意 OpenAI 兼容服务）。', act: '去配置', go: 'config' },
        auth:    { lvl: 'err',  title: 'API Key 无效 (401)', body: '检查 Key 是否复制完整、未过期，且与 Base URL 的服务商匹配。', act: '去配置', go: 'config' },
        connect: { lvl: 'err',  title: '连不上 API 服务器', body: '①脚本猫需「允许」到该域名的跨域连接（首次会弹窗，务必点允许）②确认该 API 在你的网络可达 ③Base URL 是否正确（GPT 代理通常要带 /v1）。', act: '去配置', go: 'config' },
        model:   { lvl: 'warn', title: '该模型不被接口支持', body: '当前模型不在该服务商/接口的支持列表（如火山「编程计划」仅支持部分模型）。换一个兼容模型后重试。', act: '去配置', go: 'config' },
        timeout: { lvl: 'warn', title: '请求超时', body: '模型长时间未给出完整响应。可重试、换更快的模型，或检查网络稳定性。', act: '看日志', go: 'log' },
        stall:   { lvl: 'warn', title: '生成疑似卡住', body: '已在输出正文阶段、却较长时间没有新增内容（不是在思考，而是真的停了）。可停止后重试，或更换模型/检查网络。', act: '看日志', go: 'log' },
        empty:   { lvl: 'warn', title: '返回内容为空', body: '模型只输出了思考没给正文，或 max_tokens 被思考耗尽。可关思考模式或换模型重试。', act: '看日志', go: 'log' },
        starved: { lvl: 'warn', title: '思考耗尽 token 预算', body: '模型把 max_tokens 几乎全用在思考上、没写完正文。已自动加大预算重试；若仍失败，可在配置页调高 max_tokens 或关思考模式。', act: '看日志', go: 'log' },
        capped:  { lvl: 'warn', title: '模型 token 上限不足', body: '当前模型不支持这么大的 max_tokens，已自动记住其上限并降回重试。如仍异常可在配置页手动设小 max_tokens。', act: '看日志', go: 'log' },
    };
    let activeBanners = {};            // kind -> { extra }
    let unseen = 0;                    // 未读 warn/err 数（铃铛红点）
    function setBanner(kind, extra) { if (!BANNER_DEFS[kind]) return; activeBanners[kind] = { extra: extra || '' }; bumpAttention(); renderLog(); }
    function clearBanner(kind) { if (activeBanners[kind]) { delete activeBanners[kind]; renderLog(); } }
    function clearTransientBanners() { ['auth', 'connect', 'model', 'timeout', 'stall', 'empty', 'starved', 'capped'].forEach(clearBanner); }
    function bumpAttention() { unseen++; updateBell(); if (bellEl) bellEl.classList.add('cgai-attn'); }
    function updateBell() { if (!bellDot) return; bellDot.style.display = unseen > 0 ? 'flex' : 'none'; bellDot.textContent = unseen > 9 ? '9+' : String(unseen); }

    function pageType() {
        const h = location.pathname + location.search;
        if (/programFillGapList\.jsp/i.test(h)) return 'gap';
        if (/programWithInterfaceList\.jsp/i.test(h)) return 'iface';
        if (/programList_ce\.jsp/i.test(h)) return 'ce';   // 在线代码编辑器题（programList.jsp 对部分题会 302 跳到 _ce）
        if (/programList\.jsp/i.test(h)) return 'file';
        return null;
    }
    const isProblemPage = () => !!pageType();
    const getCur = () => ({
        assignID: (location.search.match(/assignID=(\d+)/) || [])[1] || '',
        proNum: (location.search.match(/proNum=(\d+)/) || [])[1] || '',
    });

    /* ============================ 图标（lucide 线性 SVG） ============================ */
    const svg = (p, s) => `<svg class="cgai-svg" width="${s || 16}" height="${s || 16}" viewBox="0 0 24 24" ` +
        `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    const ICON = {
        brand:    svg('<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>', 16),
        settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', 15),
        minus:    svg('<path d="M5 12h14"/>', 16),
        run:      svg('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', 15),
        grind:    svg('<path d="m12 19-7-7 3-3 7 7-3 3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18z"/><path d="m2 2 7.586 7.586"/><circle cx="11" cy="11" r="2"/>', 15),
        stop:     svg('<rect x="6" y="6" width="12" height="12" rx="1"/>', 15),
        ok:       svg('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>', 15),
        warn:     svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 15),
        err:      svg('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>', 15),
        skip:     svg('<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>', 14),
        file:     svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M16 13H8"/><path d="M16 17H8"/>', 14),
        arrowUp:  svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', 15),
        refresh:  svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>', 12),
        bell:     svg('<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>', 15),
        copy:     svg('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>', 14),
        trash:    svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 14),
    };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    /* ============================ 样式（Aurash / Notion） ============================ */
    GM_addStyle(`
        :where(#cgai-panel,#cgai-fab){
            --cg-bg:#ffffff; --cg-bg-subtle:#f7f6f3; --cg-bg-hover:#f1f1ef;
            --cg-text:#37352f; --cg-muted:#787774; --cg-faint:#9b9a97;
            --cg-border:#edece9; --cg-line:#dcdad4; --cg-link:#2383e2; --cg-accent:#0f7b6c;
            --cg-ok-fg:#0f5e54; --cg-ok-bg:rgba(15,123,108,.12); --cg-ok-bd:rgba(15,123,108,.32);
            --cg-err-fg:#b91c1c; --cg-err-bg:rgba(224,62,62,.12); --cg-err-bd:rgba(224,62,62,.32);
            --cg-busy-fg:#b35309; --cg-busy-bg:rgba(217,115,13,.12); --cg-busy-bd:rgba(217,115,13,.32);
            --cg-r-sm:6px; --cg-r-md:8px; --cg-r-lg:12px;
            --cg-shadow:0 10px 32px -8px rgba(15,15,15,.16),0 2px 6px rgba(15,15,15,.05);
            --cg-font:'Inter Tight','PingFang SC',-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;
            --cg-serif:'Source Serif 4','Noto Serif SC',Georgia,'Songti SC',serif;
            --cg-mono:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;
        }
        #cgai-panel,#cgai-panel *{box-sizing:border-box}
        .cgai-svg{display:inline-block;flex:0 0 auto;vertical-align:-2px}
        #cgai-head .cgai-badge .cgai-svg{color:var(--cg-accent)}
        #cgai-status .cgai-svg{margin-right:6px}
        #cgai-title .cgai-svg{color:var(--cg-faint);margin-right:8px;vertical-align:-3px}
        #cgai-fab .cgai-svg{vertical-align:-3px}
        #cgai-panel{position:fixed;right:22px;bottom:22px;width:460px;max-height:88vh;z-index:2147483600;
            background:var(--cg-bg);border:1px solid var(--cg-line);border-radius:var(--cg-r-lg);box-shadow:var(--cg-shadow);
            font-family:var(--cg-font);font-size:13px;line-height:1.5;color:var(--cg-text);display:flex;flex-direction:column;
            overflow:hidden;-webkit-font-smoothing:antialiased}
        #cgai-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 15px;
            background:var(--cg-bg-subtle);border-bottom:1px solid var(--cg-border);cursor:move;user-select:none}
        #cgai-head .cgai-brand{display:flex;align-items:center;gap:9px;min-width:0}
        #cgai-head .cgai-badge{width:27px;height:27px;flex:0 0 27px;display:flex;align-items:center;justify-content:center;
            background:var(--cg-ok-bg);border:1px solid var(--cg-ok-bd);border-radius:var(--cg-r-sm)}
        #cgai-head .cgai-titles{display:flex;flex-direction:column;line-height:1.15;min-width:0}
        #cgai-head .cgai-titles b{font-size:14px;font-weight:600;letter-spacing:.2px}
        #cgai-head .cgai-titles i{font-style:normal;font-size:11px;color:var(--cg-faint)}
        #cgai-head .cgai-tools{display:flex;gap:2px;flex:0 0 auto}
        #cgai-head .cgai-ic{width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;
            color:var(--cg-muted);border-radius:var(--cg-r-sm);transition:.15s}
        #cgai-head .cgai-ic:hover{background:var(--cg-bg-hover);color:var(--cg-text)}
        #cgai-body{padding:14px 15px;overflow:auto}
        .cgai-settings{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;padding:10px 12px;margin-bottom:12px;
            background:var(--cg-bg-subtle);border:1px solid var(--cg-border);border-radius:var(--cg-r-md)}
        .cgai-settings .f{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--cg-muted)}
        .cgai-settings input[type=number]{padding:4px 8px;border:1px solid var(--cg-line);border-radius:var(--cg-r-sm);
            font-size:12.5px;font-family:var(--cg-font);background:var(--cg-bg);color:var(--cg-text);outline:none;width:48px}
        .cgai-settings input:focus{border-color:var(--cg-link);box-shadow:0 0 0 3px rgba(35,131,226,.14)}
        .cgai-chk{display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--cg-text);font-size:12.5px}
        .cgai-chk input{accent-color:var(--cg-accent);width:14px;height:14px}
        .cgai-btns{display:flex;gap:9px}
        .cgai-btn{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:10px 12px;
            border-radius:var(--cg-r-md);font-size:13.5px;font-weight:600;font-family:var(--cg-font);cursor:pointer;
            transition:.15s;letter-spacing:.2px;border:1px solid transparent}
        .cgai-btn .cgai-svg{margin:0}
        .cgai-btn-primary{background:var(--cg-text);color:#fff}
        .cgai-btn-primary:hover{background:#2b2926}
        .cgai-btn-ghost{background:var(--cg-bg);color:var(--cg-text);border-color:var(--cg-line)}
        .cgai-btn-ghost:hover{background:var(--cg-bg-hover)}
        .cgai-btn-danger{background:var(--cg-err-bg);color:var(--cg-err-fg);border-color:var(--cg-err-bd)}
        .cgai-btn-danger:hover{background:rgba(224,62,62,.18)}
        .cgai-btn:disabled{background:var(--cg-bg-subtle);color:var(--cg-faint);border-color:var(--cg-border);cursor:not-allowed}
        .cgai-btn:active{transform:translateY(.5px)}
        #cgai-title{font-family:var(--cg-serif);font-weight:600;font-size:15px;line-height:1.35;margin:13px 0 2px;word-break:break-word}
        #cgai-title:empty{display:none}
        #cgai-status{margin:10px 0 0;padding:9px 11px;border-radius:var(--cg-r-md);background:var(--cg-bg-subtle);
            border:1px solid var(--cg-border);white-space:pre-wrap;min-height:18px;font-size:12.5px}
        #cgai-status:empty{display:none}
        #cgai-status.ok{background:var(--cg-ok-bg);border-color:var(--cg-ok-bd);color:var(--cg-ok-fg)}
        #cgai-status.err{background:var(--cg-err-bg);border-color:var(--cg-err-bd);color:var(--cg-err-fg)}
        #cgai-status.busy{background:var(--cg-busy-bg);border-color:var(--cg-busy-bd);color:var(--cg-busy-fg)}
        #cgai-grind:empty{display:none}
        #cgai-grind{margin-top:12px}
        .cgai-ghead{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--cg-muted);font-weight:600;margin-bottom:6px}
        .cgai-glist{display:flex;flex-direction:column;gap:3px;max-height:240px;overflow:auto;padding-right:2px}
        .cgai-grow{display:flex;align-items:center;gap:8px;padding:5px 9px;border:1px solid var(--cg-border);
            border-radius:var(--cg-r-sm);background:var(--cg-bg-subtle);font-size:12px}
        .cgai-grow .gk{color:var(--cg-muted);font-variant-numeric:tabular-nums;min-width:58px}
        .cgai-grow .gt{flex:1;color:var(--cg-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .cgai-grow .gs{font-weight:600;font-variant-numeric:tabular-nums}
        .cgai-grow.ok{background:var(--cg-ok-bg);border-color:var(--cg-ok-bd)} .cgai-grow.ok .gs{color:var(--cg-ok-fg)}
        .cgai-grow.fail{background:var(--cg-err-bg);border-color:var(--cg-err-bd)} .cgai-grow.fail .gs{color:var(--cg-err-fg)}
        .cgai-grow.cur{border-color:var(--cg-accent);box-shadow:0 0 0 1px var(--cg-accent) inset}
        .cgai-grow.skip{opacity:.7}
        .cgai-sec{margin-top:11px}
        .cgai-sec>summary{cursor:pointer;color:var(--cg-muted);font-weight:600;font-size:12px;outline:none;list-style:none;user-select:none}
        .cgai-sec>summary::-webkit-details-marker{display:none}
        .cgai-sec>summary::before{content:'\\25B8';display:inline-block;margin-right:6px;transition:.15s;color:var(--cg-faint)}
        .cgai-sec[open]>summary::before{transform:rotate(90deg)}
        .cgai-code{margin-top:8px;background:var(--cg-bg-subtle);color:var(--cg-text);border:1px solid var(--cg-border);
            border-radius:var(--cg-r-md);padding:11px 12px;font-family:var(--cg-mono);font-size:12px;line-height:1.55;
            white-space:pre;overflow:auto;max-height:240px;tab-size:4}
        #cgai-verdict:empty{display:none}
        #cgai-verdict{margin-top:10px}
        .cgai-vcard{background:var(--cg-bg-subtle);border:1px solid var(--cg-border);border-radius:var(--cg-r-md);
            padding:11px 12px;font-size:12.5px;line-height:1.7;color:var(--cg-text)}
        .cgai-vcard font{color:var(--cg-text)!important;font-weight:600}
        .cgai-vcard table{border-collapse:collapse;width:100%!important;margin-top:8px;font-size:12px}
        .cgai-vcard td{border:1px solid var(--cg-line);padding:5px 9px}
        .cgai-vcard tr:first-child td{background:var(--cg-bg-hover);font-weight:600;color:var(--cg-muted)}
        .cgai-vcard tr:not(:first-child) td:last-child{color:var(--cg-ok-fg);font-weight:500}
        #cgai-fab{position:fixed;right:22px;bottom:22px;z-index:2147483600;display:none;align-items:center;gap:7px;
            background:var(--cg-text);color:#fff;border-radius:999px;padding:10px 16px;font-weight:600;font-size:13px;
            font-family:var(--cg-font);cursor:pointer;box-shadow:var(--cg-shadow);transition:.15s}
        #cgai-fab:hover{transform:translateY(-1px)}
        .cgai-spin{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;
            border-radius:50%;animation:cgaispin .7s linear infinite;vertical-align:-1px;margin-right:7px;opacity:.7}
        @keyframes cgaispin{to{transform:rotate(360deg)}}
        .cgai-model{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border:1px solid var(--cg-line);
            border-radius:999px;background:var(--cg-bg);color:var(--cg-text);font-size:12px;font-weight:600;cursor:pointer;
            font-family:var(--cg-font);max-width:180px}
        .cgai-model:hover{background:var(--cg-bg-hover)}
        .cgai-model span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        #cgai-config{position:absolute;inset:0;z-index:6;background:var(--cg-bg);display:none;flex-direction:column;padding:15px}
        #cgai-config.open{display:flex}
        #cgai-config .cfg-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
        #cgai-config .cfg-head b{font-size:15px;font-weight:600}
        #cgai-config .cfg-head .sub{font-size:11px;color:var(--cg-faint)}
        #cgai-config .cfg-body{flex:1;overflow:auto}
        .cgai-field{display:flex;flex-direction:column;gap:5px;margin-bottom:13px}
        .cgai-field label{font-size:12px;color:var(--cg-muted);font-weight:600}
        .cgai-field input,.cgai-field select{padding:8px 10px;border:1px solid var(--cg-line);border-radius:var(--cg-r-sm);font-size:13px;
            font-family:var(--cg-mono);background:var(--cg-bg);color:var(--cg-text);outline:none;width:100%}
        .cgai-field select{font-family:var(--cg-font);cursor:pointer;margin-bottom:6px}
        .cgai-field input:focus,.cgai-field select:focus{border-color:var(--cg-link);box-shadow:0 0 0 3px rgba(35,131,226,.14)}
        .cgai-field label{display:flex;align-items:center;justify-content:space-between}
        .cgai-mini{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--cg-line);background:var(--cg-bg);
            color:var(--cg-link);border-radius:999px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:var(--cg-font)}
        .cgai-mini .cgai-svg{vertical-align:-1px}
        .cgai-mini:hover{background:var(--cg-bg-hover)}
        .cgai-field .hint a{color:var(--cg-link);font-weight:600;text-decoration:none}
        .cgai-field .hint a:hover{text-decoration:underline}
        /* 首次使用：指向右上角齿轮的悬浮箭头指引 */
        #cgai-arrow{position:absolute;top:50px;right:12px;z-index:7;display:none;align-items:center;gap:7px;max-width:300px;
            background:var(--cg-link);color:#fff;padding:8px 12px;border-radius:var(--cg-r-md);font-size:12px;font-weight:600;
            line-height:1.35;box-shadow:0 8px 22px rgba(35,131,226,.42);cursor:pointer;animation:cgaibob 1.1s ease-in-out infinite}
        #cgai-arrow.show{display:flex}
        #cgai-arrow .cgai-svg{color:#fff;flex:0 0 auto}
        #cgai-arrow::after{content:'';position:absolute;top:-7px;right:18px;border:7px solid transparent;border-bottom-color:var(--cg-link)}
        @keyframes cgaibob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        #cgai-head .cgai-ic.cgai-attn{color:var(--cg-link);animation:cgaiattn 1.1s ease-in-out infinite}
        @keyframes cgaiattn{0%,100%{box-shadow:0 0 0 0 rgba(35,131,226,.5)}50%{box-shadow:0 0 0 6px rgba(35,131,226,0)}}
        .cgai-field .hint{font-size:11px;color:var(--cg-faint);line-height:1.4}
        /* 铃铛红点（未读 warn/err） */
        #cgai-head .cgai-ic{position:relative}
        .cgai-dot{position:absolute;top:-3px;right:-3px;min-width:15px;height:15px;padding:0 3px;display:none;align-items:center;justify-content:center;
            background:var(--cg-err-fg);color:#fff;border-radius:999px;font-size:9px;font-weight:700;line-height:1;border:1.5px solid var(--cg-bg-subtle);font-variant-numeric:tabular-nums}
        /* 日志 / 诊断浮层 */
        #cgai-log{position:absolute;inset:0;z-index:7;background:var(--cg-bg);display:none;flex-direction:column;padding:15px}
        #cgai-log.open{display:flex}
        #cgai-log .cfg-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
        #cgai-log .cfg-head b{font-size:15px;font-weight:600}
        #cgai-log .cfg-head .sub{font-size:11px;color:var(--cg-faint)}
        #cgai-loglist{flex:1;overflow:auto;border:1px solid var(--cg-border);border-radius:var(--cg-r-md);padding:6px 11px;background:var(--cg-bg-subtle)}
        .cgai-logrow{display:flex;gap:8px;padding:4px 0;border-bottom:1px solid var(--cg-border);font-size:12px;line-height:1.45;align-items:flex-start}
        .cgai-logrow:last-child{border-bottom:none}
        .cgai-logrow .lt{color:var(--cg-faint);font-family:var(--cg-mono);font-size:11px;font-variant-numeric:tabular-nums;flex:0 0 auto;padding-top:1px}
        .cgai-logrow .li{flex:0 0 auto;width:14px;text-align:center}
        .cgai-logrow .lm{flex:1;color:var(--cg-text);min-width:0;word-break:break-word}
        .cgai-logrow .ld{display:block;margin-top:2px;font-family:var(--cg-mono);font-size:11px;color:var(--cg-muted);white-space:pre-wrap;word-break:break-word}
        .cgai-logrow.warn .lm{color:var(--cg-busy-fg)} .cgai-logrow.err .lm{color:var(--cg-err-fg)}
        .cgai-logrow.ok .lm{color:var(--cg-ok-fg)} .cgai-logrow.think .lm{color:var(--cg-link)} .cgai-logrow.gen .lm{color:var(--cg-accent)}
        .cgai-empty{color:var(--cg-faint);font-size:12px;padding:14px 4px;line-height:1.6}
        /* 特殊情况引导 banner */
        #cgai-banners:empty{display:none}
        #cgai-banners{margin-bottom:10px;display:flex;flex-direction:column;gap:8px}
        .cgai-banner{display:flex;gap:9px;padding:10px 11px;border-radius:var(--cg-r-md);border:1px solid var(--cg-border)}
        .cgai-banner.warn{background:var(--cg-busy-bg);border-color:var(--cg-busy-bd)} .cgai-banner.warn .bi{color:var(--cg-busy-fg)}
        .cgai-banner.err{background:var(--cg-err-bg);border-color:var(--cg-err-bd)} .cgai-banner.err .bi{color:var(--cg-err-fg)}
        .cgai-banner .bi{flex:0 0 auto;padding-top:1px}
        .cgai-banner .bc{flex:1;min-width:0;font-size:12px;line-height:1.5}
        .cgai-banner .bc b{font-size:12.5px;font-weight:600;display:block;margin-bottom:2px}
        .cgai-banner .bx{margin-top:4px;font-family:var(--cg-mono);font-size:11px;color:var(--cg-muted);word-break:break-all}
        .cgai-banner .bgo{margin-top:7px}
    `);

    /* ============================ 文本工具 ============================ */
    function htmlToText(html) {
        return String(html || '')
            .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<\/pre>/gi, '\n')
            .replace(/<li[^>]*>/gi, ' - ').replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&').replace(/ /g, ' ')
            .replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    function titleOf() {
        const a = document.querySelector('.breadcrumb .breadcrumb-item.active');
        if (a) return a.textContent.replace(/\s+/g, ' ').trim();
        // _ce 在线编辑题无面包屑：题号标题在描述区首行（如「3. 求最大公约数」）
        const ce = document.querySelector('#cgcode_description-content') || document.querySelector('[id*="description-content"]');
        if (ce) { const first = (ce.textContent || '').split('\n').map(s => s.trim()).filter(Boolean)[0]; if (first) return first.replace(/\s+/g, ' ').trim(); }
        return (document.title || '').replace(/CourseGrading|详细评判信息[:：]?/g, '').trim() || '(题目)';
    }
    // 题面：_ce 在线编辑题取描述容器；普通编程题/接口题取面包屑与首个 <hr> 之间
    function extractStatement() {
        // _ce（programList_ce.jsp）是组件化布局（cgcode_*），无 .col-10/面包屑，题面在稳定 id 的描述容器里
        const ce = document.querySelector('#cgcode_description-content') || document.querySelector('[id*="description-content"]');
        if (ce) return htmlToText(ce.innerHTML);
        const col = document.querySelector('#cgcontainerID .col-10') || document.querySelector('.col-10') || document.body;
        const nav = col.querySelector('nav[aria-label="breadcrumb"]');
        let html = '';
        if (nav) { let n = nav.nextSibling; while (n) { if (n.nodeType === 1 && n.tagName === 'HR') break; if (n.nodeType === 1) html += n.outerHTML; else if (n.nodeType === 3) html += n.nodeValue; n = n.nextSibling; } }
        return htmlToText(html);
    }
    function readPrefilledMain() { const el = document.getElementById('javamanclass'); return el && el.value.trim() ? el.value.trim() : ''; }
    // 填空题：把带 <textarea name=answerN> 的代码还原成带 /*__GAPk__*/ 标记的模板
    function extractGap() {
        const form = document.getElementById('uploadFORM') || document.querySelector('form[name="uploadFORM"]');
        if (!form) return { template: '', gaps: 0 };
        const nodes = form.querySelectorAll('code.cgcode, textarea[name^="answer"]');
        const parts = []; let gaps = 0;
        nodes.forEach(n => {
            if (n.tagName === 'TEXTAREA') { const k = +((n.getAttribute('name') || '').match(/answer(\d+)/) || [])[1] || 0; gaps = Math.max(gaps, k); parts.push(`/*__GAP${k}__*/`); }
            else parts.push(n.textContent);
        });
        let template = parts.join('');
        if (!template) { // 兜底：整表去掉控件后的文本
            const c = form.cloneNode(true);
            c.querySelectorAll('textarea[name^="answer"]').forEach(t => { const k = +((t.getAttribute('name') || '').match(/answer(\d+)/) || [])[1] || 0; gaps = Math.max(gaps, k); t.replaceWith(document.createTextNode(`/*__GAP${k}__*/`)); });
            c.querySelectorAll('input,button,select,script,style,iframe').forEach(e => e.remove());
            template = c.textContent.replace(/\n{3,}/g, '\n\n').trim();
        }
        template = template.replace(/\u00a0/g, ' ').replace(/\u3000/g, '  '); // normalize nbsp / fullwidth
        return { template, gaps };
    }
    // 统一提取：根据题型返回 problem 对象
    function extractFor(kind) {
        const title = titleOf();
        if (kind === 'gap') { const g = extractGap(); return { kind, title, statement: extractStatement(), template: g.template, gaps: g.gaps }; }
        const p = { kind, title, statement: extractStatement() };
        if (kind === 'iface') p.mainClass = readPrefilledMain() || '';
        return p;
    }

    /* ============================ 列表 / 队列发现 ============================ */
    function discoverAssignList() {
        const seen = new Set(), list = [];
        document.querySelectorAll('a[href*="index.jsp"]').forEach(a => { const m = (a.getAttribute('href') || '').match(/assignID=(\d+)/); if (m && !seen.has(m[1])) { seen.add(m[1]); list.push(m[1]); } });
        return list;
    }
    function discoverCourseID() { const m = (document.body.innerHTML || '').match(/courseID=(\d+)/); return m ? m[1] : ''; }
    function gmGetText(url) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET', url, responseType: 'arraybuffer', timeout: 15000,
                onload: r => { try { resolve(new TextDecoder('gbk').decode(new Uint8Array(r.response))); } catch (_) { resolve(''); } },
                onerror: () => resolve(''), ontimeout: () => resolve(''),
            });
        });
    }
    async function fetchAssignList() {
        const txt = await gmGetText(`${OJ}/assignment/mainActiveAssigns.jsp`);
        const seen = new Set(), list = [], re = /assignID=(\d+)/g; let m;
        while ((m = re.exec(txt))) if (!seen.has(m[1])) { seen.add(m[1]); list.push(m[1]); }
        return list;
    }
    // 读某作业 index.jsp，提取「实际存在」的题目链接（含正确页型），按 proNum 升序
    // 同一 assign 可能有多种题型（如 53 同时有填空题+接口题），proNum 在不同题型里会重复，
    // 因此必须按「页型 + proNum」去重/标识，不能只按 proNum（否则会丢题、key 冲突）
    function parseAssignProblems(html, assignID) {
        const seen = new Set(), items = [];
        const re = /(programList_ce|programList|programFillGapList|programWithInterfaceList)\.jsp\?([^"'\s>]+)/g; let m; // programList_ce 须在 programList 前（否则 _ce 链接只匹配到 programList 再卡在 \.jsp 失败）
        while ((m = re.exec(html))) {
            const page = m[1] + '.jsp', q = m[2];
            const pn = (q.match(/proNum=(\d+)/) || [])[1], aid = (q.match(/assignID=(\d+)/) || [])[1];
            if (pn && aid === String(assignID)) { const key = page + ':' + pn; if (!seen.has(key)) { seen.add(key); items.push({ assignID: String(assignID), proNum: +pn, page }); } }
        }
        items.sort((a, b) => a.page.localeCompare(b.page) || a.proNum - b.proNum);
        return items;
    }
    // 未抽题的作业（有"抽取题目"按钮、还没抽过）开刷前自动抽一次；已抽过的（显示"重新抽取题目"）绝不重抽——重抽会换题、清掉已有进度
    function needsDraw(html) {
        return /name=["']?randomAssignFORM/i.test(html) && /value=["']抽取题目["']/.test(html) && !/重新抽取题目/.test(html);
    }
    function gmPostForm(url, data) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'POST', url, data, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                responseType: 'arraybuffer', timeout: 25000,
                onload: r => { try { resolve(new TextDecoder('gbk').decode(new Uint8Array(r.response))); } catch (_) { resolve(''); } },
                onerror: () => resolve(''), ontimeout: () => resolve(''),
            });
        });
    }
    async function fetchAssignProblems(assignID, courseID) {
        const url = `${OJ}/assignment/index.jsp?${courseID ? 'courseID=' + courseID + '&' : ''}assignID=${assignID}`;
        let html = await gmGetText(url);
        let items = parseAssignProblems(html, assignID);
        if (!items.length && needsDraw(html)) { // 开刷前自动抽题（仅对"未抽过"的作业）：POST randomAssign.jsp + doChoose=true，再重读题目链接
            tickStatus(`作业 ${assignID} 未抽题，正在自动抽取…`);
            LOG.push('info', `作业 ${assignID} 未抽题，自动抽取一次`);
            await gmPostForm(`${OJ}/assignment/randomAssign.jsp`, `assignID=${assignID}&doChoose=true`);
            // 轮询回读，直到读到题目或页面变为「重新抽取题目」(抽题已生效)；服务器慢时不过早返回空，避免用户二次「开刷」触发重抽换题、清掉已有进度
            for (let tries = 0; tries < 6; tries++) {
                await sleep(800);
                html = await gmGetText(url);
                items = parseAssignProblems(html, assignID);
                if (items.length || /重新抽取题目/.test(html)) break;
            }
            if (!items.length) LOG.push('warn', `作业 ${assignID} 抽题后仍未读到题目，可能抽取失败或服务器较慢；请勿重复「开刷」以免重抽换题`);
        }
        return items;
    }
    async function buildQueue() {
        let assignList = isProblemPage() ? discoverAssignList() : [];
        if (!assignList.length) assignList = await fetchAssignList();
        assignList = [...new Set(assignList.map(String))].sort((a, b) => +a - +b); // 从最小作业开始
        const courseID = discoverCourseID();
        const queue = [];
        for (const a of assignList) queue.push(...await fetchAssignProblems(a, courseID));
        queue.sort((x, y) => (+x.assignID - +y.assignID) || x.page.localeCompare(y.page) || (x.proNum - y.proNum));
        return queue;
    }

    /* ============================ DeepSeek ============================ */
    function buildMessages(problem, prev) {
        const common = 'You are an expert solver for a Chinese university Java online judge (CourseGrading/educg). The judge compares program stdout against hidden test cases and must match byte-for-byte.';
        let sys, user;
        if (problem.kind === 'gap') {
            sys = [common, '', 'This is a FILL-IN-THE-BLANK Java problem. You are given Java source with blanks marked /*__GAPk__*/.',
                'Output ONLY a single JSON object mapping each blank number (string key) to the exact code text that fills that blank — nothing else, no code fence, no prose.',
                'Each value is just the snippet for that blank (do NOT repeat surrounding code). Keep it ASCII. Example: {"1":"abstract class","2":"return this.x;"}'].join('\n');
            user = `${problem.statement ? '【题目说明】\n' + problem.statement + '\n\n' : ''}【带空位的代码】\n${problem.template}\n\n请按上面要求输出 JSON。`;
        } else if (problem.kind === 'iface') {
            const mc = problem.mainClass || 'Main';
            const simple = mc.split('.').pop(), pkg = mc.includes('.') ? mc.slice(0, mc.lastIndexOf('.')) : '';
            sys = [common, '',
                'This is an INTERFACE-IMPLEMENTATION problem. The judge often (not always) provides hidden framework files — e.g. the interface named in the problem.',
                'DEFAULT: do NOT redefine the interface named in the problem (if the judge provides it, redefining causes a "duplicate class" compile error). Implement only the concrete class(es).',
                'BUT this is adaptive via feedback: if a later round reports "cannot find symbol" for that interface/type, it is NOT provided — then DO define it yourself with the exact methods described in the problem. If a round reports "duplicate class", remove your definition of that type.',
                `Submit ONE source file whose PUBLIC class is \`${simple}\`${pkg ? ' with a `package ' + pkg + ';` declaration' : ''} (saved as ${simple}.java).`,
                'If the samples show stdin→stdout, give that public class a `main` that reads stdin, computes, and prints EXACTLY the sample output (match the exact format, e.g. "Fee=72.0").',
                'Other needed helper classes may be top-level non-public in the same file, but NEVER include the provided interface. Output ONLY one fenced ```java code block, no prose. ASCII only unless the sample needs otherwise.'].join('\n');
            user = `【题目标题】${problem.title}\n\n【题目内容】\n${problem.statement}\n\n请给出可直接提交的 Java 源文件（公共类名 ${simple}）。`;
        } else {
            sys = [common, '', 'Produce ONE complete, compilable Java program reading stdin and writing stdout, matching the sample output EXACTLY (every space/blank line/trailing whitespace).',
                'Output ONLY one fenced ```java code block, no prose.',
                'Rules: `public class Main` with `public static void main(String[] args)`; helper classes non-public or nested; NO package; ASCII only unless sample requires; read all stdin until EOF; only the Java standard library.'].join('\n');
            user = `【题目标题】${problem.title}\n\n【题目内容】\n${problem.statement}\n\n请给出完整 Java 解法。`;
        }
        return [{ role: 'system', content: sys }, { role: 'user', content: user }];
    }
    const STALL_FIRST = 20; // 秒：生成阶段静默超过该阈值才视作「可能卡住」
    const STALL_THINK = 35; // 秒：思考/等待阶段更宽容（推理模型常先静默/边思考边出，静默≠卡住），到阈值也只平静提示「仍在思考」
    const STALL_HARD = 60;  // 秒：生成阶段静默到此硬阈值且已有正文，主动收口已拿到的正文（避免服务端流完不发 [DONE] 又不关连接时干等到超时）
    // 纯函数（可单测）：把(阶段, 静默秒数)映射成状态展示——把「思考 / 生成 / 卡住」判定集中一处，
    // 关键：只有 gen（已在出正文）阶段的静默才报「可能卡住」并弹 banner；think/wait 阶段一律按「在思考/等待」处理，不误判为慢/卡住。
    function streamStallState(phase, secs) {
        if (phase === 'gen') return { info: `⚠ ${secs}s 无新增，可能卡住`, level: 'warn', banner: 'stall', log: `生成中断 ${secs}s（可能卡住）` };
        if (phase === 'think') return { info: `🧠 仍在思考（已 ${secs}s 无新增，推理模型可能在静默推理）`, level: 'think', banner: null, log: `思考静默 ${secs}s（仍在推理，未判卡住）` };
        return { info: `⏳ 等待响应 ${secs}s（推理模型可能正在思考）`, level: 'info', banner: null, log: `等待首个响应已 ${secs}s` };
    }
    /* ---- SSE 解析（纯函数，可单测）：从「累积到目前的全文」整体重建 content/reasoning ---- */
    // 每次拿到的是累积全文，整段重解析：尾部不完整的一行 JSON.parse 失败被跳过，下次补全再解。
    function parseSSE(buf) {
        let content = '', reasoning = '', sawSSE = false, done = false, errObj = null, finishReason = null;
        const lines = String(buf || '').split('\n');
        for (const raw of lines) {
            const s = raw.replace(/\r$/, '').replace(/^\s+/, '');
            if (!/^data:/.test(s)) continue;
            sawSSE = true;
            const d = s.slice(5).trim();
            if (!d) continue;
            if (d === '[DONE]') { done = true; continue; }
            let o; try { o = JSON.parse(d); } catch (_) { continue; } // 尾部半行，下次补全再解
            if (o.error) { errObj = o.error; continue; }
            const ch = o.choices && o.choices[0];
            if (ch && ch.finish_reason != null) finishReason = ch.finish_reason; // 仅非 null 才覆盖：防 usage-only 尾帧把它清空
            const delta = ch && (ch.delta || ch.message);
            if (delta) {
                if (typeof delta.content === 'string') content += delta.content;
                if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
            }
        }
        return { content, reasoning, sawSSE, done, errObj, finishReason };
    }
    const llmErr = (msg, kind, extra) => Object.assign(new Error(msg), { kind: kind || 'http', extra: extra || '' });
    // 服务端「max_tokens 超模型上限」类错误文本特征（deepseek 这类 400 是 kind:'http'，按文本判不按 kind）
    const CAP_RE = /max[_ ]?tokens|maximum (context|number of tokens)|context length|too many tokens|reduce.*length/i;
    // 纯函数（可单测）：按「思考开/关 + 学习到的模型上限 cap」决定本版 max_tokens。
    // 思考模型把预算大量花在 reasoning_content 上，默认给 32768、普通 8192；用户在配置页填了 maxTokens 则优先；cap>0 时钳到学习上限。
    function autoTokens(opt, s, cap) {
        let t = (s && +s.maxTokens) || ((opt && opt.thinking) ? 32768 : 8192);
        if (cap && cap > 0) t = Math.min(t, cap);
        return t;
    }
    // 纯函数（可单测）：思考耗尽 token 预算(starved)时是否加大 max_tokens 重试本版——翻倍、封顶 65536、每版≤2 次。
    function decideRetry(errKind, curTokens, bumps) {
        if (errKind === 'starved' && bumps < 2) {
            const next = Math.min(curTokens * 2, 65536);
            if (next > curTokens) return { retry: true, tokens: next };
        }
        return { retry: false, tokens: curTokens };
    }

    // 流式调用：边收边解，实时回调 hooks.onProgress({phase,reasoningLen,contentLen}) 与 hooks.onStall(secs,hadData)。
    // 解决根因：stream:false 时长生成会整段缓冲、连接空闲常被掐 → 「无响应」；流式让数据持续流入，并能区分「思考 / 生成 / 真卡住」。
    // v2.4.6：用 responseType:'stream' 自己读 ReadableStream —— 脚本猫(ScriptCat,MV3)默认 responseType:'text' 走后台原生 XHR，
    //   正文只在 onload 一次性回传、onprogress 期间拿不到中间文本（假流式/整段缓冲）；唯有 stream 路径(FetchXHR)按网络 chunk 推送，才是真增量。
    //   注意：脚本猫 content 端的流不会被 close()（只在 DONE 置 undefined GC），故读流只当「实时进度喂料」，最终收口仍走 onload（此时 chunk 已全部入队，
    //   消息间的 microtask 已把缓冲读全）。拿不到流的管理器(VM/GM/老版)自动回退 responseText —— 退化为整段返回但答案仍正确，绝不回归。
    function callLLM(messages, opts, apiKey, timeoutMs, hooks) {
        const baseURL = getBaseURL(), host = baseURL.replace(/^https?:\/\//, '');
        const payload = { model: opts.model, messages, stream: true, temperature: opts.temperature ?? 0, max_tokens: opts.maxTokens || 8192 };
        if (/deepseek/i.test(baseURL)) payload.thinking = { type: opts.thinking ? 'enabled' : 'disabled' };
        return new Promise((resolve, reject) => {
            let lastLen = -1, lastDataAt = Date.now(), hadData = false, settled = false, stallT = null, phase = 'wait';
            let streamBuf = '', gotStream = false, lastContent = '', reader = null, grabbed = false, ticks = 0;
            const dec = (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8') : null;
            const fin = fn => { if (settled) return; settled = true; if (stallT) clearInterval(stallT); if (reader) { try { reader.cancel(); } catch (_) {} } fn(); };
            const onText = txt => {
                const r = parseSSE(txt);
                if (!r.sawSSE) return;
                const len = r.content.length + r.reasoning.length;
                if (len !== lastLen) { lastLen = len; lastDataAt = Date.now(); if (len > 0) { hadData = true; ticks++; } }
                lastContent = r.content;
                phase = r.content ? 'gen' : (r.reasoning ? 'think' : 'wait'); // gen=已出正文 / think=只有思考 / wait=尚无任何 token
                if (hooks && hooks.onProgress) hooks.onProgress({ phase, reasoningLen: r.reasoning.length, contentLen: r.content.length });
            };
            // 读 ReadableStream（脚本猫/TM 在 responseType:'stream' 下给的真增量流），增量解码喂给 onText。只读一次，settle 后 cancel。
            const pump = rs => {
                if (grabbed || !rs || typeof rs.getReader !== 'function') return;
                grabbed = true;
                try { reader = rs.getReader(); } catch (_) { return; }
                const step = () => reader.read().then(({ done, value }) => {
                    if (settled) { try { reader.cancel(); } catch (_) {} return; }
                    if (done) return;                       // TM 会 close 流到此结束；脚本猫不 close → 永挂 read()，靠 onload 收口 + settle 时 cancel
                    if (value != null) {
                        const chunk = (typeof value === 'string') ? value : (dec ? dec.decode(value, { stream: true }) : '');
                        if (chunk) { streamBuf += chunk; gotStream = true; onText(streamBuf); }
                    }
                    step();
                }).catch(() => {});
                step();
            };
            // 阈值按阶段区分：生成阶段 20s 静默才提示「可能卡住」；思考/等待阶段给到 35s 且只平静提示，避免把「在思考」误判成「响应慢/卡住」。
            // 生成阶段静默到 STALL_HARD(60s) 且已有正文：主动收口已拿到的正文（服务端流完不发 [DONE] 又不关连接时不再干等到超时）。
            stallT = setInterval(() => {
                const gap = Math.round((Date.now() - lastDataAt) / 1000);
                if (phase === 'gen' && gap >= STALL_HARD && hadData && lastContent) return fin(() => resolve(lastContent));
                const thr = phase === 'gen' ? STALL_FIRST : STALL_THINK;
                if (gap >= thr && hooks && hooks.onStall) hooks.onStall(gap, hadData, phase);
            }, 1000);
            GM_xmlhttpRequest({
                method: 'POST', url: baseURL + '/chat/completions', data: JSON.stringify(payload),
                responseType: 'stream', timeout: Math.max(8000, timeoutMs || 120000),
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey, 'Accept': 'text/event-stream' },
                onloadstart: r => { try { if (r && r.response) pump(r.response); } catch (_) {} },
                onreadystatechange: r => { try { if (!grabbed && r && r.response && r.readyState >= 2) pump(r.response); } catch (_) {} },
                onprogress: e => { try { if (!grabbed && e && e.response) pump(e.response); const t = (e && typeof e.responseText === 'string') ? e.responseText : null; if (t) onText(t); } catch (_) {} },
                onload: r => fin(() => {
                    if (r.status === 401) return reject(llmErr('API Key 无效 (401)，请到配置页检查', 'auth'));
                    // 收口：优先用自己读到的流式累积文本（脚本猫真增量）；拿不到则退回 responseText/response（非 stream 管理器一次性给）
                    const body = (gotStream && streamBuf) ? streamBuf
                        : (typeof r.responseText === 'string' && r.responseText) ? r.responseText
                        : (typeof r.response === 'string' && r.response) ? r.response : streamBuf;
                    if (hooks && hooks.onStreamMode) hooks.onStreamMode(gotStream, ticks); // 探针：本次是真增量还是退化为整段（拿真机实据）
                    if (r.status === 0 && !body) return reject(llmErr(`连不上 ${host}（浏览器能否访问该 API？脚本猫是否已允许跨域连接？）`, 'connect'));
                    const p = parseSSE(body);
                    if (p.sawSSE) {                       // 正常流式
                        if (p.content) { if (p.errObj && hooks && hooks.onServerError) hooks.onServerError(p.errObj); return resolve(p.content); }
                        if (p.errObj) {
                            const es = JSON.stringify(p.errObj);
                            if (CAP_RE.test(es)) return reject(llmErr(`${host}: max_tokens 超模型上限——${p.errObj.message || p.errObj.code || es}`, 'capped', opts.maxTokens));
                            return reject(llmErr(`${host} 返回错误：${p.errObj.message || p.errObj.code || es}`, /model/i.test(es) ? 'model' : 'http'));
                        }
                        // 无正文：finish_reason=length(或缺 finish_reason 但有思考)=思考耗尽预算(starved，应加大重试)；stop 且空=模型自愿收尾(empty，不重试)
                        const starved = p.finishReason === 'length' || (p.finishReason == null && p.reasoning);
                        return reject(llmErr(starved ? '思考耗尽 token 预算（finish_reason=length 或思考占满，正文未写完）' : '返回内容为空（仅有思考无正文）', starved ? 'starved' : 'empty'));
                    }
                    // 非 SSE：服务商忽略了 stream:true，按普通 JSON 处理（成功或错误体）
                    let d = null; try { d = JSON.parse(body); } catch (_) {}
                    if (d && d.error) {
                        const es = JSON.stringify(d.error), m = d.error.message || d.error.code || '';
                        if (CAP_RE.test(es)) return reject(llmErr(`${host}: max_tokens 超模型上限——${m}`, 'capped', opts.maxTokens));
                        return reject(llmErr(`${host} 返回错误：${m}`, /model|UnsupportedModel/i.test(es) ? 'model' : 'http', `HTTP ${r.status}`));
                    }
                    if (r.status !== 200) {
                        if (CAP_RE.test(String(body))) return reject(llmErr(`${host}: max_tokens 超模型上限`, 'capped', opts.maxTokens));
                        return reject(llmErr(`API ${r.status}: ${String(body).slice(0, 200)}`, r.status === 404 ? 'model' : 'http'));
                    }
                    const c = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
                    if (!c) {
                        const starved = (d && d.choices && d.choices[0] && d.choices[0].finish_reason) === 'length';
                        return reject(llmErr(starved ? '思考耗尽 token 预算（finish_reason=length）' : '返回内容为空（max_tokens 不足或思考耗尽）', starved ? 'starved' : 'empty'));
                    }
                    resolve(c);
                }),
                onerror: r => fin(() => reject(llmErr(`连不上 ${host}（浏览器无法访问该 API，或脚本猫未授权跨域；status=${r && r.status}）`, 'connect'))),
                ontimeout: () => fin(() => reject(llmErr(`请求 ${host} 超时——多半是网络不通或模型长时间无完整响应`, 'timeout'))),
            });
        });
    }
    function parseJavaCode(content) { const m = String(content || '').match(/```(?:java)?\s*([\s\S]*?)```/i); return (m ? m[1] : content || '').trim(); }
    function detectMainClass(code) { let m = code.match(/public\s+class\s+([A-Za-z_]\w*)/) || code.match(/\bclass\s+([A-Za-z_]\w*)/); return m ? m[1] : 'Main'; }
    function parseGapAnswers(raw) {
        let t = String(raw || '').trim();
        const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (m) t = m[1].trim();
        const s = t.indexOf('{'), e = t.lastIndexOf('}'); if (s >= 0 && e >= 0) t = t.slice(s, e + 1);
        let o; try { o = JSON.parse(t); } catch (_) { o = null; }
        const out = {}; if (o) Object.keys(o).forEach(k => { const n = (k.match(/\d+/) || [])[0]; if (n != null) out[n] = String(o[k]); });
        return out;
    }

    /* ============================ 提交 / 判题 ============================ */
    // 直接用 GM_xmlhttpRequest 提交（绕开页面那个会被 disable 的提交按钮，避免重试时新代码没真正提交）
    function gmSubmit(url, body, extraHeaders) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST', url, data: body, timeout: 60000,
                headers: Object.assign({ 'Referer': location.href }, extraHeaders || {}),
                onload: r => resolve(r), onerror: () => reject(new Error('提交失败（网络/未授权跨域）')), ontimeout: () => reject(new Error('提交超时')),
            });
        });
    }
    function submitFile(ids, code, mainClass) {
        const simple = (mainClass || 'Main').split('.').pop();
        const wtime = Math.max(1, Math.round((Date.now() - pageT0) / 1000));
        const fd = new FormData();
        fd.append('FILE1', new Blob([code], { type: 'text/x-java' }), simple + '.java');
        fd.append('cgSubmitBtn', 'tijiao'); // 不要手动设 Content-Type，让 FormData 自带 boundary
        const url = `${OJ}/assignment/showProcessMsg.jsp?problemID=${ids.problemID}&assignID=${ids.assignID}&doSubmit=true&progLanguage=java&javaMainCLass=${encodeURIComponent(mainClass || 'Main')}&wtime=${wtime}`;
        return gmSubmit(url, fd);
    }
    function submitGap(ids, answers) {
        const wtime = Math.max(1, Math.round((Date.now() - pageT0) / 1000));
        const p = new URLSearchParams();
        p.set('doSubmit', 'true'); p.set('byCE', 'true'); p.set('wtime', String(wtime));
        p.set('progLanguage', 'java'); p.set('problemID', ids.problemID); p.set('assignID', ids.assignID);
        Object.keys(answers).forEach(k => p.set('answer' + k, answers[k]));
        return gmSubmit(`${OJ}/assignment/showProcessMsg.jsp`, p.toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
    }
    // _ce 在线代码编辑器题：源码走表单字段 cgsoucecode + byCE（页面无 FILE1 文件框），实测与 programList 同判题端点
    function submitCE(ids, code, mainClass) {
        const wtime = Math.max(1, Math.round((Date.now() - pageT0) / 1000));
        const p = new URLSearchParams();
        p.set('doSubmit', 'true'); p.set('byCE', 'true'); p.set('wtime', String(wtime));
        p.set('progLanguage', 'java'); p.set('javaMainCLass', mainClass || 'Main');
        p.set('problemID', ids.problemID); p.set('assignID', ids.assignID);
        p.set('cgsoucecode', code);
        return gmSubmit(`${OJ}/assignment/showProcessMsg.jsp`, p.toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
    }
    // 提交后让页面自带的「运行结果」iframe 播放原生判题动画（GM_xhr 提交本身不触发它）
    function showNativeProgress(ids) {
        const fr = document.getElementById('showmessageFRAME') || document.getElementById('showmessageFrame') || document.querySelector('iframe[name^="showmessage"]');
        if (fr) try { fr.src = `${OJ}/assignment/longtimerun.jsp?assignID=${ids.assignID}&problemID=${ids.problemID}&doSubmit=true&_=${Date.now()}`; } catch (_) {}
    }
    // 仅「关闭自动提交」时用：填进页面表单让用户自己点提交
    function fillOnly(code, mainClass) {
        // _ce 在线编辑题：把代码灌进编辑器（textarea + 其上的 CodeMirror 实例），让用户自己点提交
        const ceEl = document.getElementById('cgsoucecode');
        if (ceEl) {
            ceEl.value = code;
            const cmHost = document.querySelector('.CodeMirror');
            if (cmHost && cmHost.CodeMirror) { try { cmHost.CodeMirror.setValue(code); } catch (_) {} }
            ceEl.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }
        const fileInput = document.getElementById('CGFILE'), mainEl = document.getElementById('javamanclass');
        if (mainEl && mainClass) mainEl.value = mainClass;
        if (fileInput) { const simple = (mainClass || 'Main').split('.').pop(); const dt = new DataTransfer(); dt.items.add(new File([code], simple + '.java', { type: 'text/x-java' })); fileInput.files = dt.files; fileInput.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    function fetchVerdict(assignID, problemID) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url: `${OJ}/assignment/longtimerunJSON.jsp?assignID=${assignID}&problemID=${problemID}&_=${Date.now()}`,
                responseType: 'arraybuffer', timeout: 20000,
                onload: r => { try { resolve(new TextDecoder('gbk').decode(new Uint8Array(r.response))); } catch (e) { resolve(''); } },
                onerror: () => reject(new Error('获取判题结果失败')), ontimeout: () => reject(new Error('获取判题结果超时')),
            });
        });
    }
    function parseVerdict(text) {
        if (!text) return null;
        const s = text.indexOf('['), e = text.lastIndexOf(']'); if (s < 0 || e < 0) return null;
        let arr; try { arr = JSON.parse(text.slice(s, e + 1)); } catch (_) { return null; }
        return { ret: (arr.find(o => 'ret' in o) || {}).ret, content: (arr.find(o => 'content' in o) || {}).content || '' };
    }
    const submitTimeOf = c => { const m = (c || '').match(/最后一次提交时间[:：]\s*([0-9][0-9\-\s:]+)/); return m ? m[1].trim() : ''; };
    // 用「最后一次提交时间」作为新鲜度判据——避免重复提交内容相同时永远等不到（旧版卡死根因）
    async function pollVerdict(assignID, problemID, baselineTime, hardDeadline) {
        const deadline = Math.min(Date.now() + 90000, hardDeadline || (Date.now() + 90000));
        await sleep(Math.min(2500, Math.max(0, deadline - Date.now())));
        let last = null;
        while (Date.now() < deadline) {
            let text = ''; try { text = await fetchVerdict(assignID, problemID); } catch (_) {}
            const v = parseVerdict(text);
            if (v && v.content && !/正在评判|排队|评判中|judging/i.test(v.content)) {
                last = v;
                if (v.ret === '1' && (!baselineTime || submitTimeOf(v.content) !== baselineTime)) return v;
            }
            await sleep(2000);
        }
        return last;
    }
    function scoreOf(c) {
        const txt = htmlToText(c || '');
        const passed = (txt.match(/完全正确/g) || []).length;
        const total = +((txt.match(/共有测试数据[:：]\s*(\d+)/) || [])[1]) || 0;
        const score = (txt.match(/得分\s*([\d.]+)/) || [])[1] || null;
        return { passed, total, score };
    }
    // dynamictest 的「期望vs实际」需先经 judgeDetailsCheck 触发服务端按需生成，否则直接 POST 返回空
    // ——本仓血泪坑：不触发→拿不到差异→ feedbackFromHtml 只能回"未取到具体差异"→纠错退化成盲目重试，模型永远修不对
    async function ensureDetailReady(assignID, problemID) {
        const restOf = t => { const m = (t || '').match(/<rest>\s*(-?\d+)\s*<\/rest>/i); return m ? +m[1] : NaN; };
        // rest = 剩余百分比：>0 仍在生成（轮询），0 完成，<0(-1/-2) 无详情/未提交
        let rest = restOf(await gmGetText(`${OJ}/assignment/judgeDetailsCheck.jsp?checkFirst=true&assignID=${assignID}&problemID=${problemID}`));
        for (let i = 0; i < 15 && rest > 0; i++) {
            await sleep(1000);
            rest = restOf(await gmGetText(`${OJ}/assignment/judgeDetailsCheck.jsp?assignID=${assignID}&problemID=${problemID}`));
        }
        await sleep(300); // 完成后稍等，确保 dynamictest 数据落地
    }
    // 失败时读「动态测试」详情：期望输出 vs 你的输出，反馈给模型（先触发生成再取）
    async function fetchFailDetail(assignID, problemID) {
        try { await ensureDetailReady(assignID, problemID); } catch (_) {}
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'POST', url: `${OJ}/assignment/moretest/dynamictest.jsp`, data: `assignID=${assignID}&problemID=${problemID}&userID=`,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, responseType: 'arraybuffer', timeout: 20000,
                onload: r => { let html = ''; try { html = new TextDecoder('gbk').decode(new Uint8Array(r.response)); } catch (_) {} resolve(html); },
                onerror: () => resolve(''), ontimeout: () => resolve(''),
            });
        });
    }
    // 编译/运行错误在判题 content 里（不是 dynamictest）——优先从已拿到的 verdict 提取
    function verdictError(content) {
        const t = htmlToText(content || '');
        if (/编译错误|编译失败|compile error/i.test(t)) { const seg = (t.match(/编译[\s\S]{0,700}/) || [''])[0]; return { type: 'compile', text: seg.trim() }; }
        if (/运行错误|超时|超时限制|段错误|runtime error|time limit/i.test(t)) { const seg = (t.match(/(运行错误|超时|超时限制|段错误|内存|runtime error|time limit)[\s\S]{0,400}/i) || [''])[0]; return { type: 'runtime', text: seg.trim() }; }
        return null;
    }
    // 把空白可视化，让模型能看清「格式/对齐/行尾空格/末尾换行」这类肉眼不可见的差异
    function visWs(s) {
        return String(s == null ? '' : s).replace(/ /g, '·').replace(/\t/g, '⇥').replace(/\r/g, '␍').replace(/\n/g, '⏎\n');
    }
    function feedbackFromHtml(html) {
        if (!html) return '';
        let doc; try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (_) { return ''; }
        const txt = (doc.body && doc.body.textContent) || '';
        if (/编译错误|编译失败|compile error/i.test(txt) && !/成功通过编译/.test(txt)) {
            const seg = (txt.match(/编译[\s\S]{0,600}/) || [''])[0];
            return '上次提交【编译错误】：\n' + seg.trim().slice(0, 800) + '\n请修正使其能通过编译后重新输出完整答案。';
        }
        const NB = String.fromCharCode(160);
        const cases = []; let anyFmt = false;
        doc.querySelectorAll('pre[id^="wrongContent"]').forEach(w => {
            if (cases.length >= 6) return;
            const n = (w.id.match(/wrongContent(\d+)/) || [])[1];
            const r = doc.getElementById('rightContent' + n);
            const wrong = (w.textContent || '').split(NB).join(' ');
            const right = (r ? r.textContent : '').split(NB).join(' ');
            if (right === wrong) return; // 完全一致=该测试点已通过，跳过（不再用 trim 比较，否则会漏掉纯行尾空白差异）
            const fmtOnly = right.replace(/\s+/g, '') === wrong.replace(/\s+/g, '');
            if (fmtOnly) anyFmt = true;
            cases.push(`【测试点${n}】${fmtOnly ? '（内容相同，仅空白/格式不同！注意对齐方式与行尾空白）' : ''}\n期望输出:\n${visWs(right).slice(0, 700)}\n你的输出:\n${visWs(wrong).slice(0, 700)}`);
        });
        if (!cases.length) {
            if (/运行错误|超时|超时限制|段错误|runtime error|time limit/i.test(txt)) {
                const seg = (txt.match(/(运行错误|超时|段错误|内存)[\s\S]{0,300}/) || [''])[0];
                return '上次提交【运行/超时错误】：\n' + seg.trim().slice(0, 500) + '\n请修正后重新输出完整答案。';
            }
            return '上次提交未通过，但未取到具体差异。请重新审视题意与输出格式（注意空格/换行/精度）后再试。';
        }
        return `上次提交未通过。下面是各失败测试点「期望输出」对比「你的实际输出」，已把空白可视化：· =空格，⇥=制表符，⏎=每行行尾（看不到测试输入）：\n\n${cases.join('\n\n')}\n\n请严格逐字符对齐格式：每行的空格数与对齐方式（左/右对齐、字段宽度）、行尾是否有多余空格、空行、以及最后一行是否带换行，都必须与期望完全一致。${anyFmt ? '本题内容已正确，纯属格式/空白问题——务必精确复刻期望的空白布局（注意是右对齐还是左对齐、字段宽度、不要多余行尾空格、末尾换行有无）。' : ''}（· ⇥ ⏎ 只是可视标记，请输出真实的空格/制表符/换行，不要输出这些符号本身。）`;
    }

    /* ============================ 解一题（多版本 + 失败读样例） ============================ */
    const PROBLEM_BUDGET_MS = 900000; // 单题总预算默认值(15min)：仅作「是否再起新一版」的版间闸门，不挤压在途调用；可被配置页覆盖(cg_problem_budget)
    const CALL_TIMEOUT_MS = 360000;   // 单次调用超时默认值(6min)：给足长思考、与单题总时钟解耦，不再因总时钟将尽而秒杀正在产 token 的调用；可被配置页覆盖(cg_call_timeout)
    // v2.5.0：旧版鼓励「打表/逐例特判」匹配可见失败点 → 隐藏用例几乎必挂（难题正确率下降主因之一）。
    // 改为：用失败样例反推「通用规则/边界」写通解，并明确警告硬编码会在隐藏用例上失败。
    const SAMPLE_DIRECTIVE = '\n\n特别提示：你已多次未通过，很可能是**误解了题意或漏了边界条件**。请仔细对照上面各失败测试点的「输入 → 期望输出」，反推出题目真正的通用规则/边界，写出对所有情形都成立的**通解**。⚠️评测有大量隐藏测试用例，只硬编码/打表匹配上面这几个可见点，几乎必然在隐藏用例上失败——除非你**确信**本题就只有这有限几种情形，否则不要打表、不要逐例特判。只输出完整代码/JSON，不要解释。';
    // 版本计划：v1 直接解；v2 同对话同模型按样例纠错；v3「面向样例编程」；主模型连错≥3次后追加一版「升级强模型」(干净上下文+重置单题预算)
    function planFor(s) {
        const N = Math.max(1, +s.maxAttempts || 1), strong = s.strongModel || s.model;
        const plan = [];
        for (let i = 0; i < N; i++) {
            let mode = 'fix', model = s.model, thinking = s.thinking, temperature = 0.4;
            if (i === 0) { mode = 'normal'; temperature = 0; }
            else if (i === 2) { mode = 'sample'; } // 第3次：同对话、不换模型、面向样例
            plan.push({ model, thinking, temperature, mode, escalate: false });
        }
        // 主模型连错 N(≥3) 次后，追加一版升级强模型（不占主版本槽）：进入前重置单题时间预算 + 压成干净上下文
        if (N >= 3 && strong !== s.model)
            plan.push({ model: strong, thinking: true, temperature: 0, mode: 'escalate', escalate: true, resetBudget: true, compactBefore: true });
        return plan;
    }
    // 同题内上下文压缩：保留 base + 「最近两轮」(各版代码 + 失败反馈)，丢更早的累积。纯函数，可离线单测。
    // v2.5.0：旧版只留「最近一轮」→ 难题多版纠错时模型「失忆」、反复踩同一坑、只盯最近一批失败点
    //   （v2.4.0 起难题正确率下降的主因之一）。现保留最近两轮，让模型记得上一版试过什么、避免重复，仍显著省 token。
    function compactMessages(messages, problem) {
        const base = buildMessages(problem); // [system, user(题目)]，权威重建，不复用可能被污染的旧 system
        const tail = messages.slice(2);      // base 的 system/题目 之后的累积对话
        const asst = []; for (let j = 0; j < tail.length; j++) if (tail[j].role === 'assistant') asst.push(j);
        // 从倒数第 2 个 assistant 起保留 = 最近两轮(代码+反馈)；不足两轮则尽量多留
        const start = asst.length >= 2 ? asst[asst.length - 2] : (asst.length ? asst[0] : tail.length);
        const out = base.concat(tail.slice(start));
        // 保证以 user 结尾：末轮贴 deadline 时可能以 assistant 收尾，部分 reasoner 对 assistant 结尾 payload 返回 400
        if (out.length > base.length && out[out.length - 1].role === 'assistant')
            out.push({ role: 'user', content: '上次提交未通过，请修正后重新输出完整、可编译运行的答案。' });
        return out;
    }
    // 多版本：同对话累积「代码→错误样例→纠正代码→…」；每连错2次压缩上下文；连错≥3次后追加版换强模型(重置预算+干净上下文)
    async function solveProblem(kind, problem, ids, s, onAttempt) {
        const apiKey = getKey(), plan = planFor(s);
        const host = getBaseURL().replace(/^https?:\/\//, '');
        const problemBudgetMs = s.problemBudgetMs || PROBLEM_BUDGET_MS, callTimeoutMs = s.callTimeoutMs || CALL_TIMEOUT_MS;
        let messages = buildMessages(problem); // [system, user(题目)]，后续把每版回复与错误样例追加进同一对话（每连错2次压缩一次）
        const t0 = Date.now();
        let deadline = t0 + problemBudgetMs; // 升级强模型那版会重置为全新预算
        let best = null, baselineTime = '', timedOut = false, failStreak = 0;
        let activeI = -1, versionTokens = 0, versionBumps = 0, capRetried = false; // 自适应 max_tokens 同版重试状态(starved→翻倍 / capped→学习上限)
        try { baselineTime = submitTimeOf((parseVerdict(await fetchVerdict(ids.assignID, ids.problemID)) || {}).content); } catch (_) {}
        for (let i = 0; i < plan.length; i++) {
            const opt = plan[i];
            if (i !== activeI) { activeI = i; versionTokens = autoTokens(opt, s, capFor(host, opt.model)); versionBumps = 0; capRetried = false; } // 进入「新」版才初始化 token 预算；i-- 重试同版时保持不变
            if (opt.resetBudget) deadline = Date.now() + problemBudgetMs; // 升级强模型：重置单题时间预算（须先于下面的超时判定，否则被原余量误杀）
            if (deadline - Date.now() < 20000) { timedOut = true; break; } // 单题不足 20s 不再起新一版
            if (opt.compactBefore) messages = compactMessages(messages, problem); // 升级前压成干净上下文：题目+最近两轮代码与失败反馈
            onAttempt && onAttempt(i + 1, plan.length, opt);
            let res;
            try {
                LOG.push('info', `调用 ${opt.model}${opt.thinking ? '·思考' : ''}（第 ${i + 1}/${plan.length} 版·${MODE_CN[opt.mode] || opt.mode}·上限 ${fmtN(versionTokens)}tok）`);
                const raw = await callLLM(messages, { ...opt, maxTokens: versionTokens }, apiKey, callTimeoutMs, streamHooks()); // 固定单次超时(6min)，不被总时钟挤压
                clearTransientBanners();              // 拿到响应=连通且鉴权 OK，清掉连接/超时/卡住类提醒
                LOG.push('gen', `模型已出答案（${raw.length} 字）`);
                messages.push({ role: 'assistant', content: raw }); // 模型本版回复留在上下文里
                let display;
                if (kind === 'gap') {
                    const answers = parseGapAnswers(raw);
                    if (!Object.keys(answers).length) throw new Error('未解析出填空 JSON');
                    display = JSON.stringify(answers); await submitGap(ids, answers);
                } else {
                    const code = parseJavaCode(raw);
                    if (!/class\s+\w+/.test(code)) throw new Error('生成结果不是有效 Java');
                    const mainClass = (kind === 'iface' && problem.mainClass) ? problem.mainClass : detectMainClass(code);
                    display = code;
                    if (kind === 'ce') await submitCE(ids, code, mainClass);   // 在线编辑题走 cgsoucecode/byCE
                    else await submitFile(ids, code, mainClass);
                }
                LOG.push('info', '已提交，等待判题…');
                showNativeProgress(ids); // 恢复页面原生判题动画
                const v = await pollVerdict(ids.assignID, ids.problemID, baselineTime, deadline);
                baselineTime = submitTimeOf(v && v.content) || baselineTime;
                const sc = scoreOf(v && v.content || '');
                res = { ok: sc.total > 0 && sc.passed === sc.total, ...sc, display, verdict: v, attempt: i + 1 };
                LOG.push(res.ok ? 'ok' : 'warn', `判题：${res.ok ? '满分' : (sc.passed > 0 ? '部分通过' : '未通过')} ${sc.passed}/${sc.total}${sc.score ? ' · 得分 ' + sc.score : ''}`);
                if (!res.ok) failStreak++;
                if (!res.ok && i < plan.length - 1 && deadline - Date.now() > 15000) { // 失败反馈追加到同一对话
                    const ve = verdictError(v && v.content); // 编译/运行错误直接来自 verdict
                    let fb = ve ? `上次提交【${ve.type === 'compile' ? '编译错误' : '运行/超时错误'}】：\n${ve.text}\n请据此修正后重新输出完整、可编译运行的答案。`
                        : (feedbackFromHtml(await fetchFailDetail(ids.assignID, ids.problemID)) || '上次提交未通过，请仔细修正后重新输出完整答案。');
                    if (plan[i + 1] && plan[i + 1].mode === 'sample') fb += SAMPLE_DIRECTIVE; // 下一版起面向样例
                    messages.push({ role: 'user', content: fb });
                    if (failStreak % 2 === 0) messages = compactMessages(messages, problem); // 每连错2次压缩：只留题目+最近两轮代码与失败反馈
                }
            } catch (e) {
                // 思考耗尽 token 预算：加大 max_tokens 重试「本版」（不前进版本号、不计 failStreak、不触发压缩）
                if (e.kind === 'starved') {
                    const d = decideRetry('starved', versionTokens, versionBumps);
                    if (d.retry && deadline - Date.now() > 30000) {
                        versionTokens = d.tokens; versionBumps++;
                        LOG.push('warn', `思考耗尽 token 预算 → 自动加大 max_tokens 至 ${fmtN(versionTokens)} 重试本版`);
                        i--; continue;
                    }
                } else if (e.kind === 'capped' && !capRetried) { // 模型不支持该 max_tokens(400)：记住上限、钳回后重试本版一次
                    capRetried = true; setCap(host, opt.model, 8192); versionTokens = Math.min(versionTokens, 8192);
                    LOG.push('warn', `模型 ${opt.model} 不支持该 max_tokens，已记住上限 8192 并重试本版`);
                    i--; continue;
                }
                res = { ok: false, error: e.message, passed: 0, total: 0, score: null, attempt: i + 1 };
                LOG.push('err', `第 ${i + 1} 版失败：${e.message}`, e.extra); applyBanner(e);
                failStreak++;
                if (i < plan.length - 1 && messages[messages.length - 1].role === 'assistant') {
                    messages.push({ role: 'user', content: '上次输出有问题（' + e.message + '），请修正后重新给出完整答案。' });
                    if (failStreak % 2 === 0) messages = compactMessages(messages, problem);
                }
            }
            if (!best || (res.passed || 0) > (best.passed || 0)) best = res;
            if (res.ok) { best = res; break; }
        }
        if (!best) best = { ok: false, passed: 0, total: 0 };
        best.timedOut = timedOut && !best.ok;
        return best;
    }

    /* ============================ UI ============================ */
    let panel, fab, statusEl, titleEl, codeWrap, verdictEl, grindEl, btnSolve, btnGrind, busy = false, _tick = null;
    let bellEl, bellDot, logListEl, bannerWrap, _streamInfo = '', _streamProbed = false;

    function setStatus(text, kind, spin) { if (_tick) { clearInterval(_tick); _tick = null; } _streamInfo = ''; statusEl.onclick = null; statusEl.style.cursor = ''; statusEl.className = kind || ''; statusEl.innerHTML = (spin ? '<span class="cgai-spin"></span>' : '') + text; }
    function tickStatus(prefix, kind) {
        if (_tick) clearInterval(_tick);
        _streamInfo = '';
        const t0 = Date.now();
        const render = () => { statusEl.className = kind || 'busy'; statusEl.innerHTML = '<span class="cgai-spin"></span>' + prefix + (_streamInfo ? ' · ' + _streamInfo : '') + `（已用时 ${Math.round((Date.now() - t0) / 1000)}s）`; };
        render(); _tick = setInterval(render, 1000);
    }
    // 流式 hooks：把「思考中 N字 / 生成中 M字 / ⚠卡住」实时写进状态行；卡住时记一次日志+引导 banner（每段卡顿只记一次）
    function streamHooks() {
        let stalled = false;
        return {
            onProgress: ({ phase, reasoningLen, contentLen }) => { stalled = false; _streamInfo = phase === 'gen' ? `生成中 ${fmtN(contentLen)}字` : (phase === 'think' ? `思考中 ${fmtN(reasoningLen)}字` : '等待响应…'); },
            onStall: (secs, hadData, phase) => {
                const st = streamStallState(phase, secs);
                _streamInfo = st.info;
                if (!stalled) { stalled = true; LOG.push(st.level, st.log); if (st.banner) setBanner(st.banner); }
            },
            // 探针：首次调用后记录本管理器到底拿没拿到「中间文本」（真增量 vs 整段缓冲）——给真机实据，只记一次
            onStreamMode: (real, ticks) => {
                if (_streamProbed) return; _streamProbed = true;
                if (real) LOG.push('info', `流式探针：真增量流式生效（本次实时更新 ${ticks} 次，responseType:stream 已被管理器支持）`);
                else LOG.push('warn', '流式探针：本次未拿到中间文本，退化为整段返回（当前管理器可能不支持 responseType:stream；最终结果正确，仅缺逐字进度）');
            },
            // 服务端在流中已给正文又附带 error 事件：按已有正文继续，但记一条原始 error 防丢失归因
            onServerError: (errObj) => { LOG.push('warn', `服务端在流中报错但已有正文，按已有正文继续：${(errObj && (errObj.message || errObj.code)) || JSON.stringify(errObj)}`); },
        };
    }
    // 错误 .kind → 新手引导式 banner
    function applyBanner(e) {
        const k = e && e.kind;
        if (k === 'auth') setBanner('auth');
        else if (k === 'connect') setBanner('connect');
        else if (k === 'model') setBanner('model', e.message);
        else if (k === 'timeout') setBanner('timeout');
        else if (k === 'empty') setBanner('empty');
        else if (k === 'starved') setBanner('starved');
        else if (k === 'capped') setBanner('capped');
    }
    function showVerdictCard(html) { verdictEl.innerHTML = html ? '<div class="cgai-vcard">' + html + '</div>' : ''; }
    function verdictBadge(r) {
        if (r.skipped) return ICON.skip + '已满分，跳过';
        if (r.ok) return ICON.ok + `满分 · ${r.passed}/${r.total}` + (r.score ? ` · 得分 ${r.score}` : '');
        if (r.timedOut) return ICON.skip + `超时跳过(>${Math.round((settings().problemBudgetMs || PROBLEM_BUDGET_MS) / 1000)}s)` + ((r.passed || 0) > 0 ? ` · 最好 ${r.passed}/${r.total}` : '');
        if ((r.passed || 0) > 0) return ICON.warn + `部分通过 ${r.passed}/${r.total}` + (r.score ? ` · 得分 ${r.score}` : '');
        return ICON.err + (r.error ? '失败：' + r.error : '未通过');
    }
    const KIND_CN = { file: '编程题', ce: '编程题(在线编辑)', iface: '接口题', gap: '填空题' };
    const MODE_CN = { normal: '直接解', fix: '纠错', sample: '面向样例', escalate: '升级强模型' };

    async function runSolveCurrent() {
        if (busy) return; busy = true;
        verdictEl.innerHTML = ''; codeWrap.style.display = 'none';
        try {
            btnSolve.disabled = true; btnGrind.disabled = true;
            if (!ensureConfig()) return; const apiKey = getKey();
            const kind = pageType();
            if (!kind) { setStatus('当前不是题目页，无法解题（可用「一键开刷全部」）。', 'err'); return; }
            const s = settings();
            setStatus('正在提取题目…', 'busy', true);
            const problem = extractFor(kind), ids = extractIds(kind);
            titleEl.innerHTML = ICON.file + `<span>[${KIND_CN[kind]}] ` + esc(problem.title) + '</span>';
            LOG.push('info', `解本题 [${KIND_CN[kind]}] ${problem.title}`);
            if (!ids.problemID || !ids.assignID) { setStatus('未能解析 problemID/assignID。', 'err'); return; }
            if (kind === 'gap' && !problem.gaps) { setStatus('未识别到填空空位。', 'err'); return; }
            if (kind !== 'gap' && (!problem.statement || problem.statement.length < 5)) { setStatus('未能提取题面。', 'err'); return; }

            if (!s.autoSubmit && kind !== 'gap') {
                tickStatus(`正在调用 ${s.model} 生成代码…`);
                LOG.push('info', `调用 ${s.model}（仅生成，不自动提交）`);
                const code = parseJavaCode(await callLLM(buildMessages(problem), { model: s.model, thinking: s.thinking, temperature: 0, maxTokens: autoTokens({ thinking: s.thinking }, s, capFor(getBaseURL().replace(/^https?:\/\//, ''), s.model)) }, apiKey, s.callTimeoutMs || CALL_TIMEOUT_MS, streamHooks()));
                clearTransientBanners();
                const mc = (kind === 'iface' && problem.mainClass) ? problem.mainClass : detectMainClass(code); fillOnly(code, mc);
                codeWrap.querySelector('.cgai-code').textContent = code;
                codeWrap.querySelector('summary').textContent = `生成代码 · 主类 ${mc}`; codeWrap.style.display = 'block';
                setStatus(`代码已生成并填入（主类 ${mc}）。已关闭自动提交——请检查后手动点"提 交"。`, 'ok'); return;
            }
            const r = await solveProblem(kind, problem, ids, s, (i, n, opt) => tickStatus(`第 ${i}/${n} 版${opt.mode === 'escalate' ? '·升级强模型' : opt.mode === 'sample' ? '·面向样例编程' : (i > 1 ? '·按错误样例纠错' : '')}（${opt.model}${opt.thinking ? '·思考' : ''}）生成提交中…`));
            if (r.display) { codeWrap.querySelector('.cgai-code').textContent = r.display; codeWrap.querySelector('summary').textContent = `生成答案 · 第 ${r.attempt} 版`; codeWrap.style.display = 'block'; }
            setStatus(verdictBadge(r), r.ok ? 'ok' : ((r.passed || 0) > 0 ? 'busy' : 'err'));
            showVerdictCard(r.verdict && r.verdict.content);
        } catch (e) { setStatus('出错：' + (e.message || e), 'err'); LOG.push('err', '解题出错：' + (e.message || e), e && e.extra); applyBanner(e); }
        finally { busy = false; btnSolve.disabled = !isProblemPage(); btnGrind.disabled = false; }
    }
    // problemID/assignID（各题型一致：iframe src 或页面内联）
    function extractIds() {
        let problemID = '', assignID = '';
        const fr = document.getElementById('showmessageFRAME') || document.getElementById('showmessageFrame');
        const src = fr ? (fr.getAttribute('src') || '') : '';
        let m = src.match(/problemID=(\d+)/); if (m) problemID = m[1];
        m = src.match(/assignID=(\d+)/); if (m) assignID = m[1];
        if (!assignID) { m = location.search.match(/assignID=(\d+)/); if (m) assignID = m[1]; }
        if (!problemID) { m = document.body.innerHTML.match(/problemID["'=\s]+(\d+)/); if (m) problemID = m[1]; }
        return { problemID, assignID };
    }

    /* ---- 开刷：跨页状态机（队列已校验+排序） ---- */
    // 队列项唯一键含页型（同 assign 跨题型 proNum 会重复）
    const itemKey = it => it.assignID + '|' + it.page + '|' + it.proNum;
    const TAG = pg => /FillGap/i.test(pg) ? '填' : /Interface/i.test(pg) ? '接' : '编';
    // 队列里 programList.jsp 的题可能 302 跳到 programList_ce.jsp（同一题两种 URL），匹配当前页时视作同一页型
    const pageEq = (a, b) => String(a).replace(/_ce(?=\.jsp)/i, '') === String(b).replace(/_ce(?=\.jsp)/i, '');
    function navTo(it) { const extra = /_ce\.jsp/i.test(it.page) ? '&libCenter=false' : ''; location.assign(`/assignment/${it.page}?proNum=${it.proNum}&assignID=${it.assignID}${extra}`); }
    async function startGrind() {
        if (!ensureConfig()) return;
        tickStatus('正在读取作业列表并校验题目链接…');
        let queue; try { queue = await buildQueue(); } catch (e) { setStatus('读取作业列表失败：' + e.message, 'err'); LOG.push('err', '读取作业列表失败：' + e.message); return; }
        if (!queue || !queue.length) { setStatus('未发现任何题目链接（请确认已登录且已进入该课程）。', 'err'); LOG.push('warn', '未发现任何题目链接（是否已登录/进入课程？）'); return; }
        LOG.push('info', `开刷启动：共 ${queue.length} 题`);
        setGrind({ active: true, queue, done: {}, navs: 0, startedAt: Date.now(), settings: settings() });
        renderGrind(); refreshButtons();
        navTo(queue[0]);
    }
    function stopGrind() { const g = getGrind(); if (g) { g.active = false; setGrind(g); } renderGrind(); setStatus('已停止开刷。', ''); refreshButtons(); }
    function finishGrind(g) { g.active = false; setGrind(g); renderGrind(); const done = Object.values(g.done); const full = done.filter(r => r.ok || r.skipped).length; setStatus(ICON.ok + `开刷完成！满分 ${full}/${done.length} 题。`, 'ok'); refreshButtons(); }
    function renderGrind() {
        const g = getGrind(); if (!g || !g.queue) { grindEl.innerHTML = ''; return; }
        const cur = getCur(), curPage = PAGE_OF[pageType()] || '';
        let rows = '', full = 0;
        g.queue.forEach(it => {
            const k = itemKey(it), r = g.done[k];
            const isCur = it.assignID === cur.assignID && pageEq(it.page, curPage) && String(it.proNum) === String(cur.proNum);
            let cls = '', ic = '', sc = '';
            if (r) {
                if (r.ok || r.skipped) full++;
                cls = r.skipped ? 'skip' : (r.ok ? 'ok' : 'fail');
                ic = r.skipped ? ICON.skip : (r.ok ? ICON.ok : (r.timedOut ? ICON.skip : ICON.warn));
                sc = r.skipped ? '跳过' : (r.timedOut ? '超时' : (r.total ? `${r.passed}/${r.total}` : (r.error ? '失败' : '—')));
            } else if (isCur && g.active && busy) { cls = 'cur'; ic = '<span class="cgai-spin"></span>'; sc = ''; }
            else { ic = ''; sc = '待办'; }
            rows += `<div class="cgai-grow ${cls}${isCur ? ' cur' : ''}"><span>${ic}</span><span class="gk">${it.assignID}${TAG(it.page)}:${it.proNum}</span><span class="gt">${esc((r && r.title) || '')}</span><span class="gs">${sc}</span></div>`;
        });
        grindEl.innerHTML = `<div class="cgai-ghead"><span>${g.active ? '开刷进行中' : '开刷已停止'} · ${g.queue.length} 题</span><span>满分 ${full}/${g.queue.length}</span></div><div class="cgai-glist">${rows}</div>`;
    }
    async function grindStep() {
        const g = getGrind(); if (!g || !g.active) return;
        if (busy) return; busy = true; refreshButtons();
        try {
            const cur = getCur(), kind = pageType(), curPage = PAGE_OF[kind] || '';
            const qi = g.queue.findIndex(it => it.assignID === cur.assignID && pageEq(it.page, curPage) && String(it.proNum) === String(cur.proNum));
            if (qi < 0) { const nxt = g.queue.find(it => !g.done[itemKey(it)]); if (nxt) navTo(nxt); else finishGrind(g); return; }
            const item = g.queue[qi], k = itemKey(item), klabel = `${item.assignID}${TAG(item.page)}:${item.proNum}`, s = g.settings || settings();
            if (!g.done[k]) {
                const problem = extractFor(kind), ids = extractIds();
                titleEl.innerHTML = ICON.file + `<span>[${KIND_CN[kind]}] ` + esc(problem.title) + '</span>';
                renderGrind();
                let r;
                if (s.skipPassed) { const pv = parseVerdict(await fetchVerdict(ids.assignID, ids.problemID)); const sc = scoreOf(pv && pv.content || ''); if (sc.total > 0 && sc.passed === sc.total) r = { skipped: true, ...sc, title: problem.title }; }
                if (!r) {
                    const res = await solveProblem(kind, problem, ids, s, (i, n, opt) => tickStatus(`开刷 ${klabel}·第 ${i}/${n} 版${opt.mode === 'escalate' ? '·升级' : opt.mode === 'sample' ? '·面向样例' : (i > 1 ? '·纠错' : '')}（${opt.model}${opt.thinking ? '·思考' : ''}）…`));
                    r = { ok: res.ok, passed: res.passed, total: res.total, score: res.score, error: res.error, timedOut: res.timedOut, attempt: res.attempt, title: problem.title };
                    if (res.verdict) showVerdictCard(res.verdict.content);
                }
                g.done[k] = r; setGrind(g); renderGrind();
            }
            const next = g.queue.slice(qi + 1).find(it => !g.done[itemKey(it)]);
            g.navs = (g.navs || 0) + 1;
            if (next && g.navs < 300) {
                setGrind(g); let left = 3;
                const nlabel = `${next.assignID}${TAG(next.page)}:${next.proNum}`;
                const tip = () => setStatus(`${klabel} 完成。${left}s 后跳转 ${nlabel}…（点"停止开刷"可中断）`, 'busy');
                tip();
                const timer = setInterval(() => { const gg = getGrind(); if (!gg || !gg.active) { clearInterval(timer); return; } if (--left <= 0) { clearInterval(timer); navTo(next); } else tip(); }, 1000);
            } else finishGrind(g);
        } catch (e) { setStatus('开刷出错：' + (e.message || e), 'err'); LOG.push('err', '开刷出错：' + (e.message || e), e && e.extra); applyBanner(e); }
        finally { busy = false; refreshButtons(); }
    }
    function refreshButtons() {
        const g = getGrind(), grinding = !!(g && g.active);
        btnSolve.disabled = busy || !isProblemPage();
        if (grinding) { btnGrind.className = 'cgai-btn cgai-btn-danger'; btnGrind.innerHTML = ICON.stop + '<span>停止开刷</span>'; btnGrind.onclick = stopGrind; btnGrind.disabled = false; }
        else { btnGrind.className = 'cgai-btn cgai-btn-ghost'; btnGrind.innerHTML = ICON.grind + '<span>一键开刷全部</span>'; btnGrind.onclick = startGrind; btnGrind.disabled = busy; }
    }

    /* ---- 配置页 ---- */
    function updateModelTxt() { const t = panel && panel.querySelector('#cgai-modeltxt'); if (t) t.textContent = settings().model || '设置模型'; }
    const OTHER = '__other__';
    function getModelsCache() { try { return JSON.parse(GM_getValue(STORE.MODELS_CACHE, '') || '[]'); } catch (_) { return []; } }
    function modelOptions() { const c = settings(); return [...new Set([...getModelsCache(), ...MODEL_SUGGEST, c.model, c.strongModel].filter(Boolean))]; }
    function fillModelSelect(sel, inp, value) {
        const list = modelOptions(), inList = list.includes(value);
        sel.innerHTML = '';
        [...list, OTHER].forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m === OTHER ? '其他 / 自定义…' : m; sel.appendChild(o); });
        sel.value = inList ? value : (value ? OTHER : list[0]);
        inp.value = inList ? '' : (value || '');
        inp.style.display = sel.value === OTHER ? 'block' : 'none';
    }
    function syncCustom(sel, inp) { inp.style.display = sel.value === OTHER ? 'block' : 'none'; if (sel.value === OTHER) inp.focus(); }
    function populateModelSelects() {
        fillModelSelect(panel.querySelector('#cfg-model'), panel.querySelector('#cfg-model-c'), settings().model);
        fillModelSelect(panel.querySelector('#cfg-strong'), panel.querySelector('#cfg-strong-c'), settings().strongModel);
    }
    function cfgMsg(t, ok) { const e = panel.querySelector('#cfg-msg'); if (e) { e.textContent = t; e.style.color = ok ? 'var(--cg-ok-fg)' : 'var(--cg-faint)'; } }
    function fetchModels() {
        const base = (panel.querySelector('#cfg-base').value.trim().replace(/\/+$/, '') || DEFAULTS.baseURL);
        const key = panel.querySelector('#cfg-key').value.trim();
        cfgMsg('正在拉取模型列表…');
        GM_xmlhttpRequest({
            method: 'GET', url: base + '/models', responseType: 'text', timeout: 20000,
            headers: { 'Authorization': 'Bearer ' + key },
            onload: r => {
                let ids = [];
                try { const d = JSON.parse(r.responseText); ids = (d.data || d.models || []).map(m => (typeof m === 'string' ? m : m.id)).filter(Boolean); } catch (_) {}
                if (ids.length) { GM_setValue(STORE.MODELS_CACHE, JSON.stringify(ids)); populateModelSelects(); cfgMsg(`已拉取 ${ids.length} 个模型，可在下拉里选`, true); }
                else cfgMsg(`未拉到模型（HTTP ${r.status}；确认 Base URL 是否带 /v1、Key 是否正确）`);
            },
            onerror: () => cfgMsg('拉取失败（检查 Base URL/Key，或脚本猫是否允许该域名跨域）'),
            ontimeout: () => cfgMsg('拉取超时'),
        });
    }
    function showOnboarding() {
        const a = panel.querySelector('#cgai-arrow'), g = panel.querySelector('#cgai-cfg');
        if (a) a.classList.add('show'); if (g) g.classList.add('cgai-attn');
        setBanner('noKey');
        setStatus('还没配置 API Key —— 点右上角齿轮（或上方蓝色箭头）开始，支持 GPT / DeepSeek。', 'busy');
        statusEl.style.cursor = 'pointer'; statusEl.onclick = openConfig;
    }
    function clearOnboarding() {
        const a = panel.querySelector('#cgai-arrow'), g = panel.querySelector('#cgai-cfg');
        if (a) a.classList.remove('show'); if (g) g.classList.remove('cgai-attn');
        clearBanner('noKey');
    }
    /* ---- 日志 / 诊断浮层 ---- */
    function bannerHtml(kind, info) {
        const d = BANNER_DEFS[kind]; if (!d) return '';
        const cls = d.lvl === 'err' ? 'err' : 'warn', ic = d.lvl === 'err' ? ICON.err : ICON.warn;
        return `<div class="cgai-banner ${cls}"><span class="bi">${ic}</span><div class="bc"><b>${esc(d.title)}</b><div>${esc(d.body)}</div>` +
            `${info && info.extra ? `<div class="bx">${esc(info.extra)}</div>` : ''}<button class="cgai-mini bgo" data-go="${d.go}">${esc(d.act)} →</button></div></div>`;
    }
    function renderLog() {
        if (!logListEl) return;
        if (bannerWrap) {
            bannerWrap.innerHTML = Object.keys(activeBanners).map(k => bannerHtml(k, activeBanners[k])).join('');
            bannerWrap.querySelectorAll('.bgo').forEach(b => b.onclick = () => { if (b.getAttribute('data-go') === 'config') { closeLog(); openConfig(); } });
        }
        logListEl.innerHTML = LOG.buf.map(e =>
            `<div class="cgai-logrow ${e.level}"><span class="lt">${hhmmss(e.t)}</span><span class="li">${LEVELS[e.level] || '·'}</span>` +
            `<span class="lm">${esc(e.msg)}${e.detail ? `<span class="ld">${esc(e.detail)}</span>` : ''}</span></div>`
        ).join('') || '<div class="cgai-empty">暂无日志。开始解题后这里会逐步记录「调用模型 / 思考 / 生成 / 提交 / 判题」，卡住或报错也会在此说明，方便定位排查。</div>';
        if (panel && panel.querySelector('#cgai-log').classList.contains('open')) logListEl.scrollTop = logListEl.scrollHeight;
    }
    function openLog() {
        const a = panel.querySelector('#cgai-arrow'); if (a) a.classList.remove('show');
        unseen = 0; updateBell(); if (bellEl) bellEl.classList.remove('cgai-attn');
        renderLog();
        panel.querySelector('#cgai-log').classList.add('open');
        logListEl.scrollTop = logListEl.scrollHeight;
    }
    function closeLog() { panel.querySelector('#cgai-log').classList.remove('open'); }
    // 一键复制诊断（隐藏 API Key）：服务商 host / 模型 / UA / 最近事件 —— 直接贴进 issue 即可定位
    function copyDiagnostics() {
        const s = settings(), host = getBaseURL().replace(/^https?:\/\//, '');
        const head = [
            `飞跃·解题 Solver v${VERSION} 诊断日志`,
            `时间: ${new Date().toLocaleString()}`,
            `页面: ${location.pathname}${location.search}`,
            `服务商(host): ${host}    （API Key 已隐藏，不会被复制）`,
            `主模型: ${s.model}  强模型: ${s.strongModel || '-'}  思考: ${s.thinking ? '开' : '关'}`,
            `重试次数: ${s.maxAttempts}  自动提交: ${s.autoSubmit ? '开' : '关'}  跳过已满分: ${s.skipPassed ? '开' : '关'}`,
            `UA: ${navigator.userAgent}`,
            '--- 最近事件（旧 → 新）---',
        ];
        const rows = LOG.buf.map(e => `[${hhmmss(e.t)}] ${LEVELS[e.level] || ''} ${e.msg}${e.detail ? '\n      ' + String(e.detail).replace(/\n/g, '\n      ') : ''}`);
        const text = head.concat(rows).join('\n');
        try { GM_setClipboard(text); } catch (_) { try { navigator.clipboard.writeText(text); } catch (__) {} }
        const sp = panel.querySelector('#log-copy span'); if (sp) { const o = sp.textContent; sp.textContent = '已复制 ✓'; setTimeout(() => { sp.textContent = o; }, 1500); }
    }
    function openConfig() {
        const a = panel.querySelector('#cgai-arrow'); if (a) a.classList.remove('show'); // 配置打开时藏箭头（避免盖在浮层上）
        panel.querySelector('#cfg-base').value = getBaseURL();
        panel.querySelector('#cfg-key').value = getKey();
        panel.querySelector('#cfg-maxtokens').value = (+GM_getValue(STORE.MAX_TOKENS, 0)) || '';
        panel.querySelector('#cfg-calltimeout').value = (+GM_getValue(STORE.CALL_TIMEOUT, 0)) || '';
        panel.querySelector('#cfg-budget').value = (+GM_getValue(STORE.PROBLEM_BUDGET, 0)) || '';
        populateModelSelects();
        cfgMsg('');
        panel.querySelector('#cgai-config').classList.add('open');
        setTimeout(() => panel.querySelector(getKey() ? '#cfg-base' : '#cfg-key').focus(), 30);
    }
    function closeConfig() { panel.querySelector('#cgai-config').classList.remove('open'); if (!getKey()) showOnboarding(); }
    function pickModel(selId, inpId, fallback) { const s = panel.querySelector(selId), i = panel.querySelector(inpId); return (s.value === OTHER ? i.value.trim() : s.value) || fallback; }
    function saveConfig() {
        GM_setValue(STORE.BASE_URL, panel.querySelector('#cfg-base').value.trim().replace(/\/+$/, '') || DEFAULTS.baseURL);
        GM_setValue(STORE.KEY, panel.querySelector('#cfg-key').value.trim());
        GM_setValue(STORE.MODEL, pickModel('#cfg-model', '#cfg-model-c', DEFAULTS.model));
        GM_setValue(STORE.STRONG_MODEL, pickModel('#cfg-strong', '#cfg-strong-c', ''));
        GM_setValue(STORE.MAX_TOKENS, Math.max(0, Math.floor(+panel.querySelector('#cfg-maxtokens').value || 0)));
        GM_setValue(STORE.CALL_TIMEOUT, Math.max(0, Math.floor(+panel.querySelector('#cfg-calltimeout').value || 0)));
        GM_setValue(STORE.PROBLEM_BUDGET, Math.max(0, Math.floor(+panel.querySelector('#cfg-budget').value || 0)));
        updateModelTxt(); closeConfig();
        if (getKey()) { clearOnboarding(); setStatus('配置已保存。', 'ok'); }
        else setStatus('已保存，但 API Key 仍为空——请点齿轮填入。', 'err');
    }
    function ensureConfig() { if (getKey()) return true; openConfig(); setStatus('请先在配置页填写 API Key 再使用。', 'busy'); return false; }

    function buildPanel() {
        panel = document.createElement('div'); panel.id = 'cgai-panel';
        panel.innerHTML = `
            <div id="cgai-head">
                <div class="cgai-brand"><span class="cgai-badge">${ICON.brand}</span>
                    <span class="cgai-titles"><b>飞跃·解题 Solver</b><i>DeepSeek 自动解题 · 开刷</i></span></div>
                <span class="cgai-tools"><span class="cgai-ic" id="cgai-bell" title="日志 / 诊断（卡了？报错？看这里）">${ICON.bell}<span class="cgai-dot" id="cgai-belldot">0</span></span>
                    <span class="cgai-ic" id="cgai-cfg" title="配置">${ICON.settings}</span>
                    <span class="cgai-ic" id="cgai-min" title="收起">${ICON.minus}</span></span>
            </div>
            <div id="cgai-body">
                <div class="cgai-settings">
                    <button class="cgai-model" id="cgai-modelbtn" title="打开配置（Base URL / Key / 模型）">${ICON.settings}<span id="cgai-modeltxt">模型</span></button>
                    <label class="cgai-chk"><input type="checkbox" id="cgai-think"> 思考模式</label>
                    <label class="cgai-chk"><input type="checkbox" id="cgai-auto"> 自动提交</label>
                    <label class="cgai-chk"><input type="checkbox" id="cgai-skip"> 跳过已满分</label>
                    <label class="f">重试次数 <input type="number" id="cgai-att" min="1" max="5"></label>
                </div>
                <div class="cgai-btns">
                    <button class="cgai-btn cgai-btn-primary" id="cgai-solve">${ICON.run}<span>解本题</span></button>
                    <button class="cgai-btn cgai-btn-ghost" id="cgai-grindbtn">${ICON.grind}<span>一键开刷全部</span></button>
                </div>
                <div id="cgai-title"></div>
                <div id="cgai-status"></div>
                <div id="cgai-grind"></div>
                <details class="cgai-sec" id="cgai-codewrap" style="display:none"><summary>生成答案</summary><pre class="cgai-code"></pre></details>
                <div id="cgai-verdict"></div>
            </div>
            <div id="cgai-config">
                <div class="cfg-head"><div><b>配置</b> <span class="sub">OpenAI 兼容</span></div><span class="cgai-ic" id="cfg-x" title="关闭">${ICON.minus}</span></div>
                <div class="cfg-body">
                    <div class="cgai-field"><label>API Base URL</label><input id="cfg-base" type="text" spellcheck="false" placeholder="https://aiapis.help/v1"><span class="hint">调用 &lt;BaseURL&gt;/chat/completions 与 /models；可换任意 OpenAI 兼容服务（GPT 代理一般要带 /v1，如 https://aiapis.help/v1；DeepSeek 时才发送 thinking 参数）。</span></div>
                    <div class="cgai-field"><label>API Key</label><input id="cfg-key" type="password" spellcheck="false" placeholder="sk-...">
                        <span class="hint">没有 Key？去获取：<a href="https://aiapis.help/console" target="_blank" rel="noopener">GPT 系 (aiapis.help/console)</a> · <a href="https://platform.deepseek.com" target="_blank" rel="noopener">DeepSeek 系 (platform.deepseek.com)</a></span></div>
                    <div class="cgai-field"><label>主模型 <button class="cgai-mini" id="cfg-fetch" type="button">${ICON.refresh}刷新模型列表</button></label>
                        <select id="cfg-model"></select><input id="cfg-model-c" type="text" spellcheck="false" placeholder="自定义模型名" style="display:none">
                        <span class="hint" id="cfg-msg"></span></div>
                    <div class="cgai-field"><label>重试强模型（可选，失败时升级用）</label>
                        <select id="cfg-strong"></select><input id="cfg-strong-c" type="text" spellcheck="false" placeholder="自定义模型名（留空=不升级）" style="display:none">
                        <span class="hint">主模型连错 3 次以上才会调用（需"重试次数"≥3）。换强模型那版会重置单题时间预算，给思考型模型充足时间。</span></div>
                    <div class="cgai-field"><label>高级：思考预算 / 超时（留空=自动）</label>
                        <div style="display:flex;gap:6px">
                            <input id="cfg-maxtokens" type="number" min="0" spellcheck="false" placeholder="max_tokens 自动" style="flex:1;min-width:0">
                            <input id="cfg-calltimeout" type="number" min="0" spellcheck="false" placeholder="单次超时s 默认360" style="flex:1;min-width:0">
                            <input id="cfg-budget" type="number" min="0" spellcheck="false" placeholder="单题预算s 默认900" style="flex:1;min-width:0">
                        </div>
                        <span class="hint">思考模型把 max_tokens 大量用于推理：留空时思考模式自动给 32768、普通 8192，不够会自动加大重试。单次超时给足长思考（默认 6 分钟），不再被单题总时钟秒杀；单题预算是"是否再起新一版"的总闸门（默认 15 分钟）。</span></div>
                </div>
                <div class="cgai-btns"><button class="cgai-btn cgai-btn-primary" id="cfg-save">保存</button><button class="cgai-btn cgai-btn-ghost" id="cfg-cancel">取消</button></div>
            </div>
            <div id="cgai-log">
                <div class="cfg-head"><div><b>日志 / 诊断</b> <span class="sub">记录每一步 · 卡住/报错有说明 · 可一键复制诊断日志</span></div><span class="cgai-ic" id="log-x" title="关闭">${ICON.minus}</span></div>
                <div id="cgai-banners"></div>
                <div id="cgai-loglist"></div>
                <div class="cgai-btns" style="margin-top:11px"><button class="cgai-btn cgai-btn-primary" id="log-copy">${ICON.copy}<span>复制诊断日志</span></button><button class="cgai-btn cgai-btn-ghost" id="log-clear" title="清空日志" style="flex:0 0 auto">${ICON.trash}</button></div>
            </div>`;
        const arrow = document.createElement('div'); arrow.id = 'cgai-arrow';
        arrow.innerHTML = ICON.arrowUp + '<span>首次使用：点这里或右上角齿轮，配置 API Key</span>';
        panel.appendChild(arrow); // 作为 #cgai-panel 的子节点，绝对定位指向右上角齿轮
        document.body.appendChild(panel);
        arrow.onclick = openConfig;
        fab = document.createElement('div'); fab.id = 'cgai-fab'; fab.innerHTML = ICON.brand + '<span>飞跃·解题</span>'; document.body.appendChild(fab);

        statusEl = panel.querySelector('#cgai-status'); titleEl = panel.querySelector('#cgai-title');
        codeWrap = panel.querySelector('#cgai-codewrap'); verdictEl = panel.querySelector('#cgai-verdict');
        grindEl = panel.querySelector('#cgai-grind'); btnSolve = panel.querySelector('#cgai-solve'); btnGrind = panel.querySelector('#cgai-grindbtn');
        bellEl = panel.querySelector('#cgai-bell'); bellDot = panel.querySelector('#cgai-belldot');
        logListEl = panel.querySelector('#cgai-loglist'); bannerWrap = panel.querySelector('#cgai-banners');

        const s = settings();
        const think = panel.querySelector('#cgai-think'); think.checked = s.thinking;
        const auto = panel.querySelector('#cgai-auto'); auto.checked = s.autoSubmit;
        const skip = panel.querySelector('#cgai-skip'); skip.checked = s.skipPassed;
        const att = panel.querySelector('#cgai-att'); att.value = s.maxAttempts;
        think.onchange = () => GM_setValue(STORE.THINKING, think.checked);
        auto.onchange = () => GM_setValue(STORE.AUTO_SUBMIT, auto.checked);
        skip.onchange = () => GM_setValue(STORE.SKIP_PASSED, skip.checked);
        att.onchange = () => GM_setValue(STORE.MAX_ATTEMPTS, Math.min(5, Math.max(1, +att.value || 3)));
        updateModelTxt();
        btnSolve.onclick = runSolveCurrent;
        panel.querySelector('#cgai-cfg').onclick = openConfig;
        panel.querySelector('#cgai-modelbtn').onclick = openConfig;
        panel.querySelector('#cfg-x').onclick = closeConfig;
        panel.querySelector('#cfg-cancel').onclick = closeConfig;
        panel.querySelector('#cfg-save').onclick = saveConfig;
        panel.querySelector('#cfg-fetch').onclick = fetchModels;
        panel.querySelector('#cfg-model').onchange = e => syncCustom(e.target, panel.querySelector('#cfg-model-c'));
        panel.querySelector('#cfg-strong').onchange = e => syncCustom(e.target, panel.querySelector('#cfg-strong-c'));
        panel.querySelector('#cgai-min').onclick = () => { panel.style.display = 'none'; fab.style.display = 'flex'; };
        fab.onclick = () => { panel.style.display = 'flex'; fab.style.display = 'none'; };
        panel.querySelector('#cgai-bell').onclick = openLog;
        panel.querySelector('#log-x').onclick = closeLog;
        panel.querySelector('#log-copy').onclick = copyDiagnostics;
        panel.querySelector('#log-clear').onclick = () => { LOG.clear(); };
        makeDraggable(panel, panel.querySelector('#cgai-head'));

        updateBell(); renderLog();
        refreshButtons(); renderGrind();
        if (!getKey()) showOnboarding();
        else { const k = pageType(); setStatus(k ? `当前：${KIND_CN[k]}。点"解本题"或"一键开刷全部"。` : '任意页可"一键开刷全部"（会先读取作业列表）。', ''); }
    }
    function makeDraggable(el, handle) {
        let sx, sy, ox, oy, drag = false;
        handle.addEventListener('mousedown', e => { drag = true; sx = e.clientX; sy = e.clientY; const r = el.getBoundingClientRect(); ox = r.left; oy = r.top; el.style.right = 'auto'; el.style.bottom = 'auto'; el.style.left = ox + 'px'; el.style.top = oy + 'px'; e.preventDefault(); });
        document.addEventListener('mousemove', e => { if (!drag) return; el.style.left = (ox + e.clientX - sx) + 'px'; el.style.top = (oy + e.clientY - sy) + 'px'; });
        document.addEventListener('mouseup', () => drag = false);
    }

    GM_registerMenuCommand('配置 (Base URL / API Key / 模型)', () => { if (panel) openConfig(); });
    GM_registerMenuCommand('日志 / 诊断（卡住/报错看这里）', () => { if (panel) { if (panel.style.display === 'none') { panel.style.display = 'flex'; if (fab) fab.style.display = 'none'; } openLog(); } });
    GM_registerMenuCommand('停止开刷 / 清除进度', () => { clearGrind(); if (grindEl) renderGrind(); if (statusEl) setStatus('已清除开刷进度。', ''); if (btnGrind) refreshButtons(); });

    if (typeof window !== 'undefined' && window.__CGAI_EXPOSE__) {
        window.__CGAI_API__ = { htmlToText, titleOf, extractStatement, extractGap, extractFor, extractIds, getCur, pageType, discoverAssignList, discoverCourseID, parseAssignProblems, fetchAssignProblems, buildQueue, itemKey, parseJavaCode, detectMainClass, parseGapAnswers, parseVerdict, submitTimeOf, scoreOf, verdictError, feedbackFromHtml, buildMessages, compactMessages, planFor, parseSSE, streamStallState, callLLM, getBaseURL, autoTokens, decideRetry };
    }

    function boot() {
        LOG.load();
        buildPanel();
        const g = getGrind();
        if (g && g.active && isProblemPage()) setTimeout(grindStep, 1300);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
