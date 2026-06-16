// 从真实脚本抽 CSS + 同套图标，生成 v2 预览：①开刷进行中主面板 ②配置浮层。
import fs from 'fs';
const src = fs.readFileSync(new URL('./feiyue-solver.user.js', import.meta.url), 'utf8');
let css = src.match(/GM_addStyle\(`([\s\S]*?)`\);/)[1].replace(/\\\\/g, '\\');

const svg = (p, s) => `<svg class="cgai-svg" width="${s || 16}" height="${s || 16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const I = {
    brand: svg('<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>'),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', 15),
    minus: svg('<path d="M5 12h14"/>'),
    run: svg('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', 15),
    grind: svg('<path d="m12 19-7-7 3-3 7 7-3 3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18z"/><path d="m2 2 7.586 7.586"/><circle cx="11" cy="11" r="2"/>', 15),
    stop: svg('<rect x="6" y="6" width="12" height="12" rx="1"/>', 15),
    ok: svg('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>', 15),
    warn: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 15),
    err: svg('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>', 15),
    skip: svg('<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>', 14),
    file: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M16 13H8"/><path d="M16 17H8"/>', 14),
};
const grow = (k, t, cls, ic, s) => `<div class="cgai-grow ${cls}"><span>${ic}</span><span class="gk">${k}</span><span class="gt">${t}</span><span class="gs">${s}</span></div>`;

function page(bodyExtra, configOpen) {
    const grindList = [
        grow('51:1', '字母频率统计2', 'ok', I.ok, '5/5'),
        grow('51:2', '数值变换', 'ok', I.ok, '5/5'),
        grow('51:3', '最大公约数', 'skip', I.skip, '跳过'),
        grow('51:4', '字符串反转', 'fail', I.warn, '3/5'),
        `<div class="cgai-grow cur"><span class="cgai-spin"></span><span class="gk">51:5</span><span class="gt">处理中…</span><span class="gs"></span></div>`,
    ].join('');
    const panel = `
  <div id="cgai-panel">
    <div id="cgai-head">
      <div class="cgai-brand"><span class="cgai-badge">${I.brand}</span>
        <span class="cgai-titles"><b>CG AI 解题</b><i>DeepSeek 自动解题 · 开刷</i></span></div>
      <span class="cgai-tools"><span class="cgai-ic">${I.settings}</span><span class="cgai-ic">${I.minus}</span></span>
    </div>
    <div id="cgai-body">
      <div class="cgai-settings">
        <button class="cgai-model">${I.settings}<span>deepseek-v4-flash</span></button>
        <label class="cgai-chk"><input type="checkbox"> 思考模式</label>
        <label class="cgai-chk"><input type="checkbox" checked> 自动提交</label>
        <label class="cgai-chk"><input type="checkbox" checked> 跳过已满分</label>
        <label class="f">重试次数 <input type="number" value="3" min="1" max="5"></label>
      </div>
      <div class="cgai-btns">
        <button class="cgai-btn cgai-btn-primary">${I.run}<span>解本题</span></button>
        <button class="cgai-btn cgai-btn-danger">${I.stop}<span>停止开刷</span></button>
      </div>
      <div id="cgai-title">${I.file}<span>5. 矩阵转置</span></div>
      <div id="cgai-status" class="busy"><span class="cgai-spin"></span>开刷 51:5：第 2/3 版（deepseek-v4-flash·思考）…</div>
      <div id="cgai-grind"><div class="cgai-ghead"><span>开刷进行中 · 作业 51/52/53/54</span><span>满分 3/4</span></div><div class="cgai-glist">${grindList}</div></div>
    </div>
    <div id="cgai-config"${configOpen ? ' class="open"' : ''}>
      <div class="cfg-head"><div><b>配置</b> <span class="sub">OpenAI 兼容</span></div><span class="cgai-ic">${I.minus}</span></div>
      <div class="cfg-body">
        <div class="cgai-field"><label>API Base URL</label><input type="text" value="https://api.deepseek.com"><span class="hint">会调用 &lt;BaseURL&gt;/chat/completions。换成其他 OpenAI 兼容服务即可（DeepSeek 时才发送 thinking 参数）。</span></div>
        <div class="cgai-field"><label>API Key</label><input type="password" value="sk-xxxxxxxxxxxxxxxx"></div>
        <div class="cgai-field"><label>主模型</label><input type="text" value="deepseek-v4-flash"></div>
        <div class="cgai-field"><label>重试强模型（可选，失败时升级用）</label><input type="text" value="deepseek-v4-pro"></div>
      </div>
      <div class="cgai-btns"><button class="cgai-btn cgai-btn-primary">保存</button><button class="cgai-btn cgai-btn-ghost">取消</button></div>
    </div>
  </div>`;
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  body{margin:0;min-height:100vh;background:#fbfbfa;background-image:radial-gradient(circle at 1px 1px, rgba(55,53,47,.06) 1px, transparent 0);background-size:22px 22px}
${css}
  #cgai-panel{position:absolute;right:48px;top:40px;max-height:none}
</style></head><body>${panel}</body></html>`;
}

fs.writeFileSync(new URL('./preview.html', import.meta.url), page('', false));
fs.writeFileSync(new URL('./preview-config.html', import.meta.url), page('', true));
console.log('wrote preview.html + preview-config.html');
