// ============================================================================
// sxz-core.mjs
//
// 这些函数从 feiyue-grinder.user.js 同步拷贝，改动脚本逻辑时需同步本文件。
//
// 用户脚本是脚本猫 IIFE，内部纯逻辑函数未导出。为了离线单测，这里把脚本里的
// **纯逻辑函数**忠实抽取出来并 export，唯一的改动是：把原本依赖全局 document /
// 模块级 BANK 的地方，改成显式接收 document / root / bank 参数（不依赖任何全局）。
//
// 逻辑必须与用户脚本一一对应：
//   - extractOptions  ← readQuestion 内的 options 提取段
//   - extractQuestion ← readQuestion（整段）
//   - parseLetters    ← parseLetters
//   - buildMessages   ← buildMessages
//   - detectType      ← detectType（参数化：root / currentNodeText / hasVideo / autoFinalTest）
//   - currentNodeText ← currentNodeText（参数化：root）
//   - bankLookup      ← bankLookup（参数化：bank / stem）
// ============================================================================

// ---- 与脚本同款的小工具（脚本里是 q / qa / vis），改成接收 root ----
const q = (s, r) => {
  try {
    return (r || globalThis.document).querySelector(s);
  } catch (e) {
    return null;
  }
};
const qa = (s, r) => {
  try {
    return [...(r || globalThis.document).querySelectorAll(s)];
  } catch (e) {
    return [];
  }
};
// jsdom 里没有真实布局，offsetParent 恒为 null，会让所有元素都被判不可见。
// 脚本运行在真实浏览器里 vis() 有意义；离线 DOM 中我们退化为「元素存在即可见」，
// 这样才能在 fixtures 上还原真实页面的提取行为（提取逻辑本身不变）。
const vis = (el) => !!el;

// ============================================================================
// extractOptions(root) ← readQuestion 内 options 提取段
//   从 .option-list-item 提取 [{letter, text}]（脚本里还带 el/label，单测只断言 letter/text）
// ============================================================================
export function extractOptions(root) {
  const items = qa('.option-list-item', root).filter(vis);
  return items
    .map((it) => {
      const ord = q('.option-order-str', it) || q('.option-order', it);
      const con = q('.option-content', it);
      let letter = ord ? (ord.innerText || '').trim().replace(/[^A-Za-z]/g, '').toUpperCase() : '';
      const text = con ? (con.innerText || '').trim() : (it.innerText || '').trim();
      if (!letter) {
        const mm = (it.innerText || '').trim().match(/^([A-Z])\b/);
        letter = mm ? mm[1] : '';
      }
      return { letter, text: text.replace(/^[A-Z][\.、．\s]+/, '').trim(), el: it, label: q('label', it) || it };
    })
    .filter((o) => o.letter);
}

// ============================================================================
// extractQuestion(root) ← readQuestion
//   {type, index, total, answered, options, stem}
// ============================================================================
export function extractQuestion(root) {
  const doc = root && root.ownerDocument ? root.ownerDocument : root;
  const body = (doc && doc.body) || root;

  const typeEl = q('.type-name', root);
  const type = typeEl ? typeEl.innerText.trim() : '单选题';
  const idxM = ((body && body.innerText) || '').match(/第\s*(\d+)\s*\/\s*(\d+)\s*题/);
  const index = idxM ? +idxM[1] : 1,
    total = idxM ? +idxM[2] : 1;
  const ansM = ((body && body.innerText) || '').match(/已答[:：]?\s*(\d+)\s*\/\s*(\d+)/);
  const answered = ansM ? +ansM[1] : 0;

  const options = extractOptions(root);

  // 题干容器:优先「.type-name 最近的含 .option-list-item 祖先块」(结课考试 live 页无 .test-content,fallback body 会吞答题卡)
  let stemRoot = null;
  if (typeEl) { let box = typeEl.parentElement, hop = 0; while (box && box.querySelectorAll('.option-list-item').length === 0 && hop < 10) { box = box.parentElement; hop++; } stemRoot = box; }
  stemRoot = stemRoot || q('.test-content', root) || q('.contentArea', root) || body;
  let full = ((stemRoot && stemRoot.innerText) || '').replace(/\s+/g, ' ');
  options.forEach((o) => {
    if (o.text) full = full.split(o.text).join(' ');
  });
  full = full
    .replace(/尝试键盘方向键[，,]?\s*切换上下题吧/g, ' ')
    .replace(
      /返回|随堂测验|结课测试|单选题|多选题|判断题|填空题|已答[:：]?\s*\d+\s*\/\s*\d+|剩余时间[：:]\s*[\d:：]+|满分[：:]\s*\d+\s*分|及格[：:]\s*\d+\s*分|交卷|下一题|上一题|上一讲|下一讲|存疑|收藏|标记|第\s*\d+\s*\/\s*\d+\s*题|[A-Z][\.、．](?=\s)/g,
      ' '
    ).replace(/[<>＜＞]|&[lg]t;/g, ' ');
  const stem = full.replace(/\s+/g, ' ').trim().replace(/^\s*\d+\s*[、．.，]\s*/, '').slice(0, 600);
  return { type, index, total, answered, options, stem };
}

