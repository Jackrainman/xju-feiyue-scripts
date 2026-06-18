// ==UserScript==
// @name         飞跃·刷课 Grinder
// @namespace    https://feiyue.selab.top/feiyue-grinder
// @version      2.10.0
// @updateURL    https://feiyue.selab.top/feiyue-grinder.user.js
// @downloadURL  https://feiyue.selab.top/feiyue-grinder.user.js
// @description  三合一全自动:视频(自动播,倍速/静音可调)+课件(滚动翻完每一页)+随堂测验(AI答题 GPT5.5/DeepSeek 可切,AI优先+题库兜底)。面板置于顶层窗口可任意拖动,引擎跑在课程 iframe 内,经 postMessage 通信。UI 全 SVG(无 emoji)。登录(短信验证码)用华为原生界面手动完成。API Key 仅存本地(GM)。
// @author       winbeau
// @match        https://talent.shixizhi.huawei.com/*
// @match        https://*.shixizhi.huawei.com/*
// @match        https://e.huawei.com/*
// @connect      aiapis.help
// @connect      api.deepseek.com
// @connect      api.openai.com
// @connect      self
// @connect      feiyue.selab.top
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';
  const W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const HOST = location.hostname, PATH = location.pathname;
  const IS_TOP = window.top === window.self;
  const IS_SHIXIZHI = /shixizhi\.huawei\.com$/.test(HOST);
  const IS_VIEWER = /\/edm3client\/|\/preview|\/static\/index\.html/i.test(PATH); // 课件文档查看器子帧

  /* ===================== 配置(GM 跨帧共享) ===================== */
  const PROVIDERS = {
    gpt:      { label: 'GPT-5.5 (aiapis.help)', baseURL: 'https://aiapis.help/v1', model: 'gpt-5.5' },
    deepseek: { label: 'DeepSeek-V4 (官方)',    baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
    custom:   { label: '自定义 OpenAI 兼容',     baseURL: '', model: '' },
  };
  const MODEL_SUGGEST = ['gpt-5.5', 'deepseek-v4-flash', 'deepseek-v4-pro'];
  const MODELS_CACHE_K = 'sxz_models_cache';
  const DEF = { provider: 'deepseek', keys: {}, baseURL: '', model: '', thinking: false,
    rate: 1, mute: true, autoNext: true, cwDwellSec: 8, quizAuto: true, answerSource: 'ai_bank', quizRetryMax: 2, autoFinalTest: false, antiIdle: true, force: false };
  const K = 'sxz_cfg_v2';
  function loadCfg() { try { return Object.assign({}, DEF, JSON.parse(GM_getValue(K, '{}'))); } catch (e) { return Object.assign({}, DEF); } }
  function saveCfg() { GM_setValue(K, JSON.stringify(CFG)); }
  let CFG = loadCfg();
  let BANK = {}; try { BANK = JSON.parse(GM_getValue('sxz_bank', '{}')); } catch (e) { BANK = {}; }
  function activeProvider() { return PROVIDERS[CFG.provider] || PROVIDERS.deepseek; }
  function apiBase() { return (CFG.baseURL || activeProvider().baseURL || '').replace(/\/+$/, ''); }
  function apiModel() { return CFG.model || activeProvider().model; }
  function apiKey() { return (CFG.keys && CFG.keys[CFG.provider]) || ''; }

  /* 模型下拉(对齐 Solver/希冀)：缓存拉取的模型 + 内置建议 + 「其他/自定义…」兜底 */
  const OTHER = '__other__';
  function getModelsCache() { try { return JSON.parse(GM_getValue(MODELS_CACHE_K, '[]')) || []; } catch (e) { return []; } }
  function modelOptions() { return [...new Set([...getModelsCache(), ...MODEL_SUGGEST, CFG.model, activeProvider().model].filter(Boolean))]; }
  function fillModelSelect(sel, inp, value) {
    if (!sel) return;
    const list = modelOptions(), inList = list.includes(value);
    sel.innerHTML = '';
    [...list, OTHER].forEach((m) => { const o = document.createElement('option'); o.value = m; o.textContent = m === OTHER ? '其他 / 自定义…' : m; sel.appendChild(o); });
    sel.value = inList ? value : (value ? OTHER : (list[0] || OTHER));
    if (inp) { inp.value = inList ? '' : (value || ''); inp.style.display = sel.value === OTHER ? 'block' : 'none'; }
  }
  function syncCustom(sel, inp) { if (!sel || !inp) return; inp.style.display = sel.value === OTHER ? 'block' : 'none'; if (sel.value === OTHER) inp.focus(); }
  function pickModel(sel, inp, fallback) { if (!sel) return fallback; return (sel.value === OTHER ? (inp ? inp.value.trim() : '') : sel.value) || fallback; }

  const log = (...a) => console.log('%c[SXZ]', 'color:#0f7b6c;font-weight:bold', ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s, r) => { try { return (r || document).querySelector(s); } catch (e) { return null; } };
  const qa = (s, r) => { try { return [...(r || document).querySelectorAll(s)]; } catch (e) { return []; } };
  const vis = (el) => el && el.offsetParent !== null;

  /* ===================== lucide 线性图标 ===================== */
  function ic(name, sz) {
    const P = {
      cap: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2.5 9 2.5 12 0v-5"/>',
      gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
      min: '<path d="M5 12h14"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
      play: '<path d="M6 4.5 19 12 6 19.5Z"/>', pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
      skip: '<path d="M5 4.5 14 12 5 19.5Z"/><path d="M19 5v14"/>',
      bot: '<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M12 9V5"/><circle cx="12" cy="3.5" r="1.5"/><path d="M9 14h.01M15 14h.01"/>',
      refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/>', zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
      save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
      back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
      key: '<path d="M21 2 19 4M14.5 6.5 9 12a5 5 0 1 0 4 4l5.5-5.5M14.5 6.5 18 10l3-3-3.5-3.5-3 3Z"/><circle cx="6.5" cy="16.5" r="1"/>',
      vol: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/>',
      volx: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
      doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    };
    return `<svg class="sxz-svg" width="${sz || 16}" height="${sz || 16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  }

  /* ===================== 防挂机(所有帧都装) ===================== */
  function installAntiIdle() {
    if (!CFG.antiIdle) return;
    try {
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      Object.defineProperty(document, 'webkitHidden', { get: () => false, configurable: true });
      Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
    } catch (e) {}
    ['visibilitychange', 'webkitvisibilitychange', 'blur', 'pagehide', 'freeze'].forEach((ev) => {
      W.addEventListener && W.addEventListener(ev, (e) => e.stopImmediatePropagation(), true);
      document.addEventListener(ev, (e) => e.stopImmediatePropagation(), true);
    });
    try { document.hasFocus = () => true; } catch (e) {}
  }
  function poke() { if (CFG.antiIdle) { try { document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 7, clientY: 7, view: W })); } catch (e) {} } }

  /* ===== 防掉线保活:录制式网络心跳 + Worker 节拍器 + WebAudio 静音 + 合成事件(独立于 tick/STATE.running) ===== */
  const KA = { lastGet: null, worker: null, ac: null, acNode: null };
  const _KA_STATIC = /\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|mp4|m3u8|ts|map)(\?|$)/i;
  function _kaRecordable(u) { try { const url = new URL(u, location.href); if (!/shixizhi\.huawei\.com$/.test(url.hostname)) return null; if (_KA_STATIC.test(url.pathname)) return null; return url.href; } catch (e) { return null; } }
  function installNetRecorder() { // hook XHR/fetch,录平台最近一次成功的同域 GET,空闲重放刷 session(idle 登出根因解)
    if (!IS_SHIXIZHI) return;
    try {
      const XO = W.XMLHttpRequest && W.XMLHttpRequest.prototype.open, XS = W.XMLHttpRequest && W.XMLHttpRequest.prototype.send;
      if (XO && XS) {
        W.XMLHttpRequest.prototype.open = function (m, u) { try { this.__ka_m = ('' + m).toUpperCase(); this.__ka_u = u; } catch (e) {} return XO.apply(this, arguments); };
        W.XMLHttpRequest.prototype.send = function () { try { const s = this; if (s.__ka_m === 'GET') { const href = _kaRecordable(s.__ka_u); if (href) s.addEventListener('load', function () { try { if (s.status >= 200 && s.status < 400) KA.lastGet = href; } catch (e) {} }); } } catch (e) {} return XS.apply(this, arguments); };
      }
      const F = W.fetch;
      if (F) { W.fetch = function (input, init) { try { const m = ((init && init.method) || (input && input.method) || 'GET').toUpperCase(); const u = (typeof input === 'string') ? input : (input && input.url); if (m === 'GET') { const href = _kaRecordable(u); if (href) return F.apply(this, arguments).then((r) => { try { if (r.ok) KA.lastGet = href; } catch (e) {} return r; }); } } catch (e) {} return F.apply(this, arguments); }; }
    } catch (e) {}
  }
  function netHeartbeat() {
    if (!IS_SHIXIZHI || !CFG.antiIdle || !KA.lastGet) return;
    try { const u = KA.lastGet.replace(/([?&])_ka=\d+/, '$1').replace(/[?&]$/, ''); GM_xmlhttpRequest({ method: 'GET', url: u + (u.indexOf('?') >= 0 ? '&' : '?') + '_ka=' + Date.now(), headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' }, timeout: 8000, onload: () => {}, onerror: () => {}, ontimeout: () => {} }); } catch (e) {}
  }
  function ensureAudioKeepAlive() { // 让标签被判定"正在播放音频"→ 豁免后台节流/冻结
    if (!CFG.antiIdle) return;
    try {
      const AC = W.AudioContext || W.webkitAudioContext; if (!AC) return;
      if (!KA.ac) { KA.ac = new AC(); const osc = KA.ac.createOscillator(), gain = KA.ac.createGain(); gain.gain.value = 0.0001; osc.frequency.value = 30; osc.connect(gain); gain.connect(KA.ac.destination); try { osc.start(0); } catch (e) {} KA.acNode = osc; }
      if (KA.ac.state !== 'running') { const p = KA.ac.resume(); if (p && p.catch) p.catch(() => {}); }
    } catch (e) {}
  }
  function bindAudioResume() { if (!CFG.antiIdle) return; const kick = () => ensureAudioKeepAlive(); ['pointerdown', 'keydown', 'click', 'touchstart', 'mousedown'].forEach((ev) => { try { W.addEventListener && W.addEventListener(ev, kick, { capture: true, passive: true }); } catch (e) {} try { document.addEventListener(ev, kick, { capture: true, passive: true }); } catch (e) {} }); }
  let _kaN = 0;
  function fireUserActivity() { // 合成事件:只派到 document/window(零副作用)
    if (!CFG.antiIdle) return;
    try {
      const x = 4 + (_kaN % 3), y = 4 + (_kaN % 2), mo = { bubbles: true, cancelable: true, view: W, clientX: x, clientY: y, screenX: x, screenY: y, button: 0 };
      document.dispatchEvent(new MouseEvent('mousemove', mo));
      try { document.dispatchEvent(new PointerEvent('pointermove', Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, mo))); } catch (e) {}
      try { document.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (e) {}
      if (_kaN % 4 === 0) { ['keydown', 'keyup'].forEach((t) => { try { document.dispatchEvent(new KeyboardEvent(t, { bubbles: true, key: 'Shift', code: 'ShiftLeft', keyCode: 16, which: 16, view: W })); } catch (e) {} }); }
    } catch (e) {}
  }
  function keepAliveBeat() { if (!CFG.antiIdle) return; _kaN++; ensureAudioKeepAlive(); fireUserActivity(); if (_kaN % 5 === 0) netHeartbeat(); }
  function startWorkerTicker(ms) { try { const url = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(1);},' + ms + ');'], { type: 'application/javascript' })); const w = new Worker(url); w.onmessage = function () { try { keepAliveBeat(); } catch (e) {} }; KA.worker = w; return true; } catch (e) { KA.worker = null; return false; } }
  function installKeepAlive() { if (!CFG.antiIdle) return; installNetRecorder(); ensureAudioKeepAlive(); bindAudioResume(); if (!startWorkerTicker(5000)) setInterval(keepAliveBeat, 5000); log('KeepAlive 启动' + (IS_SHIXIZHI ? '(net+audio+worker)' : '(audio+worker)')); }

  /* ===== 课程评价弹窗:点满星 + 提交(四重 AND 防误触) ===== */
  const EVAL_KW = /(评价|评分|打分|满意度|满意|星级|评教|comment|evaluat|satisf|review)/i;
  const EVAL_BLACK = /(已答|我的得分|及格分|交卷|下一题|上一题|结课测试|随堂测验|单选题|多选题|判断题|填空题|再测一次|确认要提交|验证码|短信|登录|退出|删除|考试须知|我已阅读)/;
  const STAR_SEL = '[class*="star"],[class*="Star"],[class*="rate-item"],[class*="rate-star"],[class*="el-rate__item"],[class*="ant-rate-star"],i[class*="rate"],svg[class*="star"],li[class*="rate"]';
  const EVAL_POP_SEL = '[class*="modal"],[class*="dialog"],[class*="Dialog"],[class*="popup"],[class*="Popup"],[class*="comment"],[class*="evaluat"],[class*="pingjia"],[class*="rate"],[class*="Rate"],[class*="satisf"],[class*="layer"],[role="dialog"]';
  const EVAL_SUBMIT = /^(提交|确定|确认|完成|提交评价|确认提交|好的)$/;
  function isVisBox(el) { if (!el) return false; try { if (el.offsetParent === null) { const cs = (el.ownerDocument.defaultView || W).getComputedStyle(el); if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; if (cs.position !== 'fixed') return false; } const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4; } catch (e) { return false; } }
  function findStars(scope) { const raw = qa(STAR_SEL, scope).filter(isVisBox); return raw.filter((el) => !raw.some((o) => o !== el && el.contains(o))); }
  function findEvalPopup() {
    if (q('.type-name') && q('.option-list-item')) return null; // 答题中:坚决不动
    const hit = qa(EVAL_POP_SEL).filter(isVisBox).filter((p) => { const txt = (p.innerText || p.textContent || ''); if (!txt || txt.length > 1200) return false; if (!EVAL_KW.test(txt) || EVAL_BLACK.test(txt)) return false; if (!findStars(p).length) return false; return qa('button,[class*="btn"],span,a,div,p', p).some((b) => { if (!isVisBox(b) || b.children.length > 2) return false; return EVAL_SUBMIT.test((b.innerText || b.textContent || '').replace(/\s+/g, '')); }); });
    if (!hit.length) return null;
    const inner = hit.filter((p) => !hit.some((o) => o !== p && p.contains(o))); return inner[0] || hit[0];
  }
  function autoEvaluate() {
    try {
      const pop = findEvalPopup();
      if (!pop) { STATE._evalTries = 0; STATE._evalRated = false; return false; }
      const now = Date.now();
      if (STATE._evalAt && now - STATE._evalAt < 1500) return true;
      if ((STATE._evalTries || 0) > 8) return true;
      STATE._evalAt = now; STATE._evalTries = (STATE._evalTries || 0) + 1;
      const stars = findStars(pop); if (!stars.length) return false;
      const last = stars[stars.length - 1];
      const tokSel = (el) => { if (!el) return false; const cls = ('' + (el.className || '')).split(/[\s_-]+/); if (cls.some((t) => /^(active|checked|selected|full|on|current|chosen|cur)$/i.test(t))) return true; return el.getAttribute && /^(true|checked)$/i.test(el.getAttribute('aria-checked') || ''); };
      const selectedFull = tokSel(last) || tokSel(last.parentElement) || tokSel(last.firstElementChild) || STATE._evalRated;
      if (!selectedFull) {
        const goodTxt = qa('div,span,label,li,a,button', pop).filter(isVisBox).find((e) => e.children.length <= 1 && /^(非常满意|十分满意|很满意|满意|非常好|很好)$/.test((e.innerText || e.textContent || '').trim()));
        if (goodTxt) clickReal(goodTxt); else { ['mouseover', 'mousemove'].forEach((t) => { try { last.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: W })); } catch (e) {} }); clickReal(last); const inner = last.querySelector('div,i,span'); if (inner) clickReal(inner); }
        STATE._evalRated = true; setNote('检测到课程评价 → 已点满星', 'busy'); return true;
      }
      const btn = qa('button,[class*="btn"],span,a,div,p', pop).filter((b) => isVisBox(b) && b.children.length <= 2).find((b) => EVAL_SUBMIT.test((b.innerText || b.textContent || '').replace(/\s+/g, '')));
      if (btn) { clickReal(btn); setNote('课程评价已提交', 'ok'); STATE._evalTries = 0; STATE._evalAt = now; return true; }
      return false;
    } catch (e) { return false; }
  }

  /* ============================================================ *
   *  引擎(运行在 shixizhi 主学习帧):视频/课件/测验/下一讲
   * ============================================================ */
  const STATE = { running: false, timer: null, busy: false, done: 0, retries: 0, note: '待机', noteKind: '', cwSince: 0, correctByStem: {} };
  // ===== 云题库(共享,SQLite+Docker on huawei2,经 nginx /feiyue-grinder-bank/)=====
  const BANK_API = 'https://feiyue.selab.top/feiyue-grinder-bank';
  function bankRemoteSearch(stem, type) { // 模糊搜索,返回【正确选项内容数组】;4s 超时,任何失败返回 null
    return new Promise((resolve) => {
      try {
        GM_xmlhttpRequest({
          method: 'GET', url: BANK_API + '/search?q=' + encodeURIComponent((stem || '').slice(0, 400)) + (type ? '&type=' + encodeURIComponent(type) : ''), timeout: 4000,
          onload: (r) => { try { const d = JSON.parse(r.responseText); resolve(d && Array.isArray(d.texts) && d.texts.length ? d.texts : null); } catch (e) { resolve(null); } },
          onerror: () => resolve(null), ontimeout: () => resolve(null), onabort: () => resolve(null),
        });
      } catch (e) { resolve(null); }
    });
  }
  function bankRemoteAdd(stem, type, texts) { // 只入"满分确认正确"的题:存正确选项内容;fire-and-forget
    if (!stem || !texts || !texts.length) return;
    try { GM_xmlhttpRequest({ method: 'POST', url: BANK_API + '/add', headers: { 'Content-Type': 'application/json' }, data: JSON.stringify({ stem: ('' + stem).slice(0, 1000), qtype: type || '', texts: texts.map((t) => ('' + t).slice(0, 500)) }), timeout: 5000, onload: () => {}, onerror: () => {}, ontimeout: () => {} }); } catch (e) {}
  }
  // 把"正确选项内容"在【当前题】里按内容匹配出对应字母(防选项乱序);精确归一化优先 + 高重叠子串兜底
  function lettersFromTexts(qd, texts) {
    const wantN = (texts || []).map((t) => normStem(t)).filter((s) => s.length >= 1);
    if (!wantN.length || !qd || !qd.options) return [];
    const out = [];
    qd.options.forEach((o) => {
      const on = normStem(o.text || ''); if (!on) return;
      const hit = wantN.some((wn) => wn === on || (Math.min(wn.length, on.length) >= 4 && (wn.indexOf(on) >= 0 || on.indexOf(wn) >= 0) && Math.min(wn.length, on.length) / Math.max(wn.length, on.length) >= 0.8));
      if (hit) out.push(o.letter);
    });
    return [...new Set(out)];
  }
  function setNote(s, kind) { STATE.note = s; STATE.noteKind = kind || ''; log(s); pushState(); }
  function clickReal(el) { if (!el) return false; ['mousedown', 'mouseup', 'click'].forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: W }))); return true; }
  function findByText(re, tags) { return qa(tags || 'div,span,button,a,p,li').find((el) => vis(el) && el.children.length <= 1 && re.test((el.innerText || el.textContent || '').trim())); }

  function findVideos() { return qa('video').filter((v) => v instanceof HTMLMediaElement); }
  const _hooked = new WeakSet();
  function driveVideo(v) {
    if (CFG.mute) v.muted = true;
    if (Math.abs(v.playbackRate - CFG.rate) > 0.01) { try { v.playbackRate = CFG.rate; } catch (e) {} }
    if (v.paused && !v.ended && v.readyState >= 2) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
    if (!_hooked.has(v)) { _hooked.add(v); v.addEventListener('ended', () => { STATE._ended = Date.now(); }); }
  }
  function nearEnd(v) { return v.duration && isFinite(v.duration) && v.currentTime > 1 && v.duration - v.currentTime <= 1.0; }

  function currentNodeText() { const c = q('.tree-node-content.is-current'); return c ? (c.innerText || '').trim().replace(/\s+/g, ' ') : ''; }
  // 真完成信号:目录当前节点出现"对勾"(anticon-check);未完成是 .kltCourse-progress 圆圈
  function currentNodeDone() { const c = q('.tree-node-content.is-current'); return !!(c && c.querySelector('i.anticon-check, .anticon-check, [class*="anticon-check"]')); }
  function nodeIconRef(n) { const hi = n.querySelector('.header-icon use'); return hi ? (hi.getAttribute('xlink:href') || hi.getAttribute('href') || '') : ''; }
  function isLeafDone(n) { return !!n.querySelector('i.anticon-check, .anticon-check, [class*="anticon-check"]'); }
  function isExamNode(n) { return /icon-catalog-exam/.test(nodeIconRef(n)) || /结课测试|期末|结业考试/.test((n.innerText || '').trim()); }
  // 节点驱动的"下一讲":按目录树顺序找当前节点之后下一个【该刷的可学叶子】。
  // 跳过:章节/子标题(无 catalog-icon,如"第N章""2.9")、已完成(✓)的视频/课件。测验照常进入(由 solveQuiz 判满分跳过)。
  // 不依赖平台"下一讲"按钮(它会跨章乱跳,如第1章→第4章)。
  async function advance() {
    const nodes = qa('.tree-node-content');
    let curIdx = nodes.findIndex((n) => /is-current/.test('' + n.className));
    if (curIdx < 0) { const cn = currentNodeText().slice(0, 10); if (cn) curIdx = nodes.findIndex((n) => (n.innerText || '').replace(/\s+/g, ' ').indexOf(cn) >= 0); }
    let targetIdx = -1, examStop = false;
    for (let i = curIdx + 1; i < nodes.length; i++) {
      const n = nodes[i], ref = nodeIconRef(n);
      if (isExamNode(n)) { if (CFG.autoFinalTest && !isLeafDone(n)) { targetIdx = i; break; } examStop = true; break; } // 结课测试默认不自动 → 停
      const isQuiz = /icon-catalog-quiz/.test(ref);
      const isContent = /icon-catalog-(video|edm|document|courseware)/.test(ref);
      if (!isQuiz && !isContent) continue;        // 跳过章节标题/子标题
      if (isContent && isLeafDone(n)) continue;   // 跳过已完成的视频/课件
      targetIdx = i; break;                        // 未完成内容 / 任意测验(测验由 solveQuiz 判满分)
    }
    if (targetIdx < 0) { setNote(examStop ? '已到结课测试(默认不自动)→ 停止' : '所有小节已刷完 ✓ → 停止', examStop ? 'ok' : 'ok'); stop(); return false; }
    const before = currentNodeText();
    const label = (nodes[targetIdx].innerText || '').trim().replace(/\s+/g, ' ').slice(0, 18);
    log('→ 跳转节点:' + label); clickReal(nodes[targetIdx]);
    for (let i = 0; i < 14 && currentNodeText() === before && !STATE.quizAbort; i++) await sleep(400); // 等节点切换
    STATE.done++; setNote('已切到「' + (currentNodeText() || label) + '」'); return true;
  }

  // 类型判定:以目录当前节点名为准(可靠;.submit-btn/video/iframe 等残留 DOM 不干扰)。自动/手动切换都正确。
  function detectType() {
    const cur = currentNodeText();
    if (!cur) return 'loading';
    if (/结课测试|期末|结业考试/.test(cur)) return CFG.autoFinalTest ? 'quiz' : 'final';
    if (/课件/.test(cur)) return 'courseware';
    if (/随堂测验|测验/.test(cur)) return 'quiz';
    return 'video'; // 其余小节均为视频
  }
  // 该类型内容是否加载就绪(切换瞬间未就绪就等待,避免误判/误操作)
  function contentReady(type) {
    if (type === 'video') return findVideos().some((v) => vis(v) || v.readyState > 0);
    if (type === 'courseware') { const d = cwDoc(); return !!(q('.content-document') || q('.courseware-wrapper') || (d && cwNextBtn(d))); }
    if (type === 'quiz') return !!(q('.type-name') || findByText(/^再测一次$/) || /及格分\s*\/\s*总分|测验次数|我的得分/.test(document.body.innerText || ''));
    return true;
  }

  /* ---------- AI ---------- */
  function callLLM(messages, opts) {
    opts = opts || {};
    const base = apiBase(), key = apiKey(), model = opts.model || apiModel();
    if (!base) return Promise.reject(new Error('未配置 API Base URL'));
    if (!key) return Promise.reject(new Error('未配置 API Key(齿轮里填)'));
    const payload = { model, messages, stream: false, temperature: 0, max_tokens: 800 };
    if (/deepseek/i.test(base) || /deepseek/i.test(model)) payload.thinking = { type: (opts.thinking ?? CFG.thinking) ? 'enabled' : 'disabled' };
    return new Promise((resolve, reject) => {
      STATE._xhr = GM_xmlhttpRequest({
        method: 'POST', url: base + '/chat/completions', data: JSON.stringify(payload), responseType: 'text',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, timeout: 60000,
        onload: (r) => {
          STATE._xhr = null;
          let d = null;
          try { d = JSON.parse(r.responseText); }
          catch (e) { const m = (r.responseText || '').match(/\{[\s\S]*\}/); if (m) { try { d = JSON.parse(m[0]); } catch (e2) {} } } // 容错:从噪声里截取 JSON
          if (!d) return reject(new Error('解析失败:' + (r.responseText || '(空)').slice(0, 100)));
          const c = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
          if (c == null) return reject(new Error('返回异常:' + JSON.stringify(d).slice(0, 100)));
          resolve(('' + c).trim());
        },
        onerror: () => { STATE._xhr = null; reject(new Error('网络错误(检查跨域允许/Key/BaseURL)')); },
        ontimeout: () => { STATE._xhr = null; reject(new Error('超时')); },
        onabort: () => { STATE._xhr = null; reject(new Error('已中止')); },
      });
    });
  }
  // base/key 由调用方从「实时输入框」传入(不读已保存的 CFG)——这样自定义端点未保存也能拉取;成功即缓存供下拉预填
  function refreshModels(base, key, cb) {
    base = (base || '').replace(/\/+$/, '');
    GM_xmlhttpRequest({ method: 'GET', url: base + '/models', headers: { Authorization: 'Bearer ' + (key || '') }, responseType: 'text', timeout: 20000,
      onload: (r) => { let ids = []; try { const d = JSON.parse(r.responseText); ids = (d.data || d.models || []).map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean); } catch (e) {} if (ids.length) GM_setValue(MODELS_CACHE_K, JSON.stringify(ids)); cb(ids, r.status); }, onerror: () => cb([], 0), ontimeout: () => cb([], -1) });
  }
  function bankLookup(stem) {
    if (!stem) return null;
    const norm = (s) => (s || '').replace(/\s+/g, '').replace(/[，。、？?.,;；:：]/g, '');
    const ns = norm(stem);
    for (const k in BANK) { const nk = norm(k); if (nk && (ns.includes(nk) || nk.includes(ns))) { const v = BANK[k]; return Array.isArray(v) ? v.map((x) => ('' + x).toUpperCase()) : (String(v).toUpperCase().match(/[A-Z]/g) || []); } }
    return null;
  }

  /* ---------- 测验 ---------- */
  function readQuestion() {
    const typeEl = q('.type-name');
    const type = typeEl ? typeEl.innerText.trim() : '单选题';
    const idxM = (document.body.innerText || '').match(/第\s*(\d+)\s*\/\s*(\d+)\s*题/);
    const index = idxM ? +idxM[1] : 1, total = idxM ? +idxM[2] : 1;
    const ansM = (document.body.innerText || '').match(/已答[:：]?\s*(\d+)\s*\/\s*(\d+)/);
    const answered = ansM ? +ansM[1] : 0;
    const items = qa('.option-list-item').filter(vis);
    const options = items.map((it) => {
      const ord = q('.option-order-str', it) || q('.option-order', it);
      const con = q('.option-content', it);
      let letter = ord ? (ord.innerText || '').trim().replace(/[^A-Za-z]/g, '').toUpperCase() : '';
      const text = con ? (con.innerText || '').trim() : (it.innerText || '').trim();
      if (!letter) { const mm = (it.innerText || '').trim().match(/^([A-Z])\b/); letter = mm ? mm[1] : ''; }
      return { letter, text: text.replace(/^[A-Z][\.、．\s]+/, '').trim(), el: it, label: q('label', it) || it };
    }).filter((o) => o.letter);
    // 题干容器:结课考试 live 页【无 .test-content】,若 fallback 到 body 会把"姓名/考号/剩余时间/答题卡(第1题…)"全吞进题干 → 查库永远 0 命中。
    // 优先取「.type-name 最近的含 .option-list-item 祖先块」(右侧题目区,只含 题型+题干+选项+本题导航),与入库时 harvest 同款,保证题干一致。
    let root = null;
    if (typeEl) { let box = typeEl.parentElement, hop = 0; while (box && box.querySelectorAll('.option-list-item').length === 0 && hop < 10) { box = box.parentElement; hop++; } root = box; }
    root = root || q('.test-content') || q('.contentArea') || document.body;
    let full = (root.innerText || '').replace(/\s+/g, ' ');
    options.forEach((o) => { if (o.text) full = full.split(o.text).join(' '); });
    full = full
      .replace(/尝试键盘方向键[，,]?\s*切换上下题吧/g, ' ')
      .replace(/返回|随堂测验|结课测试|单选题|多选题|判断题|填空题|已答[:：]?\s*\d+\s*\/\s*\d+|剩余时间[：:]\s*[\d:：]+|满分[：:]\s*\d+\s*分|及格[：:]\s*\d+\s*分|交卷|下一题|上一题|上一讲|下一讲|存疑|收藏|标记|第\s*\d+\s*\/\s*\d+\s*题|[A-Z][\.、．](?=\s)/g, ' ')
      .replace(/[<>＜＞]|&[lg]t;/g, ' ');
    const stem = full.replace(/\s+/g, ' ').trim().replace(/^\s*\d+\s*[、．.，]\s*/, '').slice(0, 600); // 去题号前缀"50、"(每场随机,必须去掉才与库一致)
    return { type, index, total, answered, options, stem };
  }
  function quizSystemMsg() { return { role: 'system', content: '你是严谨的中文选择题答题助手。同一场测验里我会逐题发给你单选/多选/判断题,你每次只回答该题正确选项的字母:单选回一个(如 B);多选连写所有正确字母(如 ABD);判断回对应"正确/错误"的字母。不要解释、不要标点、不要多余文字。请综合整场题目力求全对;若我告知上一轮未通过,请重新审视并纠正之前可能答错的题。' }; }
  function questionMsg(qd) { const lines = qd.options.map((o) => `${o.letter}. ${o.text}`).join('\n'); return { role: 'user', content: `第${qd.index}/${qd.total}题(${qd.type}):${qd.stem}\n${lines}\n只回答字母:` }; }
  function trimConvo() { const c = STATE.convo; if (c && c.length > 41) STATE.convo = [c[0]].concat(c.slice(c.length - 40)); } // 控 token:保 system + 最近 40 条
  function callLLMRetry(messages, retries) { retries = retries == null ? 1 : retries; return callLLM(messages).catch((e) => { if (retries <= 0 || STATE.quizAbort) throw e; return sleep(900).then(() => callLLMRetry(messages, retries - 1)); }); }
  function parseLetters(content, qd) {
    const valid = qd.options.map((o) => o.letter);
    let got = (('' + content).toUpperCase().match(/[A-Z]/g) || []).filter((l) => valid.includes(l));
    if (!got.length) {
      for (const o of qd.options) { if (o.text && content.includes(o.text)) got.push(o.letter); }
      if (/正确|对|是|√|true/i.test(content) && !got.length) { const t = qd.options.find((o) => /正确|对/.test(o.text)); if (t) got.push(t.letter); }
      if (/错误|错|否|×|false/i.test(content) && !got.length) { const f = qd.options.find((o) => /错误|错/.test(o.text)); if (f) got.push(f.letter); }
    }
    if (!/多选/.test(qd.type)) got = got.slice(0, 1);
    return [...new Set(got)];
  }
  // label!=null 时由本函数按阶段更新状态栏:查题库=「搜索中…」、调 AI=「思考中…」(调用方传题号前缀)
  async function getAnswer(qd, label) {
    const sk = normStem(qd.stem);
    const note = (s, k) => { if (label != null) setNote(label + s, k || 'busy'); };
    // 答案来源三选一:'bank'=仅题库 / 'ai'=仅AI(跳过题库) / 'ai_bank'(默认)=题库优先+AI兜底
    if (CFG.answerSource !== 'ai') {
      note('题库搜索中…');
      // ① 本场已知正确(存"正确选项内容",按当前题选项内容匹配出字母 → 防选项乱序;绝不调 AI)
      const knownTexts = STATE.correctByStem && STATE.correctByStem[sk];
      if (knownTexts && knownTexts.length) { const ls = lettersFromTexts(qd, knownTexts); if (ls.length) return { letters: ls, src: '已知正确' }; }
      const bank = bankLookup(qd.stem); // ② 本地题库(字母制 GM sxz_bank)
      if (bank && bank.length) return { letters: bank, src: '本地题库' };
      // ③ 云题库(返回正确选项内容 → 在当前题按内容匹配出字母)
      if (CFG.useRemoteBank !== false) {
        const texts = await bankRemoteSearch(qd.stem, qd.type);
        if (texts && texts.length) { const ls = lettersFromTexts(qd, texts); if (ls.length) { if (STATE.correctByStem) STATE.correctByStem[sk] = texts; return { letters: ls, src: '云题库' }; } }
      }
      if (CFG.answerSource === 'bank') return { letters: [], src: '题库未命中' }; // 仅题库:不调 AI
    }
    note('AI 思考中…');
    // ④ AI(同一对话,含上下文 + 上轮失败记忆)
    if (!STATE.convo || !STATE.convo.length) STATE.convo = [quizSystemMsg()];
    STATE.convo.push(questionMsg(qd));
    let ai = [], err = '';
    try { const c = await callLLMRetry(STATE.convo, 1); ai = parseLetters(c, qd); STATE.convo.push({ role: 'assistant', content: ai.join('') || ('' + c).slice(0, 12) }); }
    catch (e) { err = e.message; STATE.convo.push({ role: 'assistant', content: '(未作答)' }); }
    trimConvo();
    return { letters: ai, src: ai.length ? 'AI' : ('AI失败:' + err) };
  }
  // 选中态可读:选项内有 checked/active/selected/current 后代或 input:checked(CDP 实测)
  function isSelected(el) { try { return !!(el && (/checked|active|selected|current/i.test('' + el.className) || el.querySelector('[class*=checked],[class*=active],[class*=selected],[class*=current],input:checked'))); } catch (e) { return false; } }
  function selectOption(qd, letter) { const o = qd.options.find((x) => x.letter === letter); if (!o) return false; if (!isSelected(o.el)) clickReal(o.label); return true; } // 已选不再点(重复点会取消)
  function clickNextQ() { return clickReal(findByText(/^下一题$/)); }  // 必须按文字!(.subject-btn 首个可能是"上一题",点了会回跳)
  function clickSubmit() { return clickReal(q('.submit-btn') || findByText(/^交卷$/)); }
  function clickRetry() { return clickReal(findByText(/^再测一次$/)); }
  // 测验开始/重测按钮:.start-test(排除"详情")或文字(开始测验/开始作答/开始加载/再测一次/进入…)
  function startQuizBtn() {
    let el = qa('.start-test').filter((e) => vis(e) && !/详情/.test((e.innerText || e.textContent || ''))).find((e) => /开始|加载|再测|作答|答题|进入/.test((e.innerText || e.textContent || '')));
    if (!el) el = findByText(/^(开始测验|开始答题|开始作答|开始加载|开始|再测一次|进入测验|进入答题)$/);
    return el || null;
  }
  // 交卷确认框:按钮文字是"确 认"(带空格),需归一化匹配;优先点 modal 主按钮
  function clickConfirmBtn() {
    const btn = q('.kltCourse-modal-root .kltCourse-btn-primary') || q('[class*=modal] [class*=btn-primary]');
    if (btn && vis(btn)) { clickReal(btn); return true; }
    const el = qa('button,[class*="btn"],span,div,p').find((e) => { if (!vis(e) || e.children.length > 2) return false; const t = (e.innerText || e.textContent || '').replace(/\s+/g, ''); return /^(确认|确定|确认提交|提交|是|好的)$/.test(t); });
    if (el) { clickReal(el); return true; }
    return false;
  }

  function inAnswering() { return !!(q('.type-name') && q('.option-list-item')); }
  // 读"最新答题详情":逐题走查(.subject-btn 下一题翻题),返回 [{idx,total,mine,right}],读完点"返回"回落地页
  async function readQuizDetail() {
    const startNode = currentNodeText();
    const detailBtn = findByText(/^最新答题详情$/) || qa('.start-test').filter((e) => /详情/.test(e.innerText || ''))[0];
    if (!detailBtn) return [];
    clickReal(detailBtn);
    let ok = false;
    for (let k = 0; k < 12 && currentNodeText() === startNode && !STATE.quizAbort; k++) { await sleep(700); if (/第\s*\d+\s*\/\s*[1-9]\d*\s*题/.test(document.body.innerText || '')) { ok = true; break; } }
    if (!ok) return [];
    const out = []; let guard = 0, last = -1;
    while (guard++ < 30 && currentNodeText() === startNode && !STATE.quizAbort) {
      const m = (document.body.innerText || '').match(/第\s*(\d+)\s*\/\s*(\d+)\s*题/); if (!m) break;
      const c = +m[1], t = +m[2];
      const selEls = qa('.option-list-item').filter((it) => /active|checked|selected/.test('' + (q('label', it) || it).className) || /active|checked|selected/.test('' + it.className));
      const mine = selEls.map((it) => ((q('.option-order-str', it) || {}).innerText || '').replace(/[^A-Za-z]/g, '').toUpperCase()).filter(Boolean);
      const mineTexts = selEls.map((it) => { const cc = q('.option-content', it); return ((cc ? cc.innerText : it.innerText) || '').trim().replace(/^[A-Z][\.、．\s]+/, '').trim(); }).filter(Boolean); // 选中项内容(供按内容入库/复用)
      const pw = q('.subject-parses-wrapper'); const vtxt = pw ? (pw.innerText || '').replace(/\s+/g, '') : '';
      const right = /答对|正确|恭喜/.test(vtxt) && !/答错|错误|遗憾/.test(vtxt);
      const rq = readQuestion();
      out.push({ idx: c, total: t, mine: mine.join(''), mineTexts, right, stem: rq.stem || '', type: rq.type || '' });
      if (c >= t || c === last) break; last = c;
      const nb = qa('.subject-btn').filter(vis).filter((e) => /下一题/.test(e.innerText || '')).pop(); if (!nb) break;
      clickReal(nb); await sleep(750);
    }
    const back = q('.goto-score') || findByText(/^<?\s*返回$/);
    if (back) { clickReal(back); await sleep(1800); }
    return out;
  }
  function normStem(s) { return ('' + (s || '')).toLowerCase().replace(/[\s　、，。；：！？,.;:!?（）()【】\[\]《》<>{}"'`~·…—_\/\\|=+*&^%$#@\-]+/g, '').slice(0, 200); } // 去空白+标点+小写:内容/题干匹配更稳
  function letterOf(it) { try { const ord = q('.option-order-str', it) || q('.option-order', it); let L = ord ? (ord.innerText || '').replace(/[^A-Za-z]/g, '').toUpperCase() : ''; if (!L) { const mm = (it.innerText || '').trim().match(/^([A-Z])\b/); L = mm ? mm[1] : ''; } return L; } catch (e) { return ''; } }
  // 收紧选中判定:原生 radio/checkbox 的 checked 是权威信号;无原生控件才退回 class(去掉易误判的 current)
  function isSelStrict(it) { try { const inp = it.querySelector('input[type=radio],input[type=checkbox],input.kltCourse-radio-input'); if (inp) return !!inp.checked; const lab = it.querySelector('label.option-list') || it; return /(^|[\s-])(checked|active|selected)([\s-]|$)/.test(' ' + (lab.className || '') + ' '); } catch (e) { return false; } }
  // 实时从当前 DOM 按字母取选项(不复用 await 前缓存的 el);题已变则返回 null,防落错题
  function freshOpt(letter, myIdx) { if (myIdx != null && readQuestion().index !== myIdx) return null; const it = qa('.option-list-item').filter(vis).find((x) => letterOf(x) === letter); return it ? { el: it, label: q('label', it) || it } : null; }
  // 可信"已答 X/Y":限作答区作用域 + 排除弹窗/结果态(否则脏读)
  function answeredRaw() { const dlg = q('.kltCourse-modal-root') || /确认要提交|我的得分/.test(document.body.innerText || ''); if (!inAnswering() || dlg) return null; const scope = q('.test-content') || q('.contentArea') || document.body; const m = (scope.innerText || '').match(/已答[:：]?\s*(\d+)\s*\/\s*(\d+)/); return m ? { a: +m[1], t: +m[2] } : null; }
  // 交卷结果:总分(满分)取"及格分/总分"的总分;我的得分取最高分;满分 = best>=total
  function quizResult() { const body = document.body.innerText || ''; let total = null, best = null; const se = q('.score.img-box') || q('.score'); const tm = ((se && se.innerText) || '').match(/(\d+)\s*\/\s*(\d+)/); if (tm) total = +tm[2]; const be = q('.greenScore') || q('.redScore') || q('.myScore .get-score') || q('.right .get-score') || q('.get-score-box') || q('.myScore.img-box'); if (be) { const bm = (be.innerText || '').match(/(\d+)/); if (bm) best = +bm[1]; } if (total == null) { const m = body.match(/总分[^0-9]{0,4}(\d+)/); if (m) total = +m[1]; } const pass = /通过|及格|合格/.test(body) && !/不通过|不合格|未通过/.test(body); return { best, total, pass, perfect: total != null && best != null && best >= total }; }
  async function solveQuiz() {
    STATE.quizAbort = false;
    const startNode = currentNodeText();
    if (/结课测试/.test(startNode) && !CFG.autoFinalTest) { setNote('结课测试默认不自动 → 跳过', 'busy'); return; }
    // 已满分的测验直接跳过(避免重复刷已满分测验);强制重答(CFG.force)时不跳,重做一遍
    if (!CFG.force && findByText(/^再测一次$/)) { const pre = quizResult(); if (pre.perfect) { setNote('本测验已满分 ' + pre.best + '/' + pre.total + ' ✓ 跳过', 'ok'); return; } }
    // 等并点击"开始测验/开始作答/开始加载/再测一次"等按钮(可能多步:开始测验→确定),直到进入答题
    let w = 0, clicks = 0;
    while (!STATE.quizAbort && currentNodeText() === startNode && w < 16000 && !inAnswering()) {
      const sb = startQuizBtn();
      if (sb && clicks < 6) { setNote('点击开始测验…', 'busy'); clickReal(sb); clicks++; await sleep(1800); w += 1800; }
      else { autoConfirm(); clickConfirmBtn(); setNote('测验加载中…', 'busy'); await sleep(700); w += 700; } // 处理"确定"确认弹窗 + 等加载
    }
    if (STATE.quizAbort || currentNodeText() !== startNode) return;
    if (!inAnswering()) { setNote('测验未进入答题(请手动点"开始测验")', 'err'); return; }
    // 对话管理:同一场测验用同一对话;换测验才重置(失败重测保留上下文以便提高)
    if (STATE.convoNode !== startNode || !Array.isArray(STATE.convo) || !STATE.convo.length) { STATE.convo = [quizSystemMsg()]; STATE.convoNode = startNode; STATE.retries = 0; STATE.correctByStem = {}; }
    const answersByStem = {}, answersByIdx = {}, answersMeta = {};
    const total0 = readQuestion().total || 0;
    // 稳态读题(防撕裂读:index 与选项数连续两读一致才认)
    async function readStable() {
      for (let i = 0; i < 7 && !STATE.quizAbort && currentNodeText() === startNode; i++) {
        const a = readQuestion(); await sleep(200); const b = readQuestion();
        if (b.options.length > 0 && b.index > 0 && a.index === b.index && a.options.length === b.options.length) return b;
      }
      return null;
    }
    // 稳态"已答 X/Y"(连续两次一致且可信)
    async function countersStable() {
      for (let i = 0; i < 5 && !STATE.quizAbort; i++) { const a = answeredRaw(); await sleep(240); const b = answeredRaw(); if (a && b && a.a === b.a && a.t === b.t) return b; }
      return null;
    }
    // 回退补齐:用"上一题"逐题回退,遇未答题用记忆答案补(绝不重调 AI)
    async function fillBackward(total) {
      let guard = 0;
      while (guard++ < total * 2 + 3 && !STATE.quizAbort && currentNodeText() === startNode) {
        const qd = await readStable(); if (!qd || !qd.options.length) break;
        const mi = qd.index;
        if (!qd.options.some((o) => isSelStrict(o.el))) {
          const want = answersByStem[normStem(qd.stem)] || answersByIdx[mi] || [];
          const list = /多选/.test(qd.type) ? want : [want[0] || (qd.options[0] && qd.options[0].letter)];
          for (const L of list) { if (!L) continue; const o = freshOpt(L, mi); if (o && !isSelStrict(o.el)) { clickReal(o.label); await sleep(340); if (readQuestion().index !== mi) break; } }
        }
        const cur = readQuestion().index; if (cur <= 1) break;
        const up = findByText(/^上一题$/); if (!up) break; clickReal(up); await sleep(380);
        if (readQuestion().index >= cur) break;
      }
    }
    // 交卷前强校验:已答==总数,缺则补齐(最多 total0+1 轮),再交卷 + 确认
    async function topUpAndSubmit() {
      for (let r = 0; r < total0 + 1 && !STATE.quizAbort && currentNodeText() === startNode; r++) {
        const c = await countersStable();
        if (!c) break;
        if (c.a >= c.t) break;
        setNote('交卷前校验:已答 ' + c.a + '/' + c.t + ',回退补齐缺题…', 'busy');
        await fillBackward(c.t);
      }
      const fin = await countersStable();
      if (fin && fin.a < fin.t) setNote('⚠️ 补齐后仍缺 ' + (fin.t - fin.a) + ' 题,按现状交卷(靠未满分重测兜底)', 'err');
      if (STATE.quizAbort || currentNodeText() !== startNode) return;
      setNote('交卷,确认提交…', 'busy'); clickSubmit(); await sleep(900);
      for (let i = 0; i < 8 && !STATE.quizAbort; i++) {
        const b = document.body.innerText || '';
        if (/我的得分|再测一次/.test(b) && !/确认要提交/.test(b)) break;
        clickConfirmBtn(); autoConfirm(); await sleep(700);
      }
    }

    let guard = 0, lastIdx = -1, same = 0;
    while (!STATE.quizAbort && guard++ < 80) {
      if (currentNodeText() !== startNode) { setNote('节点已切换 → 停止答题'); return; } // 用户/脚本跳节 → 退出
      if (!inAnswering()) { await sleep(600); if (!q('.type-name') && !findByText(/^再测一次$/)) break; continue; }
      const qd = await readStable();                 // 稳态读题(防撕裂)
      if (!qd || !qd.options.length) { await sleep(500); continue; }
      const myIdx = qd.index, myTotal = qd.total, multi = /多选/.test(qd.type);
      const qLabel = `第${myIdx}/${myTotal}题 · ${qd.type} · `;
      setNote(qLabel + (CFG.answerSource === 'ai' ? 'AI 思考中…' : '题库搜索中…'), 'busy'); // 进入该题立即更新状态(题库=搜索中 / AI=思考中)
      const { letters, src } = await getAnswer(qd, qLabel);  // label → 状态栏按阶段切「搜索中/思考中」
      if (STATE.quizAbort || currentNodeText() !== startNode) break;
      if (readQuestion().index !== myIdx) { continue; } // ★ await 后题已变 → 丢弃本次落点,重读(堵主竞态)
      const want = letters.length ? letters : (qd.options[0] ? [qd.options[0].letter] : []);
      setNote(`第${myIdx}/${myTotal}题 · ${qd.type} → ${want.join('') || '?'} (${src})`, 'busy');
      if (multi) {
        for (const L of want) { if (STATE.quizAbort || readQuestion().index !== myIdx) break; const o = freshOpt(L, myIdx); if (o && !isSelStrict(o.el)) { clickReal(o.label); await sleep(280); } }
        if (readQuestion().index === myIdx) { qa('.option-list-item').filter(vis).forEach((it) => { const L = letterOf(it); if (L && isSelStrict(it) && want.indexOf(L) < 0) clickReal(q('label', it) || it); }); } // 取消非目标
        await sleep(250);
      } else {
        // 单选/判断:绝不"取消所有"——平台 radio 互斥,点新目标自动灭旧选,从根上消除误删
        const tgt = want[0] || (qd.options[0] && qd.options[0].letter) || '';
        const fo = freshOpt(tgt, myIdx);
        if (fo && !isSelStrict(fo.el)) { clickReal(fo.label); await sleep(340); }   // 目标未选 → 点一次,平台自动跳
        else if (fo && isSelStrict(fo.el)) { clickReal(fo.label); await sleep(280); const fo2 = freshOpt(tgt, myIdx); if (fo2 && !isSelStrict(fo2.el)) { clickReal(fo2.label); await sleep(300); } } // 已选(残留)→ 只 toggle 目标自身触发跳
      }
      answersByStem[normStem(qd.stem)] = want; answersByIdx[myIdx] = want; answersMeta[normStem(qd.stem)] = { stem: qd.stem, type: qd.type, want, texts: want.map((L) => { const o = qd.options.find((x) => x.letter === L); return o ? o.text : ''; }).filter(Boolean) }; // 自记账(含正确选项内容),供补齐 + 满分入库
      // 推进
      let advanced = false;
      for (let i = 0; i < 6 && !STATE.quizAbort; i++) { await sleep(360); if (!inAnswering()) { advanced = true; break; } if (readQuestion().index !== myIdx) { advanced = true; break; } }
      if (STATE.quizAbort) break;
      if (!advanced) {
        if (myIdx >= myTotal) break;                 // 最后一题 → 出循环,交给 topUpAndSubmit
        clickNextQ();
        for (let j = 0; j < 6 && !STATE.quizAbort; j++) { await sleep(360); if (!inAnswering() || readQuestion().index !== myIdx) { advanced = true; break; } }
      }
      const ni = inAnswering() ? readQuestion().index : -1;
      if (ni !== -1 && ni === lastIdx) { if (++same >= 3) { setNote('题号卡在第' + ni + '题,停止(避免乱跳)', 'err'); break; } } else { same = 0; lastIdx = ni; }
    }
    if (STATE.quizAbort) { setNote('已暂停(答题已中止)'); return; }

    await topUpAndSubmit();    // 交卷前校验已答==总数 + 补齐 + 提交 + 确认
    await sleep(1200);

    // 满分重测:未满分(我的得分最高分 < 总分)就重测,直到满分或用尽重试次数
    const res = quizResult();
    setNote('交卷完成 ' + (res.best != null ? '得分' + res.best + (res.total != null ? '/' + res.total : '') : '') + (res.perfect ? ' 满分✓' : (res.pass ? ' 通过(未满分)' : ' 未过')), res.perfect ? 'ok' : (res.pass ? 'busy' : 'err'));
    if (res.perfect) { try { Object.keys(answersMeta).forEach((k) => { const m = answersMeta[k]; if (m && m.texts && m.texts.length) { STATE.correctByStem[k] = m.texts; bankRemoteAdd(m.stem, m.type, m.texts); } }); log('满分 → 本卷正确选项内容入云题库'); } catch (e) {} } // 只存满分确认的
    if (!res.perfect && !STATE.quizAbort && STATE.retries < CFG.quizRetryMax && currentNodeText() === startNode) {
      STATE.retries++;
      setNote('未满分,读取答题详情判定正误…', 'busy');
      let fb = `上一轮${res.best != null ? '得分' + res.best + (res.total != null ? '/' + res.total : '') : ''}未满分。`;
      try {
        const detail = await readQuizDetail(); // 逐题正误(我的答案 + 对/错)
        detail.forEach((d) => { if (d.right && d.mineTexts && d.mineTexts.length) STATE.correctByStem[normStem(d.stem || '')] = d.mineTexts; }); // 对的题(存正确选项内容)→ 下一轮直接复用,不再调 AI
        if (detail.length) fb += '逐题判定:' + detail.map((d) => `第${d.idx}题你选「${d.mine || '?'}」${d.right ? '✓正确' : '✗错误'}`).join(';') + '。重做要求:✓正确的题保持原答案不变;✗错误的题必须改选其它你认为更可能正确的选项,争取全部答对(满分)。';
        else fb += '请结合你之前的作答重新审视,纠正可能答错的题,争取满分。';
      } catch (e) { fb += '请结合你之前的作答重新审视,纠正可能答错的题,争取满分。'; }
      if (STATE.convo && STATE.convo.length) STATE.convo.push({ role: 'user', content: fb });
      if (STATE.quizAbort || currentNodeText() !== startNode) return;
      setNote('未满分,带逐题正误重测 ' + STATE.retries + '/' + CFG.quizRetryMax, 'busy'); await sleep(1200);
      const sb = startQuizBtn(); if (sb) { clickReal(sb); await sleep(2500); return solveQuiz(); }
    }
    STATE.retries = 0;
  }

  /* ============================================================ *
   *  结课考试(examContent 独立标签):答题循环 + 交卷 + 计时安全
   * ============================================================ */
  // 是否在结课考试作答页(URL examContent + 有题型组件;水印/无目录树)。不依赖 currentNodeText。
  // 答题详情/复盘页也走 examContent 路由且有 .type-name;靠每题级"正确答案：X"/"我的得分：X 分"判定(注意:结果汇总页"答题详情/考试报告"是按钮文字、"您的得分"非"我的得分",不能用来判复盘)
  function isExamReviewPage() { try { return /正确答案[：:]\s*[A-Z]|我的得分[：:]/.test((document.body && document.body.innerText) || ''); } catch (e) { return false; } }
  function onExamPage() { return (/\/examContent(\?|$)/.test(PATH + location.search) || (/\/iexam\//.test(PATH) && !!q('.exam-watermark') && !!q('.type-name'))) && !isExamReviewPage(); }
  // 结课考试结果汇总页(/examResult):显示得分/通过 + 「再考一次」「答题详情」按钮。用户点「再考一次」即 arm 托管重考。
  function onExamResultPage() { return /\/examResult(\?|$)/.test(PATH + location.search); }
  // 在 examInfo 入口页(显示规则+"开始考试")
  function onExamInfoPage() { return /\/examInfo(\?|$)/.test(PATH + location.search) || (/\/iexam\//.test(PATH) && !q('.type-name') && !!findByText(/^开始考试$/)); }
  // 用户真实点击"开始考试"/"再考一次"等 = 授权自动托管(跨标签 GM 标记;新标签 examContent 据此自动答题,无需先去设置勾选)
  const EXAM_ARM_KEY = 'sxz_exam_armed_v1', EXAM_ARM_MS = 180000;
  // 入口/重考按钮文案:examInfo 的「开始考试」与 examResult 的「再考一次」及各种重考措辞
  const EXAM_ARM_RE = /^(开始考试|再考一次|再考一次！?|重新考试|再次考试|重新开始考试|继续考试|重新作答)$/;
  function armExam() { try { GM_setValue(EXAM_ARM_KEY, Date.now()); } catch (e) {} }
  function isExamArmed() { try { return Date.now() - (+GM_getValue(EXAM_ARM_KEY, 0) || 0) < EXAM_ARM_MS; } catch (e) { return false; } }
  function installExamArm() {
    try {
      document.addEventListener('click', (e) => {
        try { if (!e.isTrusted) return; let n = e.target, d = 0; while (n && d++ < 5) { if (EXAM_ARM_RE.test((n.innerText || n.textContent || '').trim())) { armExam(); setNote('已托管结课考试 → 自动进入/确认/答题/交卷', 'ok'); break; } n = n.parentElement; } } catch (err) {}
      }, true);
    } catch (e) {}
  }
  // 考试页"交卷"按钮(.hand-exams-btn,与随堂测验 .submit-btn 不同)
  function examSubmitBtn() { return q('.hand-exams-btn') || findByText(/^交卷$/, 'button,div,span,p,a'); }
  // 考试页"下一题":首个 .subject-btn 通常是它;但 .subject-btn 也含"存疑"/"上一题",故按文字优先
  function examNextBtn() {
    const byText = qa('.subject-btn').filter(vis).find((e) => /^下一题$/.test((e.innerText || '').trim()));
    if (byText) return byText;
    const t = findByText(/^下一题$/, '.subject-btn,button,div,span');
    if (t) return t;
    // 兜底:.subject-btn 里排除"上一题/存疑/收藏"后的首个(末题可能无"下一题")
    return qa('.subject-btn').filter(vis).find((e) => !/上一题|存疑|收藏|标记|交卷/.test((e.innerText || '').trim())) || null;
  }
  // 答题卡:每个可点项含题号;返回 [{n, el, answered}]。兼容多种 class 命名,按文字"第N题"或纯数字取题号。
  function examCards() {
    let items = qa('.answer-card-item, .card-item, .answerSheet-item, .question-card-item, [class*="card"] [class*="item"]').filter(vis);
    if (!items.length) { // 兜底:含"第N题"或纯数字、可点的小元素
      items = qa('li,div,span,a,button').filter((e) => vis(e) && e.children.length <= 1 && /^(第?\s*\d{1,3}\s*题?)$/.test((e.innerText || '').trim()));
    }
    const seen = new Set(), out = [];
    items.forEach((el) => {
      const m = (el.innerText || '').trim().match(/(\d{1,3})/); if (!m) return;
      const n = +m[1]; if (n < 1 || n > 200 || seen.has(n)) return; seen.add(n);
      const cls = ' ' + (el.className || '') + ' ' + ((el.parentElement && el.parentElement.className) || '') + ' ';
      const answered = /(answered|done|finished|completed|active-done|is-answered|has-answer|selected)/i.test(cls);
      out.push({ n, el, answered });
    });
    out.sort((a, b) => a.n - b.n);
    return out;
  }
  // 跳到第 n 题(用答题卡);等到 readQuestion().index===n 或超时
  async function examGoto(n) {
    const card = examCards().find((c) => c.n === n); if (!card) return false;
    clickReal(card.el);
    for (let i = 0; i < 12 && STATE.running && onExamPage(); i++) { await sleep(300); if (readQuestion().index === n) return true; }
    return readQuestion().index === n;
  }
  // 解析"剩余时间：HH:MM:SS"(或 MM:SS)→ 秒;读不到返回 null(读不到时不强制交卷)
  function examRemainSec() {
    const body = document.body.innerText || '';
    const m = body.match(/剩余\s*时间[:：]?\s*(\d{1,2})\s*[:：]\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2}))?/);
    if (!m) { const m2 = body.match(/(\d{1,2})\s*:\s*(\d{2})\s*:\s*(\d{2})/); if (m2) return (+m2[1]) * 3600 + (+m2[2]) * 60 + (+m2[3]); return null; }
    return m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
  }
  // 考试"已答 X/Y":examContent 顶部"已答：X/50"。复用 readQuestion 解析(answered/total)。
  function examAnswered() { const r = readQuestion(); const m = (document.body.innerText || '').match(/已答[:：]?\s*(\d+)\s*\/\s*(\d+)/); return { a: m ? +m[1] : (r.answered || 0), t: m ? +m[2] : (r.total || 0) }; }
  const EXAM_SUBMIT_FLOOR = 90; // 剩余 < 90s 立即交卷
  function examTimeCritical() { const s = examRemainSec(); return s != null && s <= EXAM_SUBMIT_FLOOR; }
  // 稳态读题(同 solveQuiz.readStable,但守卫换成 onExamPage)
  async function examReadStable() {
    for (let i = 0; i < 7 && STATE.running && onExamPage(); i++) {
      const a = readQuestion(); await sleep(200); const b = readQuestion();
      if (b.options.length > 0 && b.index > 0 && a.index === b.index && a.options.length === b.options.length) return b;
    }
    return null;
  }
  // 在【当前题】落点(复用 isSelStrict/freshOpt;单选只点目标不取消,多选点全部目标+取消非目标)
  // 按字母选中目标选项:点 label→项本体→原生 input 逐级兜底,每次点完校验 isSelStrict,最多 3 次
  async function clickOptByLetter(L, myIdx) {
    for (let a = 0; a < 3; a++) {
      if (!STATE.running || readQuestion().index !== myIdx) return false;
      let o = freshOpt(L, myIdx); if (!o) return false;
      if (isSelStrict(o.el)) return true;
      clickReal(o.label); await sleep(300);
      o = freshOpt(L, myIdx); if (o && isSelStrict(o.el)) return true;
      if (o) { clickReal(o.el); await sleep(180); const inp = o.el.querySelector('input'); if (inp) { clickReal(inp); await sleep(180); } o = freshOpt(L, myIdx); if (o && isSelStrict(o.el)) return true; }
    }
    return false;
  }
  async function examPlaceAnswer(qd, want) {
    const myIdx = qd.index, multi = /多选/.test(qd.type);
    if (multi) {
      for (const L of want) { if (!STATE.running || readQuestion().index !== myIdx) break; await clickOptByLetter(L, myIdx); }
      if (readQuestion().index === myIdx) { qa('.option-list-item').filter(vis).forEach((it) => { const L = letterOf(it); if (L && isSelStrict(it) && want.indexOf(L) < 0) clickReal(q('label', it) || it); }); } // 取消非目标
      await sleep(200);
    } else {
      const tgt = want[0] || (qd.options[0] && qd.options[0].letter) || '';
      await clickOptByLetter(tgt, myIdx);
    }
    // 落点校验:实际选中 == 目标?不一致写日志(诊断"题库命中却选错/全A"问题)
    if (readQuestion().index === myIdx) {
      const placed = qa('.option-list-item').filter(vis).filter((it) => isSelStrict(it)).map((it) => letterOf(it)).filter(Boolean).sort();
      const ok = placed.length > 0 && placed.join('') === [...want].sort().join('');
      if (!ok) log('⚠ 落点校验失败 第' + myIdx + '题: 目标[' + want.join('') + '] 实选[' + placed.join('') + '] 选项=' + qd.options.map((o) => o.letter).join(''));
      return ok;
    }
    return false;
  }
  // 交卷确认弹窗里的"确认"按钮:明确排除"取消/继续作答/返回/放弃"(交卷框常是这俩并排,点错=没交上),也排除 .hand-exams-btn 自身
  function examConfirmBtn() {
    const norm = (e) => (e.innerText || e.textContent || '').replace(/\s+/g, '');
    const NO = /取消|继续作答|继续答题|返回|放弃|再想想|再检查|关闭|稍后|我再想/;
    const pool = qa('.ant-modal-confirm-btns button, .ant-modal-footer button, .ant-modal button, [class*=dialog] button, [class*=modal] button, [class*=popup] button, button, [class*=btn], span, div')
      .filter((e) => vis(e) && e.children.length <= 2 && !/hand-exams-btn/.test('' + (e.className || '')) && !NO.test(norm(e)));
    // 1) 严格主确认词:确定/确认(交卷/提交)、是、好的
    let ok = pool.find((e) => /^(确定|确认)(交卷|提交)?[!！]?$|^(交卷|提交|是的?|好的)$/.test(norm(e)));
    if (ok) return ok;
    // 2) 宽松:含"确认/确定"且含"交卷/提交"(可能带"(已答50/50)"等后缀)
    ok = pool.find((e) => /(确认|确定)[\s\S]{0,8}(交卷|提交)|(交卷|提交)[\s\S]{0,8}(确认|确定)/.test(norm(e)));
    if (ok) return ok;
    // 3) Ant/通用 modal 主按钮兜底
    return qa('.ant-modal-confirm-btns .ant-btn-primary, .ant-modal-footer .ant-btn-primary, .ant-modal .ant-btn-primary, [class*=modal] [class*=primary]')
      .filter((e) => vis(e) && !NO.test(norm(e)))[0] || null;
  }
  // 交卷 + 确认弹窗(点交卷 → 循环点确认按钮,直到离开作答页/出成绩为止;确保"确认交卷"那一下真点到)
  async function examSubmit(reason) {
    setNote('交卷中(' + (reason || '完成') + ')…', 'busy');
    const sb = examSubmitBtn(); if (sb) clickReal(sb); await sleep(900);
    let confirmedClicks = 0;
    for (let i = 0; i < 12 && STATE.running; i++) {
      const body = document.body.innerText || '';
      // 已离开作答页 / 出现成绩/结果 → 视作交卷成功
      if (!onExamPage() || /我的得分|考试结果|本次得分|已交卷|提交成功|您的得分|客观题正确题数/.test(body)) { setNote('已交卷 ✓', 'ok'); return true; }
      const ok = examConfirmBtn();
      if (ok) { clickReal(ok); confirmedClicks++; setNote('交卷确认中…(' + confirmedClicks + ')', 'busy'); }
      else { const sb2 = examSubmitBtn(); if (sb2) clickReal(sb2); } // 弹窗还没出 → 再点一次交卷
      autoConfirm(); await sleep(750);
    }
    const done = !onExamPage();
    setNote(done ? '已交卷 ✓' : '⚠ 交卷确认未确认到,请手动点弹窗「确认交卷」', done ? 'ok' : 'err');
    return done;
  }
  // 答题卡兜底:扫未答题(顺序 examCards 的 !answered;或逐一跳过去读 isSelStrict),逐个跳过去补答
  async function examFillUnanswered(answersByIdx) {
    const cards = examCards();
    if (!cards.length) return;
    for (const c of cards) {
      if (!STATE.running || !onExamPage()) return;
      if (examTimeCritical()) { await examSubmit('计时安全'); return; }
      if (c.answered) continue;
      if (!await examGoto(c.n)) continue;
      const qd = await examReadStable(); if (!qd || !qd.options.length) continue;
      if (!CFG.force && qd.options.some((o) => isSelStrict(o.el))) continue; // 已答(答题卡标记滞后)→ 跳过;强制重答时不跳
      let want = answersByIdx[c.n];
      if (!want || !want.length) { const fLabel = '补答第' + c.n + '题 · '; setNote(fLabel + (CFG.answerSource === 'ai' ? 'AI 思考中…' : '题库搜索中…'), 'busy'); const r = await getAnswer(qd, fLabel); examCountSrc(r.src); if (STATE.running && onExamPage() && readQuestion().index === c.n) want = r.letters; }
      if (!want || !want.length) want = [qd.options[0].letter]; // 兜底首项,绝不留空(留空=丢分)
      if (readQuestion().index !== c.n) continue;
      await examPlaceAnswer(qd, want); answersByIdx[c.n] = want;
    }
  }

  // examInfo 入口页:脚本能自动处理"考试须知"模态(勾"我已阅读"+点"确定")和"风险提示"二次确认;
  // 但"开始考试"会经 window.open 新标签,合成点击被弹窗拦截 → 这步必须用户真实点击。
  // 处理"考试须知"模态(勾我已阅读+确定)与"已在别处打开"风险确认。处理了(或正等待)返回 true。examInfo 或考试标签内均可用。
  function handleExamNoticeOrRisk() {
    const modal = (q('.ant-modal') && /我已阅读|考试须知|防作弊|切屏/.test(q('.ant-modal').innerText || '') ? q('.ant-modal') : null) || qa('[class*=modal]').filter(vis).find((m) => /我已阅读|考试须知|防作弊|切屏/.test(m.innerText || ''));
    if (modal && vis(modal)) {
      const chkWrap = qa('label.ant-checkbox-wrapper, label', modal).find((l) => /我已阅读|已阅读|同意/.test(l.innerText || ''));
      const chkInput = (chkWrap && q('input.ant-checkbox-input, input[type=checkbox]', chkWrap)) || q('input.ant-checkbox-input, input[type=checkbox]', modal);
      if (chkInput && !chkInput.checked) { clickReal(chkWrap || chkInput); }
      const okBtn = qa('button, [class*=btn]', modal).filter(vis).find((b) => { const t = (b.innerText || '').replace(/\s+/g, ''); return /^(确定|确认|我已阅读并知晓|开始作答|进入考试)$/.test(t); });
      if (okBtn && !okBtn.disabled && !/disabled/i.test('' + okBtn.className)) { setNote('考试须知:已勾选 → 确定', 'busy'); clickReal(okBtn); }
      else setNote('考试须知:等可勾选/确定(倒计时)…', 'busy');
      return true;
    }
    const risk = qa('[class*=modal],[class*=confirm]').filter(vis).find((m) => /已在别处打开|是否确定|链接已/.test(m.innerText || ''));
    if (risk) { const ok = qa('button,[class*=btn]', risk).filter(vis).find((b) => /^(确定|确认|是)$/.test((b.innerText || '').replace(/\s+/g, ''))); if (ok) { setNote('风险确认 → 确定', 'busy'); clickReal(ok); } return true; }
    return false;
  }
  function handleExamInfo() {
    if (handleExamNoticeOrRisk()) return;
    setNote('结课考试入口:请【手动点击】「开始考试」(开新标签需真实点击);须知/答题/交卷脚本全自动', 'busy');
  }
  // 本场答题来源计数(题库优先验证 + 统计 AI 解题数)。src: 已知正确/本地题库/云题库/AI/AI失败/题库未命中
  function examCountSrc(src) { try { const k = ('' + src).split(':')[0] || '?'; STATE.examSrcStat = STATE.examSrcStat || {}; STATE.examSrcStat[k] = (STATE.examSrcStat[k] || 0) + 1; } catch (e) {} }
  function reportExamSrc() {
    const s = STATE.examSrcStat || {};
    const bankN = (s['已知正确'] || 0) + (s['本地题库'] || 0) + (s['云题库'] || 0);
    const aiN = (s['AI'] || 0) + (s['AI失败'] || 0);
    const parts = ['已知正确', '本地题库', '云题库', 'AI', 'AI失败', '题库未命中'].filter((k) => s[k]).map((k) => k + ' ' + s[k]);
    STATE.examStat = { bankN, aiN, detail: s };
    log('结课考试来源统计: ' + (parts.join(' · ') || '无'));
    setNote('交卷完成 · 题库命中 ' + bankN + ' 题 / AI 解 ' + aiN + ' 题' + (parts.length ? '(' + parts.join(' · ') + ')' : ''), 'ok');
  }
  // 云题库健康检查(/health)→ 判断 GM 跨域请求是否真能出去(区别于 search 无命中)
  function bankHealth() { return new Promise((resolve) => { try { GM_xmlhttpRequest({ method: 'GET', url: BANK_API + '/health', timeout: 5000, onload: (r) => { try { resolve(JSON.parse(r.responseText).ok === true); } catch (e) { resolve(false); } }, onerror: () => resolve(false), ontimeout: () => resolve(false), onabort: () => resolve(false) }); } catch (e) { resolve(false); } }); }
  // 答题前自检:按 answerSource 确认至少一个来源可用,否则暂停不答(避免"全选A"废卷)
  async function examPreflight() {
    const haveKey = !!apiKey(), src = CFG.answerSource;
    const bankUp = (src === 'ai') ? false : await bankHealth();
    const canBank = (src !== 'ai') && bankUp, canAI = (src !== 'bank') && haveKey;
    if (canBank || canAI) { log('考试自检 OK · 题库' + (bankUp ? '可达' : '不可达') + ' · AI' + (haveKey ? '有Key' : '无Key') + ' · 模式' + src); return true; }
    const why = [src !== 'ai' ? ('题库' + (bankUp ? '可达' : '不可达(跨域被拦/网络?)')) : '', src !== 'bank' ? ('AI' + (haveKey ? '有Key' : '无Key')) : ''].filter(Boolean).join(' · ');
    setNote('⚠ 无可用答题来源(' + why + ')→ 已暂停未答,避免全选A废卷!请检查 Tampermonkey「跨域请求」权限 / 网络 / AI Key,修好后再点运行', 'err');
    return false;
  }

  async function solveExam() {
    if (STATE.examRunning) return; // 防重入
    if (!onExamPage()) { setNote('未在考试作答页', 'busy'); return; }
    if (!CFG.autoFinalTest && !isExamArmed()) { setNote('结课考试未托管(点「开始考试」或设置里开自动)', 'busy'); return; }
    STATE.examRunning = true; STATE.quizAbort = false;
    if (!(await examPreflight())) { STATE.examRunning = false; stop(); return; } // 来源全不可用 → 暂停不答(不浪费考试次数)
    if (!STATE.examStartMs) STATE.examStartMs = Date.now(); // 答题用时基准(墙钟兜底)
    { const r0 = examRemainSec(); if (r0 != null) STATE.examTotalSec = Math.max(STATE.examTotalSec || 0, r0); } // 平台计时基准(取最大剩余≈总时长)
    // 考试独立对话(50 题一整场,逐题 push,失败无重测——靠满分罕见,以正确率为主)
    STATE.convo = [quizSystemMsg()]; STATE.convoNode = '__exam__'; STATE.correctByStem = STATE.correctByStem || {};
    const answersByIdx = {};
    STATE.examSrcStat = {}; // 本场来源计数(题库优先/AI 兜底);收尾 reportExamSrc 汇总
    const total0 = (readQuestion().total) || 50;
    setNote('结课考试开始(共 ' + total0 + ' 题)…', 'busy');
    try {
      let guard = 0, lastIdx = -1, same = 0;
      while (STATE.running && onExamPage() && guard++ < total0 * 3 + 20) {
        // —— 计时安全:每轮先查剩余时间,临界立即交卷 ——
        if (examTimeCritical()) { setNote('剩余时间 < ' + EXAM_SUBMIT_FLOOR + 's → 立即交卷', 'err'); await examSubmit('计时安全'); STATE.examRunning = false; return; }
        const qd = await examReadStable();
        if (!qd || !qd.options.length) { await sleep(500); continue; }
        const myIdx = qd.index, myTotal = qd.total || total0, multi = /多选/.test(qd.type);
        const exLabel = '考试 第' + myIdx + '/' + myTotal + '题 · ' + qd.type + ' · ';
        setNote(exLabel + (CFG.answerSource === 'ai' ? 'AI 思考中…' : '题库搜索中…'), 'busy');
        // 已答则不重复求解(答题卡跳回已答题/重入时);强制重答(CFG.force)时无视已答,重新查库作答覆盖
        if (CFG.force || !qd.options.some((o) => isSelStrict(o.el))) {
          const { letters, src } = await getAnswer(qd, exLabel); // 题库优先(本地→云),搜不到才 AI;label → 状态栏分「搜索中/思考中」
          examCountSrc(src);
          if (!STATE.running || !onExamPage()) break;
          if (readQuestion().index !== myIdx) continue; // await 后题已变 → 丢弃重读
          const want = letters.length ? letters : [qd.options[0].letter]; // 绝不留空
          setNote('考试 第' + myIdx + '/' + myTotal + '题 → ' + want.join('') + ' (' + src + ')', 'busy');
          await examPlaceAnswer(qd, want); answersByIdx[myIdx] = want;
        } else { answersByIdx[myIdx] = answersByIdx[myIdx] || qd.options.filter((o) => isSelStrict(o.el)).map((o) => o.letter); }
        // —— 推进:单选/多选选完都【不自动跳】,必须点"下一题" ——
        if (myIdx >= myTotal) break; // 末题 → 出循环走交卷
        const nb = examNextBtn();
        if (nb) { clickReal(nb); for (let j = 0; j < 8 && STATE.running && onExamPage(); j++) { await sleep(320); if (readQuestion().index !== myIdx) break; } }
        else { if (!await examGoto(myIdx + 1)) { setNote('找不到「下一题」,用答题卡推进', 'busy'); } } // 无下一题按钮 → 答题卡跳
        // 卡题保护
        const ni = onExamPage() ? readQuestion().index : -1;
        if (ni !== -1 && ni === lastIdx) { if (++same >= 3) { setNote('题号卡在第' + ni + '题 → 改用答题卡补全', 'err'); break; } } else { same = 0; lastIdx = ni; }
      }
      if (!STATE.running || !onExamPage()) { STATE.examRunning = false; return; }
      // —— 答题卡兜底:补全所有未答题(到末题后/中途卡题都走这) ——
      setNote('逐题作答完,核对答题卡补全未答题…', 'busy');
      await examFillUnanswered(answersByIdx);
      if (!STATE.running || !onExamPage()) { STATE.examRunning = false; return; }
      // —— 交卷前最终校验:已答==总数则交卷;若仍缺且时间充裕再补一轮 ——
      let fin = examAnswered();
      if (fin.t && fin.a < fin.t && !examTimeCritical()) { await examFillUnanswered(answersByIdx); fin = examAnswered(); }
      if (fin.t && fin.a < fin.t) setNote('⚠ 仍缺 ' + (fin.t - fin.a) + ' 题,按现状交卷', 'err');
      // —— 防全A废卷:真实命中(题库/AI成功)太少 → 不自动交卷,暂停让用户排查(不浪费考试次数)——
      const ss = STATE.examSrcStat || {};
      const okN = (ss['已知正确'] || 0) + (ss['本地题库'] || 0) + (ss['云题库'] || 0) + (ss['AI'] || 0);
      const totalN = fin.t || total0 || 50;
      if (okN < Math.ceil(totalN * 0.4)) {
        reportExamSrc();
        setNote('⚠ 仅 ' + okN + '/' + totalN + ' 题来自题库/AI(疑似来源失效,全选A风险)→ 不自动交卷,已暂停。检查 Tampermonkey 跨域权限/AI Key 后重做', 'err');
        stop(); STATE.examRunning = false; return;
      }
      // —— 答题用时不足 10 分钟:等够再自动交(用户可随时手动交)——
      const MIN_SEC = 600;
      const elapsedSec = () => { const r = examRemainSec(); if (r != null) STATE.examTotalSec = Math.max(STATE.examTotalSec || 0, r); return (STATE.examTotalSec && r != null) ? (STATE.examTotalSec - r) : (STATE.examStartMs ? (Date.now() - STATE.examStartMs) / 1000 : MIN_SEC); };
      while (elapsedSec() < MIN_SEC && STATE.running && onExamPage() && !examTimeCritical()) {
        const e = Math.max(0, elapsedSec() | 0);
        setNote('答案已全部填好 · 按规则等够 10 分钟用时再交卷(已用 ' + fmtClock(e) + '/10:00,可手动交)', 'busy');
        await sleep(2000);
      }
      if (!STATE.running || !onExamPage()) { STATE.examRunning = false; return; } // 等待期间用户手动交了/暂停了/离开了
      await examSubmit(fin.a >= fin.t ? '全部作答完成' : '尽力作答');
      STATE.examStartMs = 0; STATE.examTotalSec = 0; // 交完清计时基准
      reportExamSrc(); // 本场来源汇总:题库命中 X / AI 解 Y(题库优先验证 + 统计 AI 解题数)
    } catch (e) { log('solveExam err', e); setNote('考试异常:' + (e && e.message), 'err'); }
    finally { STATE.examRunning = false; }
  }

  /* ---------- 课件:滚动翻完每一页 ---------- */
  function cwDoc() { try { const f = q('iframe[src*="edm3client"]') || q('iframe[src*="/static/index.html"]') || q('iframe'); return f && f.contentDocument; } catch (e) { return null; } }
  function cwScroller(doc) { let best = null, bh = 0; qa('*', doc).forEach((e) => { const d = e.scrollHeight - e.clientHeight; if (d > bh && e.clientHeight > 100) { bh = d; best = e; } }); return best; }
  function cwPage(doc) { const m = (doc && doc.body && doc.body.innerText || '').match(/(\d+)\s*\/\s*(\d+)/); return m ? m[1] + '/' + m[2] : ''; }
  function cwPageInfo(doc) { const m = (doc && doc.body && doc.body.innerText || '').match(/(\d+)\s*\/\s*(\d+)/); return m ? { cur: +m[1], total: +m[2] } : null; }
  function cwNextBtn(doc) { try { return doc.querySelector('img.footer-icon[src*="toRight."]'); } catch (e) { return null; } } // 下一页图标(toRight3=末页,排除)
  // 返回 true=已翻完可前进;false=未完成/中途跳节(不要 advance)
  async function doCourseware() {
    const startNode = currentNodeText();
    // 等 edm3 查看器内部加载出翻页控件/可滚动容器/页码(最多 ~13s;直接判会因没加载完误报"无控件")
    let doc = null, nb = null, sc = null, waited = 0;
    while (STATE.running && currentNodeText() === startNode && waited < 13000) {
      doc = cwDoc(); nb = doc && cwNextBtn(doc); sc = doc && cwScroller(doc);
      const hasPage = !!(doc && doc.body && /\d+\s*\/\s*\d+/.test(doc.body.innerText || ''));
      if (nb || sc || hasPage) break;
      setNote('课件加载中…', 'busy'); await sleep(700); waited += 700;
    }
    if (currentNodeText() !== startNode) return false;
    doc = cwDoc(); nb = doc && cwNextBtn(doc); sc = doc && cwScroller(doc);
    if (nb) {
      // 点"下一页"图标逐屏翻(页码同步刷新 + 正确记进度)
      let guard = 0, stuck = 0, last = -1;
      while (STATE.running && currentNodeText() === startNode && guard++ < 120) {
        const p = cwPageInfo(doc);
        setNote('课件翻页 ' + (p ? p.cur + '/' + p.total : '…') + ' 页', 'busy');
        if (p && p.cur >= p.total) break;
        const b = cwNextBtn(doc); if (!b) break;
        b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: W }));
        await sleep(850);
        const c = (cwPageInfo(doc) || {}).cur ?? -1;
        if (c === last) { if (++stuck >= 4) break; } else { stuck = 0; last = c; }
      }
      const f = cwPageInfo(doc);
      setNote('课件已翻完 ' + (f ? f.cur + '/' + f.total : '') + ' 页 → 跳下一讲', 'ok'); await sleep(700);
      return currentNodeText() === startNode;
    }
    if (sc) {
      // 兜底:滚动翻完
      let stuck = 0, last = -1, guard = 0;
      while (STATE.running && currentNodeText() === startNode && guard++ < 300) {
        const max = Math.max(1, sc.scrollHeight - sc.clientHeight);
        sc.scrollTop = Math.min(sc.scrollTop + Math.round(sc.clientHeight * 0.85), sc.scrollHeight);
        try { sc.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (e) {}
        setNote('课件翻页(滚动) ' + Math.min(100, Math.round(100 * sc.scrollTop / max)) + '%', 'busy');
        await sleep(900);
        if (Math.abs(sc.scrollTop - last) < 2) { if (++stuck >= 3) break; } else { stuck = 0; } last = sc.scrollTop;
      }
      setNote('课件已翻完 → 跳下一讲', 'ok'); await sleep(700);
      return currentNodeText() === startNode;
    }
    // 实在没控件(等满仍无):停留后视作完成
    setNote('课件(无翻页控件)停留 ' + CFG.cwDwellSec + 's', 'busy'); await sleep(CFG.cwDwellSec * 1000);
    return currentNodeText() === startNode;
  }

  /* ---------- 弹窗自动确认 ---------- */
  function autoConfirm() {
    qa('button,.btn,[class*="btn"],span,a,div,p').forEach((el) => {
      if (!vis(el) || el.children.length > 2) return;
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ''); // 去空格:平台按钮常是"确 认""继 续学习"
      if (!/^(继续(学习|播放)?|我知道了|知道了|确定|确认|确认提交|好的|继续|是)$/.test(t)) return;
      let p = el, d = 0; while (p && d++ < 8) { if (/dialog|modal|popup|mask|messagebox|el-message|layer|confirm/i.test('' + (p.className || ''))) { clickReal(el); return; } p = p.parentElement; }
    });
  }

  /* ---------- 引擎主循环 ---------- */
  function tick() {
    if (!STATE.running) return;
    try { findVideos().forEach(driveVideo); poke(); if (!autoEvaluate()) autoConfirm(); if (!STATE.busy) progress(); } catch (e) { log('tick err', e); }
    pushState();
  }
  async function progress() {
    STATE.busy = true;
    try {
      // 结课考试复盘/答题详情(只读,examContent 路由但每题含"正确答案")— 绝不托管/作答,仅提示
      if (isExamReviewPage()) { setNote('结课考试复盘页(只读) · 重考请点「再考一次」', 'busy'); return; }
      // —— 结课考试(独立 examContent 标签,无目录树)优先处理 ——
      // 考试标签(examContent)上题目还没出(须知/风险弹窗阻塞):托管时自动处理须知/确认
      if (/\/examContent/.test(location.pathname) && !onExamPage() && (CFG.autoFinalTest || isExamArmed())) {
        armExam(); if (handleExamNoticeOrRisk()) return; setNote('考试加载中(等题目)…', 'busy'); return;
      }
      if (onExamPage()) {
        if (!CFG.autoFinalTest && !isExamArmed()) { setNote('结课考试页 · 未托管(从入口点「开始考试」或设置开自动)', 'busy'); return; }
        armExam(); // 续期 arm 标记,防 3 分钟窗口在长考试中过期
        if (!STATE.examRunning) await solveExam(); // solveExam 内部自带 50 题循环;跑完即停
        return;
      }
      if (onExamInfoPage()) { if (CFG.autoFinalTest || isExamArmed()) handleExamInfo(); else setNote('结课考试入口 · 点「开始考试」即自动托管(进入/确认/答题/交卷)', 'busy'); return; } // 开新标签需用户真实点
      if (onExamResultPage()) { setNote('结课考试结果页 · 点「再考一次」即自动托管重考(进入/确认/答题/交卷全自动)', isExamArmed() ? 'ok' : 'busy'); return; } // 点再考一次→arm→新考试页自动托管
      const node = currentNodeText();
      if (node !== STATE.curNode) { STATE.curNode = node; STATE._endAt = 0; STATE.cwSince = 0; } // 节点变化(自动切换 or 用户手动跳节)→ 重置每节状态
      const type = detectType();
      if (type === 'final') { setNote('结课测试默认不自动 → 暂停', 'busy'); stop(); return; }
      if (type === 'loading') { setNote('页面加载中…', 'busy'); return; }
      // 不再用中央"就绪门槛"(它会卡在"加载中");改为各处理器内部自行等加载,未就绪下一拍重试。
      if (type === 'video') {
        const v = findVideos()[0];
        if (!v) { setNote('视频加载中…', 'busy'); return; } // 等 video 出现,下一拍重试
        if (CFG.autoNext) {
          const dur = v.duration;
          const atEnd = v.ended || (dur && isFinite(dur) && v.currentTime >= dur - 0.3); // 播到真正结束
          if (atEnd) {
            if (!STATE._endAt) { STATE._endAt = Date.now(); setNote('视频播完,等目录标记完成(对勾)…', 'busy'); }
            if (currentNodeDone()) { STATE._endAt = 0; setNote('已完成 ✓ → 下一讲', 'ok'); await advance(); }            // 真出对勾才切
            else if (Date.now() - STATE._endAt > 8000) { STATE._endAt = 0; setNote('已播完 → 下一讲'); await advance(); } // 兜底最多等8s
          } else { STATE._endAt = 0; setNote('视频播放中…', 'busy'); }
        }
      } else if (type === 'courseware') {
        const done = await doCourseware();
        if (done && STATE.running && CFG.autoNext && currentNodeText() === node) await advance(); // 真翻完且仍在本节才切
      } else if (type === 'quiz') {
        if (CFG.quizAuto) { await solveQuiz(); if (STATE.running && CFG.autoNext && currentNodeText() === node) await advance(); }
        else { setNote('测验自动答已关 → 跳过该测验', 'busy'); if (STATE.running && currentNodeText() === node) await advance(); } // 直接跳到下一节
      }
    } catch (e) { log('progress err', e); }
    finally { STATE.busy = false; }
  }
  function start() { STATE.userStopped = false; if (STATE.running) return; STATE.quizAbort = false; STATE.running = true; STATE.timer = setInterval(tick, 1000); setNote('运行中', 'ok'); }
  function stop() { STATE.userStopped = true; STATE.running = false; STATE.examRunning = false; STATE.quizAbort = true; if (STATE.timer) clearInterval(STATE.timer); STATE.timer = null; try { if (STATE._xhr) STATE._xhr.abort(); } catch (e) {} STATE._xhr = null; STATE.busy = false; setNote('已暂停'); }

  function getState() {
    const v = findVideos()[0];
    const examPage = onExamPage(), examInfo = onExamInfoPage();
    let node = currentNodeText().slice(0, 18), type = STATE.running ? detectType() : 'unknown';
    if (examPage) { type = 'exam'; const a = examAnswered(); const rs = examRemainSec(); node = '结课考试 ' + a.a + '/' + (a.t || 50) + (rs != null ? ' · 剩' + fmtClock(rs) : ''); }
    else if (examInfo) { type = 'exam'; node = '结课考试入口'; }
    else if (onExamResultPage()) { type = 'exam'; node = '结课考试结果页'; }
    else if (isExamReviewPage()) { type = 'exam'; node = '考试复盘(只读)'; }
    return { running: STATE.running, busy: STATE.busy, note: STATE.note, noteKind: STATE.noteKind, done: STATE.done,
      type, node, exam: examPage, examInfo,
      video: v ? { cur: v.currentTime, dur: v.duration, rate: v.playbackRate, muted: v.muted } : null,
      hasKey: !!apiKey(), model: apiModel(), rate: CFG.rate, mute: CFG.mute };
  }
  function fmtClock(s) { s = Math.max(0, s | 0); const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, ss = s % 60; return (h ? h + ':' : '') + ('' + m).padStart(2, '0') + ':' + ('' + ss).padStart(2, '0'); }
  // 引擎指令处理(本地或来自顶层 postMessage)
  function handleCmd(cmd, val) {
    if (cmd === 'start') start();
    else if (cmd === 'stop') stop();
    else if (cmd === 'next') advance();
    else if (cmd === 'solve') { STATE.quizAbort = false; STATE.busy = true; (onExamPage() ? solveExam() : solveQuiz()).finally(() => { STATE.busy = false; }); } // 考试页 → solveExam
    else if (cmd === 'setRate') { CFG.rate = +val || 1; saveCfg(); findVideos().forEach((v) => { try { v.playbackRate = CFG.rate; } catch (e) {} }); pushState(); }
    else if (cmd === 'mute') { CFG.mute = !!val; saveCfg(); findVideos().forEach((v) => { v.muted = CFG.mute; }); pushState(); }
    else if (cmd === 'cfgReload') { CFG = loadCfg(); try { BANK = JSON.parse(GM_getValue('sxz_bank', '{}')); } catch (e) {} pushState(); }
  }

  /* ============================================================ *
   *  通信桥:引擎在子帧 → postMessage 给顶层;UI 在顶层
   * ============================================================ */
  let engineLocal = false; // 引擎与 UI 是否同窗(独立访问 shixizhi 时)
  function pushState() {
    const s = getState();
    if (IS_TOP) { if (typeof renderState === 'function') renderState(s); }
    else { try { window.parent.postMessage({ __sxz: 'state', s }, '*'); } catch (e) {} }
  }
  function sendCmd(cmd, val) {
    if (engineLocal) { handleCmd(cmd, val); return; }
    const f = q('iframe.sxz-iframe') || qa('iframe').find((x) => /shixizhi/.test(x.src || ''));
    if (f && f.contentWindow) { try { f.contentWindow.postMessage({ __sxz: 'cmd', cmd, val }, '*'); } catch (e) {} }
    else setPanelNote('未找到课程帧(请在课程学习页打开)', 'err');
  }

  /* ============================================================ *
   *  UI 面板(运行在顶层窗口,可任意拖动)
   * ============================================================ */
  let panel, fab, lastState = null;
  const CSS = `
  #sxz-panel,#sxz-fab{--sxz-bg:#fff;--sxz-subtle:#f7f6f3;--sxz-hover:#f1f1ef;--sxz-text:#37352f;--sxz-muted:#787774;--sxz-faint:#9b9a97;
    --sxz-border:#edece9;--sxz-line:#dcdad4;--sxz-link:#2383e2;--sxz-accent:#0f7b6c;
    --sxz-ok-fg:#0f5e54;--sxz-ok-bg:rgba(15,123,108,.12);--sxz-ok-bd:rgba(15,123,108,.32);
    --sxz-err-fg:#b91c1c;--sxz-err-bg:rgba(224,62,62,.12);--sxz-err-bd:rgba(224,62,62,.32);
    --sxz-busy-fg:#b35309;--sxz-busy-bg:rgba(217,115,13,.12);--sxz-busy-bd:rgba(217,115,13,.32);
    --sxz-r-sm:6px;--sxz-r-md:8px;--sxz-r-lg:12px;--sxz-shadow:0 12px 36px -8px rgba(15,15,15,.22),0 2px 8px rgba(15,15,15,.06);
    --sxz-font:'Inter Tight','PingFang SC',-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;--sxz-mono:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;}
  #sxz-panel,#sxz-panel *{box-sizing:border-box}
  .sxz-svg{display:inline-block;flex:0 0 auto;vertical-align:-2px}
  #sxz-panel{position:fixed;top:54px;right:22px;width:444px;max-height:90vh;z-index:2147483647;
    background:var(--sxz-bg);border:1px solid var(--sxz-line);border-radius:var(--sxz-r-lg);box-shadow:var(--sxz-shadow);
    font-family:var(--sxz-font);font-size:15px;line-height:1.6;color:var(--sxz-text);display:flex;flex-direction:column;overflow:hidden;-webkit-font-smoothing:antialiased}
  #sxz-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:15px 18px;background:var(--sxz-subtle);border-bottom:1px solid var(--sxz-border);cursor:move;user-select:none}
  #sxz-head .brand{display:flex;align-items:center;gap:12px;min-width:0}
  #sxz-head .badge{width:38px;height:38px;flex:0 0 38px;display:flex;align-items:center;justify-content:center;background:var(--sxz-ok-bg);border:1px solid var(--sxz-ok-bd);border-radius:var(--sxz-r-md);color:var(--sxz-accent)}
  #sxz-head .titles{display:flex;flex-direction:column;line-height:1.2;min-width:0}
  #sxz-head .titles b{font-size:18px;font-weight:600;letter-spacing:.2px}
  #sxz-head .titles i{font-style:normal;font-size:13px;color:var(--sxz-faint)}
  #sxz-head .tools{display:flex;gap:4px;flex:0 0 auto}
  #sxz-head .ic{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--sxz-muted);border-radius:var(--sxz-r-sm);transition:.15s}
  #sxz-head .ic:hover{background:var(--sxz-hover);color:var(--sxz-text)}
  #sxz-head .ic.pulse{color:var(--sxz-link);animation:sxzpulse 1.3s ease-in-out infinite}
  #sxz-body{padding:18px 20px;overflow:auto;position:relative}
  #sxz-banner{display:none;margin:0 0 16px;padding:13px 15px;border-radius:var(--sxz-r-md);background:rgba(35,131,226,.10);border:1px solid rgba(35,131,226,.32);color:var(--sxz-link);font-size:14px;font-weight:600;cursor:pointer;align-items:center;gap:9px;line-height:1.45}
  #sxz-banner.show{display:flex}#sxz-banner:hover{background:rgba(35,131,226,.16)}
  #sxz-meta{display:grid;grid-template-columns:auto 1fr;gap:11px 18px;font-size:15px;margin-bottom:17px}
  #sxz-meta .k{color:var(--sxz-faint)}
  #sxz-meta .v{color:var(--sxz-text);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
  #sxz-meta .v b{font-weight:600}
  #sxz-meta .v.clickable{cursor:pointer;color:var(--sxz-link)}#sxz-meta .v.clickable:hover{text-decoration:underline}
  .sxz-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}
  #sxz-ctl{display:flex;flex-direction:column;gap:10px;margin:0 0 16px}
  .sxz-ctl-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .sxz-ctl-k{font-size:14px;color:var(--sxz-faint)}
  .sxz-seg{display:inline-flex;border:1px solid var(--sxz-line);border-radius:var(--sxz-r-sm);overflow:hidden}
  .sxz-seg button{padding:6px 10px;font-size:13px;font-weight:600;font-family:var(--sxz-font);background:var(--sxz-bg);color:var(--sxz-muted);border:none;border-left:1px solid var(--sxz-line);cursor:pointer;transition:.12s}
  .sxz-seg button:first-child{border-left:none}.sxz-seg button.on{background:var(--sxz-accent);color:#fff}.sxz-seg button:not(.on):hover{background:var(--sxz-hover);color:var(--sxz-text)}
  .sxz-toggle{display:inline-flex;align-items:center;gap:7px;padding:6px 14px;border:1px solid var(--sxz-line);border-radius:999px;background:var(--sxz-bg);color:var(--sxz-text);font-size:13.5px;font-weight:600;font-family:var(--sxz-font);cursor:pointer;transition:.12s}
  .sxz-toggle.off{color:var(--sxz-faint)}.sxz-toggle:hover{background:var(--sxz-hover)}
  #sxz-status{margin:0 0 16px;padding:13px 15px;border-radius:var(--sxz-r-md);background:var(--sxz-subtle);border:1px solid var(--sxz-border);white-space:pre-wrap;min-height:22px;font-size:14.5px;color:var(--sxz-muted)}
  #sxz-status.ok{background:var(--sxz-ok-bg);border-color:var(--sxz-ok-bd);color:var(--sxz-ok-fg)}
  #sxz-status.err{background:var(--sxz-err-bg);border-color:var(--sxz-err-bd);color:var(--sxz-err-fg)}
  #sxz-status.busy{background:var(--sxz-busy-bg);border-color:var(--sxz-busy-bd);color:var(--sxz-busy-fg)}
  .sxz-btns{display:flex;gap:11px}.sxz-btns.col{flex-direction:column;margin-top:11px}
  .sxz-btn{flex:1;display:flex;align-items:center;justify-content:center;gap:9px;padding:13px 15px;border-radius:var(--sxz-r-md);font-size:15.5px;font-weight:600;font-family:var(--sxz-font);cursor:pointer;transition:.15s;letter-spacing:.2px;border:1px solid transparent}
  .sxz-btn:active{transform:translateY(.5px)}.sxz-btn-primary{background:var(--sxz-text);color:#fff}.sxz-btn-primary:hover{background:#2b2926}
  .sxz-btn-ghost{background:var(--sxz-bg);color:var(--sxz-text);border-color:var(--sxz-line)}.sxz-btn-ghost:hover{background:var(--sxz-hover)}
  .sxz-spin{display:inline-block;width:14px;height:14px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:sxzspin .7s linear infinite;vertical-align:-2px}
  @keyframes sxzspin{to{transform:rotate(360deg)}}@keyframes sxzpulse{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
  #sxz-foot{padding:13px 18px;border-top:1px solid var(--sxz-border);font-size:12.5px;color:var(--sxz-faint);background:var(--sxz-subtle);line-height:1.55}
  #sxz-config{position:absolute;inset:0;z-index:6;background:var(--sxz-bg);display:none;flex-direction:column}
  #sxz-config.open{display:flex}
  #sxz-config .cfg-head{display:flex;align-items:center;justify-content:space-between;padding:15px 18px;background:var(--sxz-subtle);border-bottom:1px solid var(--sxz-border)}
  #sxz-config .cfg-head b{font-size:17px;font-weight:600}#sxz-config .cfg-head .ic{cursor:pointer;color:var(--sxz-muted)}
  #sxz-config .cfg-body{flex:1;overflow:auto;padding:18px 20px}
  .sxz-field{display:flex;flex-direction:column;gap:7px;margin-bottom:15px}
  .sxz-field label{font-size:13.5px;color:var(--sxz-muted);font-weight:600;display:flex;align-items:center;justify-content:space-between;gap:8px}
  .sxz-field input,.sxz-field select,.sxz-field textarea{padding:10px 12px;border:1px solid var(--sxz-line);border-radius:var(--sxz-r-sm);font-size:14.5px;font-family:var(--sxz-mono);background:var(--sxz-bg);color:var(--sxz-text);outline:none;width:100%}
  .sxz-field select{font-family:var(--sxz-font);cursor:pointer}.sxz-field textarea{font-size:13px;resize:vertical;min-height:54px}
  .sxz-field input:focus,.sxz-field select:focus,.sxz-field textarea:focus{border-color:var(--sxz-link);box-shadow:0 0 0 3px rgba(35,131,226,.14)}
  .sxz-opts{display:flex;flex-wrap:wrap;gap:11px 18px;padding:13px 15px;margin-bottom:15px;background:var(--sxz-subtle);border:1px solid var(--sxz-border);border-radius:var(--sxz-r-md)}
  .sxz-chk{display:flex;align-items:center;gap:7px;cursor:pointer;color:var(--sxz-text);font-size:14px}.sxz-chk input{accent-color:var(--sxz-accent);width:16px;height:16px}
  .sxz-num{width:52px!important;padding:6px 8px!important;font-family:var(--sxz-mono)!important}
  .sxz-mini{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--sxz-line);background:var(--sxz-bg);color:var(--sxz-link);border-radius:999px;padding:4px 11px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:var(--sxz-font)}
  .sxz-mini:hover{background:var(--sxz-hover)}
  .sxz-hint{font-size:12.5px;color:var(--sxz-faint);font-weight:400}.sxz-hint a{color:var(--sxz-link);font-weight:600;text-decoration:none}.sxz-hint a:hover{text-decoration:underline}
  #sxz-cfgmsg{font-size:13px;min-height:18px;margin-top:4px;color:var(--sxz-muted)}
  #sxz-arrow{position:absolute;top:15px;right:84px;z-index:9;display:none;align-items:center;gap:6px;background:var(--sxz-link);color:#fff;padding:7px 12px;border-radius:999px;font-size:13px;font-weight:600;box-shadow:0 4px 14px rgba(35,131,226,.45);white-space:nowrap;cursor:pointer;animation:sxzpulse 1.3s ease-in-out infinite}
  #sxz-arrow.show{display:inline-flex}#sxz-arrow::after{content:'';position:absolute;right:-5px;top:50%;transform:translateY(-50%);border:5px solid transparent;border-left-color:var(--sxz-link)}
  #sxz-fab{position:fixed;top:54px;right:22px;z-index:2147483647;display:none;align-items:center;gap:9px;background:var(--sxz-text);color:#fff;border-radius:999px;padding:12px 20px;font-weight:600;font-size:15px;font-family:var(--sxz-font);cursor:pointer;box-shadow:var(--sxz-shadow);transition:.15s}
  #sxz-fab:hover{transform:translateY(-1px)}`;
  function injectCSS() { try { GM_addStyle(CSS); } catch (e) { const s = document.createElement('style'); s.textContent = CSS; (document.head || document.documentElement).appendChild(s); } }
  function configHTML() {
    const opts = Object.keys(PROVIDERS).map((k) => `<option value="${k}">${PROVIDERS[k].label}</option>`).join('');
    return `<div id="sxz-config"><div class="cfg-head"><b>设置</b><div class="ic" id="sxz-cfgback" title="返回">${ic('back', 17)}</div></div><div class="cfg-body">
      <div class="sxz-field"><label>① AI 服务</label><select id="cf-prov">${opts}</select></div>
      <div class="sxz-field"><label>② API Base URL <span class="sxz-hint">留空用预设</span></label><input id="cf-base" spellcheck="false" placeholder="https://aiapis.help/v1"></div>
      <div class="sxz-field"><label>③ API Key <span class="sxz-hint">没有? 去拿 <a href="https://aiapis.help/console" target="_blank" rel="noopener">GPT</a> · <a href="https://platform.deepseek.com" target="_blank" rel="noopener">DeepSeek</a></span></label><input id="cf-key" type="password" placeholder="sk-..."></div>
      <div class="sxz-field"><label>④ 模型 <span class="sxz-mini" id="cf-models">${ic('refresh', 13)}刷新模型</span></label><select id="cf-modelsel"></select><input id="cf-model" spellcheck="false" placeholder="自定义模型名" style="display:none"></div>
      <div class="sxz-opts">
        <label class="sxz-chk"><input type="checkbox" id="cf-think">深度思考(DeepSeek)</label>
        <label class="sxz-chk"><input type="checkbox" id="cf-autonext">自动下一讲</label>
        <label class="sxz-chk"><input type="checkbox" id="cf-quizauto">测验自动答</label>
        <label class="sxz-chk"><input type="checkbox" id="cf-final">结课测试也自动</label>
        <label class="sxz-chk"><input type="checkbox" id="cf-force">强制重答(不跳过已答/已满分)</label>
        <label class="sxz-chk">课件停留<input class="sxz-num" id="cf-dwell">s</label>
        <label class="sxz-chk">不过重测<input class="sxz-num" id="cf-retry">次</label></div>
      <div class="sxz-field"><label>答案来源</label><select id="cf-src"><option value="ai_bank">题库优先 + AI 兜底（推荐）</option><option value="bank">仅题库（命中才答，不调 AI）</option><option value="ai">仅 AI（跳过题库）</option></select></div>
      <div class="sxz-field"><label>题库 JSON <span class="sxz-hint">可选</span></label><textarea id="cf-bank" spellcheck="false" placeholder='{"题干关键字":"B","另一题":["A","C"]}'></textarea></div>
      <div class="sxz-btns"><button class="sxz-btn sxz-btn-ghost" id="cf-test">${ic('zap', 15)}测试 AI</button><button class="sxz-btn sxz-btn-primary" id="cf-save">${ic('save', 15)}保存</button></div>
      <div id="sxz-cfgmsg"></div></div></div>`;
  }
  function buildPanel() {
    if (panel) return; injectCSS();
    panel = document.createElement('div'); panel.id = 'sxz-panel';
    panel.innerHTML = `
      <div id="sxz-head"><div class="brand"><div class="badge">${ic('cap', 19)}</div><div class="titles"><b>飞跃·刷课 Grinder</b><i>shixizhi · v${(typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '?'}</i></div></div>
        <div class="tools"><div class="ic" id="sxz-gear" title="设置 / 配置 API Key">${ic('gear', 18)}</div><div class="ic" id="sxz-minz" title="收起">${ic('min', 18)}</div></div></div>
      <div id="sxz-arrow">${ic('key', 13)}先配置 API Key</div>
      <div id="sxz-body">
        <div id="sxz-banner">${ic('key', 15)}<span>未配置 API Key,点此打开设置 → 选服务、填 Key</span></div>
        <div id="sxz-meta"></div>
        <div id="sxz-ctl">
          <div class="sxz-ctl-row"><span class="sxz-ctl-k">倍速</span><div class="sxz-seg" id="sxz-rate"><button data-r="1">1x</button><button data-r="1.25">1.25x</button><button data-r="1.5">1.5x</button><button data-r="2">2x</button><button data-r="3">3x</button></div></div>
          <div class="sxz-ctl-row"><span class="sxz-ctl-k">声音</span><button class="sxz-toggle" id="sxz-mute"></button></div>
        </div>
        <div id="sxz-status"></div>
        <div class="sxz-btns"><button class="sxz-btn sxz-btn-primary" id="sxz-toggle">${ic('play', 16)}<span>开始</span></button></div>
        <div class="sxz-btns col"><div class="sxz-btns"><button class="sxz-btn sxz-btn-ghost" id="sxz-next">${ic('skip', 16)}下一讲</button><button class="sxz-btn sxz-btn-ghost" id="sxz-solve">${ic('bot', 16)}解本测验</button></div></div>
        ${configHTML()}
      </div>
      <div id="sxz-foot">登录用华为原生界面手动(短信验证码自己手打) · Key 仅存本地</div>`;
    const mount = () => document.body && document.body.appendChild(panel);
    (document.body ? Promise.resolve() : new Promise((r) => document.addEventListener('DOMContentLoaded', r))).then(mount);
    fab = document.createElement('div'); fab.id = 'sxz-fab'; fab.innerHTML = ic('cap', 16) + '<span>飞跃·刷课</span>';
    (document.body ? Promise.resolve() : new Promise((r) => document.addEventListener('DOMContentLoaded', r))).then(() => document.body.appendChild(fab));
    fab.onclick = () => { fab.style.display = 'none'; panel.style.display = 'flex'; };
    bindPanel(); makeDraggable(panel, panel.querySelector('#sxz-head'));
    renderState(lastState || getState());
  }
  function bindPanel() {
    const $ = (id) => panel.querySelector(id);
    const ps = $('#cf-prov');
    function fill() {
      ps.value = CFG.provider; $('#cf-base').value = CFG.baseURL || ''; $('#cf-key').value = apiKey();
      fillModelSelect($('#cf-modelsel'), $('#cf-model'), CFG.model || activeProvider().model);
      $('#cf-base').placeholder = activeProvider().baseURL || 'https://...';
      $('#cf-think').checked = !!CFG.thinking; $('#cf-autonext').checked = CFG.autoNext; $('#cf-quizauto').checked = CFG.quizAuto;
      $('#cf-dwell').value = CFG.cwDwellSec; $('#cf-retry').value = CFG.quizRetryMax; $('#cf-final').checked = CFG.autoFinalTest; $('#cf-force').checked = !!CFG.force;
      $('#cf-src').value = CFG.answerSource; $('#cf-bank').value = GM_getValue('sxz_bank', '');
    }
    fill();
    const openCfg = (o) => { $('#sxz-config').classList.toggle('open', o); renderState(lastState); };
    $('#sxz-gear').onclick = () => { if ($('#sxz-config').classList.contains('open')) { $('#cf-save').click(); openCfg(false); } else openCfg(true); };
    $('#sxz-cfgback').onclick = () => { $('#cf-save').click(); openCfg(false); };
    $('#sxz-banner').onclick = () => openCfg(true);
    $('#sxz-arrow').onclick = () => openCfg(true);
    $('#sxz-minz').onclick = () => { panel.style.display = 'none'; fab.style.display = 'inline-flex'; };
    $('#sxz-toggle').onclick = () => sendCmd((lastState && lastState.running) ? 'stop' : 'start');
    $('#sxz-next').onclick = () => sendCmd('next');
    $('#sxz-solve').onclick = () => sendCmd('solve');
    panel.querySelectorAll('#sxz-rate button').forEach((b) => { b.onclick = () => { CFG.rate = +b.dataset.r || 1; saveCfg(); sendCmd('setRate', CFG.rate); renderState(lastState); }; });
    $('#sxz-mute').onclick = () => { CFG.mute = !CFG.mute; saveCfg(); sendCmd('mute', CFG.mute); renderState(lastState); };
    $('#sxz-meta').addEventListener('click', (e) => { const c = e.target.closest('[data-act]'); if (!c) return; if (c.dataset.act === 'cfg') openCfg(true); else if (c.dataset.act === 'mute') { CFG.mute = !CFG.mute; saveCfg(); sendCmd('mute', CFG.mute); renderState(lastState); } });
    ps.onchange = () => { CFG.provider = ps.value; saveCfg(); fill(); sendCmd('cfgReload'); renderState(lastState); };
    $('#cf-save').onclick = () => {
      CFG.provider = ps.value; CFG.baseURL = $('#cf-base').value.trim(); CFG.model = pickModel($('#cf-modelsel'), $('#cf-model'), activeProvider().model); CFG.thinking = $('#cf-think').checked; CFG.keys[CFG.provider] = $('#cf-key').value.trim();
      CFG.autoNext = $('#cf-autonext').checked; CFG.quizAuto = $('#cf-quizauto').checked; CFG.cwDwellSec = +$('#cf-dwell').value || 8; CFG.quizRetryMax = +$('#cf-retry').value || 0; CFG.autoFinalTest = $('#cf-final').checked; CFG.force = $('#cf-force').checked; CFG.answerSource = $('#cf-src').value;
      const raw = $('#cf-bank').value.trim(); try { BANK = raw ? JSON.parse(raw) : {}; GM_setValue('sxz_bank', raw); $('#sxz-cfgmsg').textContent = '✓ 已保存'; } catch (e) { $('#sxz-cfgmsg').textContent = '题库JSON格式错误,其余已存'; }
      saveCfg(); sendCmd('cfgReload'); renderState(lastState);
    };
    $('#cf-modelsel').onchange = () => syncCustom($('#cf-modelsel'), $('#cf-model'));
    $('#cf-models').onclick = () => {
      const base = ($('#cf-base').value.trim() || activeProvider().baseURL || '').replace(/\/+$/, '');
      const key = $('#cf-key').value.trim() || apiKey();
      if (!base) { $('#sxz-cfgmsg').textContent = '先填 ② API Base URL 再刷新'; return; }
      $('#sxz-cfgmsg').textContent = '获取模型…';
      const cur = pickModel($('#cf-modelsel'), $('#cf-model'), '');
      refreshModels(base, key, (ids, status) => {
        if (!ids.length) { $('#sxz-cfgmsg').textContent = `无模型/失败(HTTP ${status};确认 Base URL 带 /v1、Key 正确、脚本猫已允许跨域)`; return; }
        fillModelSelect($('#cf-modelsel'), $('#cf-model'), cur || ids[0]);
        $('#sxz-cfgmsg').textContent = ids.length + ' 个模型,已填进下拉,选一个';
      });
    };
    $('#cf-test').onclick = async () => { $('#cf-save').click(); $('#sxz-cfgmsg').textContent = 'AI 测试中…'; try { const c = await callLLM([{ role: 'user', content: '只回复两个字:正常' }]); $('#sxz-cfgmsg').textContent = '✓ AI OK: ' + c.slice(0, 20); } catch (e) { $('#sxz-cfgmsg').textContent = '✗ ' + e.message; } };
  }
  function makeDraggable(el, h) {
    let sx, sy, ox, oy, d = false;
    h.addEventListener('mousedown', (e) => { if (e.target.closest('.ic')) return; d = true; sx = e.clientX; sy = e.clientY; const r = el.getBoundingClientRect(); ox = r.left; oy = r.top; e.preventDefault(); });
    document.addEventListener('mousemove', (e) => { if (!d) return; el.style.left = ox + e.clientX - sx + 'px'; el.style.top = oy + e.clientY - sy + 'px'; el.style.right = 'auto'; });
    document.addEventListener('mouseup', () => (d = false));
  }
  function fmt(x) { return x && isFinite(x) ? `${Math.floor(x / 60)}:${('' + Math.floor(x % 60)).padStart(2, '0')}` : '--'; }
  const TYPE_LABEL = { video: '视频', courseware: '课件', quiz: '测验', final: '结课测试', exam: '结课考试', loading: '加载中', unknown: '—' };
  function setPanelNote(t, kind) { lastState = Object.assign({}, lastState || getState(), { note: t, noteKind: kind || '' }); renderState(lastState); }
  function renderState(s) {
    if (!panel || !s) return; lastState = s;
    const tg = panel.querySelector('#sxz-toggle'); if (tg) tg.innerHTML = (s.running ? ic('pause', 16) : ic('play', 16)) + `<span>${s.running ? '暂停' : '开始'}</span>`;
    const dot = s.running ? '#0f7b6c' : '#9b9a97';
    const keyMark = s.hasKey ? `<span style="color:var(--sxz-accent)">${ic('key', 14)}</span>` : `<span style="color:var(--sxz-err-fg)">${ic('x', 14)}</span>`;
    const v = s.video;
    const meta = panel.querySelector('#sxz-meta');
    if (meta) meta.innerHTML = [
      ['状态', `<span class="sxz-dot" style="background:${dot}"></span><b>${s.running ? '运行中' : '已暂停'}</b> · ${TYPE_LABEL[s.type] || '—'}`, 'class="v"'],
      ['当前', (s.node || '—'), 'class="v"'],
      ['视频', v ? `${fmt(v.cur)} / ${fmt(v.dur)} · ${v.rate}x` : '—', 'class="v clickable" data-act="mute" title="点击切换静音"'],
      ['AI', `${s.model || '—'} ${keyMark}`, 'class="v clickable" data-act="cfg" title="点击打开设置"'],
      ['完成', (s.done || 0) + ' 节', 'class="v"'],
    ].map(([k, val, attr]) => `<div class="k">${k}</div><div ${attr}>${val}</div>`).join('');
    const rateWrap = panel.querySelector('#sxz-rate'); if (rateWrap) rateWrap.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (+b.dataset.r) === (s.rate ?? CFG.rate)));
    const m = panel.querySelector('#sxz-mute'); const muted = s.mute ?? CFG.mute; if (m) { m.classList.toggle('off', !muted); m.innerHTML = (muted ? ic('volx', 15) : ic('vol', 15)) + `<span>${muted ? '静音' : '有声'}</span>`; }
    const st = panel.querySelector('#sxz-status'); if (st) { st.className = s.noteKind || ''; st.innerHTML = (s.busy ? '<span class="sxz-spin"></span> ' : '') + (s.note || '待机'); }
    const noKey = !s.hasKey, cfgOpen = panel.querySelector('#sxz-config').classList.contains('open');
    const banner = panel.querySelector('#sxz-banner'); if (banner) banner.classList.toggle('show', noKey && !cfgOpen);
    const arrow = panel.querySelector('#sxz-arrow'); if (arrow) arrow.classList.toggle('show', noKey && !cfgOpen);
    const gear = panel.querySelector('#sxz-gear'); if (gear) gear.classList.toggle('pulse', noKey && !cfgOpen);
  }

  /* ============================================================ *
   *  控制台 API
   * ============================================================ */
  W.__SXZ = { start, stop, next: advance, solveQuiz, solveExam, onExamPage, KA, autoEvaluate, evalPop: findEvalPopup, netHeartbeat, examRemainSec, examAnswered, readQuestion, detectType, getState, cfg: CFG, state: STATE };

  /* ============================================================ *
   *  启动 / 角色分发
   * ============================================================ */
  installAntiIdle();
  function hasLearnUI() { return !!(q('.tree-node-content') || q('.switch-btn') || q('.catalog-tree')) || onExamPage() || onExamInfoPage(); }

  // 引擎角色:嵌入的 shixizhi 学习帧(非课件查看器),或独立打开 shixizhi 且本窗即学习页
  function startEngine() {
    window.addEventListener('message', (e) => { const d = e.data; if (d && d.__sxz === 'cmd') handleCmd(d.cmd, d.val); });
    installKeepAlive(); // 引擎帧装保活(网络心跳/Worker/WebAudio/合成事件,独立于 tick)
    installExamArm(); // 监听"开始考试/再考一次"真实点击 → 托管考试(无需先开设置)
    pushState();
    setInterval(() => { if (!STATE.running) pushState(); }, 1500); // 暂停时也定期上报状态
    // 考试相关页(examContent/examInfo/examResult)自动开跑引擎:点「开始考试/再考一次」后无需手动点运行即全自动托管(进入/确认/答题/交卷由 progress 内部 arm 门控)
    setInterval(() => { try { if (!STATE.running && !STATE.userStopped && /\/(examContent|examInfo|examResult)\b/.test(location.pathname)) start(); } catch (e) {} }, 1500);
    log('引擎已就绪 @', location.href.slice(0, 70));
  }
  // UI 角色:顶层窗口
  function startUI() {
    window.addEventListener('message', (e) => { const d = e.data; if (d && d.__sxz === 'state') renderState(d.s); });
    let tries = 0;
    const t = setInterval(() => {
      if (panel) { clearInterval(t); return; }
      const hasFrame = !!(q('iframe.sxz-iframe') || qa('iframe').find((x) => /shixizhi/.test(x.src || '')));
      if (hasFrame || engineLocal || (IS_SHIXIZHI && hasLearnUI())) {
        clearInterval(t); buildPanel();
        GM_registerMenuCommand && GM_registerMenuCommand('开始/暂停刷课', () => sendCmd((lastState && lastState.running) ? 'stop' : 'start'));
        log('UI 面板已就绪(顶层) @', location.href.slice(0, 70));
      } else if (++tries > 60) { clearInterval(t); }
    }, 700);
  }

  if (IS_VIEWER) { installKeepAlive(); log('课件查看器子帧,仅防挂机'); return; }      // edm3 等:不建面板、不跑引擎(主帧驱动它)
  if (IS_SHIXIZHI && !IS_TOP) { startEngine(); return; }          // 嵌入的学习帧:纯引擎(startEngine 含 installKeepAlive)
  if (IS_TOP) {                                                   // 顶层:UI(+ 独立打开时本地引擎)
    if (IS_SHIXIZHI) { engineLocal = true; startEngine(); }       // 直接访问 shixizhi 顶层 → 引擎与 UI 同窗(含 installKeepAlive)
    else { bindAudioResume(); }                                   // e.huawei.com 顶层:挂 audio resume 手势(子帧解锁)
    if (!engineLocal) setInterval(() => { try { autoEvaluate(); } catch (e) {} }, 2000); // 顶层不跑 tick → 独立巡评价(评价层可能落在顶层窗口)
    startUI();
  }
})();