// ============================================================================
// buildMessages(qd) ← buildMessages
// ============================================================================
export function buildMessages(qd) {
  const multi = /多选/.test(qd.type),
    judge = /判断/.test(qd.type);
  const lines = qd.options.map((o) => `${o.letter}. ${o.text}`).join('\n');
  let rule = multi
    ? '这是多选题,可能有多个正确答案,输出所有正确选项字母(如 ABD),字母间不加任何分隔或空格。'
    : '这是单选题,只输出唯一正确选项的字母(A/B/C/D 其一)。';
  if (judge) rule = '这是判断题,只输出正确选项的字母(对应"正确/错误"的字母,如 A 或 B)。';
  return [
    { role: 'system', content: '你是严谨的中文选择题答题助手。只输出选项字母,不要解释、不要标点、不要多余文字。' },
    { role: 'user', content: `${rule}\n\n题目:${qd.stem}\n${lines}\n\n只回答字母:` },
  ];
}

// ============================================================================
// parseLetters(content, qd) ← parseLetters
// ============================================================================
export function parseLetters(content, qd) {
  const valid = qd.options.map((o) => o.letter);
  let got = (('' + content).toUpperCase().match(/[A-Z]/g) || []).filter((l) => valid.includes(l));
  if (!got.length) {
    for (const o of qd.options) {
      if (o.text && content.includes(o.text)) got.push(o.letter);
    }
    if (/正确|对|是|√|true/i.test(content) && !got.length) {
      const t = qd.options.find((o) => /正确|对/.test(o.text));
      if (t) got.push(t.letter);
    }
    if (/错误|错|否|×|false/i.test(content) && !got.length) {
      const f = qd.options.find((o) => /错误|错/.test(o.text));
      if (f) got.push(f.letter);
    }
  }
  if (!/多选/.test(qd.type)) got = got.slice(0, 1);
  return [...new Set(got)];
}

// ============================================================================
// currentNodeText(root) ← currentNodeText
// ============================================================================
export function currentNodeText(root) {
  const c = q('.tree-node-content.is-current', root);
  return c ? (c.innerText || '').trim().replace(/\s+/g, ' ') : '';
}

// ============================================================================
// detectType({root, currentNodeText, hasVideo, autoFinalTest}) ← detectType
//
// 脚本原版用全局：cur = currentNodeText()、findVideos()、document.body.innerText、
// findByText(/^再测一次$/)、q('.submit-btn')、q('.type-name')、q('.content-document') 等。
// 这里参数化：
//   - currentNodeText：调用方传入（对应脚本的 cur）
//   - hasVideo：调用方传入（对应脚本 findVideos().length，jsdom 无媒体元素布局）
//   - autoFinalTest：对应脚本 CFG.autoFinalTest
//   - root：用于 querySelector / body.innerText / findByText
// 其余判定逻辑严格照搬。
// ============================================================================
// v2.7:类型以目录当前节点名为准(可靠;残留 DOM 不干扰)。返回 loading/final/courseware/quiz/video。
export function detectType({ currentNodeText: cur = '', autoFinalTest = false } = {}) {
  if (!cur) return 'loading';
  if (/结课测试|期末|结业考试/.test(cur)) return autoFinalTest ? 'quiz' : 'final';
  if (/课件/.test(cur)) return 'courseware';
  if (/随堂测验|测验/.test(cur)) return 'quiz';
  return 'video';
}
// 该类型内容是否就绪(切换瞬间未就绪需等待)。root=帧 document;hasVideo 由调用方传(jsdom 无媒体布局)。
export function contentReady(type, { root, hasVideo = false } = {}) {
  if (type === 'video') return !!hasVideo;
  if (type === 'courseware') return !!(root && (root.querySelector('.content-document') || root.querySelector('.courseware-wrapper')));
  if (type === 'quiz') { if (!root) return false; const bt = (root.body && root.body.innerText) || root.textContent || ''; return !!(root.querySelector('.type-name') || findByText(root, /^再测一次$/) || /及格分\s*\/\s*总分|测验次数|我的得分/.test(bt)); }
  return true;
}

// ============================================================================
// bankLookup(bank, stem) ← bankLookup
//   脚本原版用模块级 BANK；这里参数化为 bank。
//   命中返回字母数组（value 可为 "B" 或 ["A","C"]），否则 null。
// ============================================================================
export function bankLookup(bank, stem) {
  if (!stem) return null;
  const norm = (s) => (s || '').replace(/\s+/g, '').replace(/[，。、？?.,;；:：]/g, '');
  const ns = norm(stem);
  for (const k in bank) {
    const nk = norm(k);
    if (nk && (ns.includes(nk) || nk.includes(ns))) {
      const v = bank[k];
      return Array.isArray(v) ? v.map((x) => ('' + x).toUpperCase()) : (String(v).toUpperCase().match(/[A-Z]/g) || []);
    }
  }
  return null;
}

/* ===== v2.6 测验导航/选择逻辑(从用户脚本同步;改脚本时同步本节) ===== */
// 选中态判定:选项内有 checked/active/selected/current 后代或 input:checked
export function isSelected(el) {
  try {
    return !!(el && (/checked|active|selected|current/i.test('' + el.className) ||
      el.querySelector('[class*=checked],[class*=active],[class*=selected],[class*=current],input:checked')));
  } catch (e) { return false; }
}
// 按文字找可点元素(叶子)。注意:"下一题"必须按文字找——.subject-btn 首个常是"上一题"。
export function findByText(root, re, tags) {
  return [...root.querySelectorAll(tags || 'div,span,button,a,p,li')]
    .find((el) => el.children.length <= 1 && re.test(((el.innerText || el.textContent) || '').trim()));
}
// 纯逻辑:给定选项(含 sel 选中态)+ 目标字母 want + 是否多选 → 该点哪些(未选中的目标)/该取消哪些(多选里非目标的已选)
export function selectionPlan(options, want, multi) {
  const click = want.filter((L) => { const o = options.find((x) => x.letter === L); return o && !o.sel; });
  const deselect = multi ? options.filter((o) => o.sel && want.indexOf(o.letter) < 0).map((o) => o.letter) : [];
  return { click, deselect };
}

/* ===== v2.8 云题库:按"正确选项内容"匹配出字母(防选项乱序) ===== */
// 归一化:去空白+标点+小写(与用户脚本 normStem 一致)
export function normStem(s) {
  return ('' + (s || '')).toLowerCase().replace(/[\s　、，。；：！？,.;:!?（）()【】\[\]《》<>{}"'`~·…—_\/\\|=+*&^%$#@\-]+/g, '').slice(0, 200);
}
// 给定当前题(options:[{letter,text}])与"正确选项内容数组",返回应选的字母(精确归一化优先 + 高重叠子串兜底)
export function lettersFromTexts(qd, texts) {
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

/* ===== v2.10 模型下拉(对齐 Solver/希冀):缓存+建议+「其他/自定义…」兜底 =====
   与用户脚本一一对应。唯一改动同上：参数化——
   - modelOptions  ← 脚本里直接读 getModelsCache()/CFG/activeProvider；这里显式收 {cache,suggest,current,providerDefault}
   - fillModelSelect ← 脚本里 list=modelOptions() 内部算、用全局 document；这里显式收 doc 与 list
   - pickModel     ← 完全一致 */
export const OTHER = '__other__';
// 去重并入建议(filter(Boolean) 去掉空串)
export function modelOptions({ cache = [], suggest = [], current = '', providerDefault = '' } = {}) {
  return [...new Set([...cache, ...suggest, current, providerDefault].filter(Boolean))];
}
// 命中→走下拉;未命中但有值→选「其他」并把值塞进文本框露出来;空值→选首项
export function fillModelSelect(doc, sel, inp, value, list) {
  if (!sel) return;
  const inList = list.includes(value);
  sel.innerHTML = '';
  [...list, OTHER].forEach((m) => { const o = doc.createElement('option'); o.value = m; o.textContent = m === OTHER ? '其他 / 自定义…' : m; sel.appendChild(o); });
  sel.value = inList ? value : (value ? OTHER : (list[0] || OTHER));
  if (inp) { inp.value = inList ? '' : (value || ''); inp.style.display = sel.value === OTHER ? 'block' : 'none'; }
}
// 保存时取值:选「其他」读文本框、否则读下拉;都空回退 fallback
export function pickModel(sel, inp, fallback) {
  if (!sel) return fallback;
  return (sel.value === OTHER ? (inp ? inp.value.trim() : '') : sel.value) || fallback;
}
