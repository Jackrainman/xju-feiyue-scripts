// ============================================================================
// fixtures.mjs
//
// 用 jsdom 还原「华为小学期」真实官方页面 DOM（基于 CDP 实测结构）。
// 每个导出函数返回 { dom, document, root, window }，root 一般是 document.body
// （脚本里所有 q/qa 都从 document 起，detectType/extractQuestion 也按 body 取文本）。
//
// 重要：jsdom **不实现** Element.innerText（返回 undefined），而用户脚本大量依赖
// innerText。为忠实复现真实浏览器行为，这里给 jsdom 注入一个 innerText polyfill：
// 近似等价于「可见文本」——用 textContent，并把多余空白折叠 / 块级元素间插入换行。
// 这样被测的提取逻辑无需任何改动即可在离线 DOM 上跑出与真实页面一致的结果。
// ============================================================================

import { JSDOM } from 'jsdom';

// 块级标签：innerText 在它们边界处会产生换行（粗略还原）
const BLOCK = new Set([
  'DIV', 'P', 'LI', 'TR', 'BR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE', 'PRE', 'BLOCKQUOTE',
]);

function installInnerText(win) {
  const proto = win.HTMLElement.prototype;
  if (Object.getOwnPropertyDescriptor(proto, 'innerText')) return; // 已有则不覆盖

  function compute(node) {
    let out = '';
    const NODE = win.Node;
    node.childNodes.forEach((child) => {
      if (child.nodeType === NODE.TEXT_NODE) {
        out += child.textContent;
      } else if (child.nodeType === NODE.ELEMENT_NODE) {
        const tag = child.tagName;
        if (tag === 'BR') {
          out += '\n';
          return;
        }
        if (tag === 'SCRIPT' || tag === 'STYLE') return;
        const inner = compute(child);
        if (BLOCK.has(tag)) out += '\n' + inner + '\n';
        else out += inner;
      }
    });
    return out;
  }

  Object.defineProperty(proto, 'innerText', {
    configurable: true,
    get() {
      // 折叠空白，近似浏览器 innerText 的「可见文本」语义
      return compute(this)
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{2,}/g, '\n')
        .replace(/^\n+|\n+$/g, '');
    },
  });
}

function make(html) {
  const dom = new JSDOM(html);
  installInnerText(dom.window);
  return { dom, window: dom.window, document: dom.window.document, root: dom.window.document.body };
}

// ----------------------------------------------------------------------------
// 选项块（option-list-item）构造：还原真实结构
//   <div class="option-list-item"><label class="option-list">…<span class="option-content-wrapper">
//     <div class="option-order-str">A.</div><div class="option-content">…</div></span></label></div>
// ----------------------------------------------------------------------------
function optionItem(letter, text) {
  return `
        <div class="option-list-item"><label class="option-list"><span><em class="exam-icon"><div class="icon-inner"><label class="kltCourse-radio-wrapper"></label></div></em></span><span class="option-content-wrapper"><div class="option-order-str">${letter}.</div><div class="option-content">${text}</div></span></label></div>`;
}

// 答题页通用骨架（contentArea > test-content）
function answerPage({ typeName, index, total, answered, subjectTitle, options, btnText = '下一题' }) {
  return `<!DOCTYPE html><html><body>
<div class="contentArea"><div class="test-content">
  <div class="return-score"><div class="goto-score">&lt;<span>返回</span></div><div class="test-name">随堂测验</div></div>
  <div class="ks-title"><div><span><span class="type-name">${typeName}</span> 第${index}/${total}题 </span></div>
    <div class="submit">已答：${answered} / ${total} <p class="submit-btn">交卷</p></div></div>
  <div class="subject"><div class="subject-title">${subjectTitle}</div>
    <div class="option-list">${options.map((o) => optionItem(o.letter, o.text)).join('')}
    </div></div>
  <div class="subject-btns"><div class="subject-btn">${btnText}</div></div>
</div></div>
</body></html>`;
}

// ----------------------------------------------------------------------------
// 单选题：正确答案 B（《软件需求工程V1.0》第1章随堂测验，5 题）
// ----------------------------------------------------------------------------
export function singleChoicePage() {
  return make(
    answerPage({
      typeName: '单选题',
      index: 1,
      total: 5,
      answered: 0,
      subjectTitle: '1、 在软件开发流程中，需求分析阶段的核心目标是什么？',
      options: [
        { letter: 'A', text: '明确项目预算和团队分工' },
        { letter: 'B', text: '将模糊的想法转化为清晰、可落地的需求' },
        { letter: 'C', text: '设计系统架构和数据库结构' },
        { letter: 'D', text: '完成前后端功能的开发与测试' },
      ],
    })
  );
}

// ----------------------------------------------------------------------------
// 多选题：正确 ABD（4 选项）
// ----------------------------------------------------------------------------
export function multiChoicePage() {
  return make(
    answerPage({
      typeName: '多选题',
      index: 1,
      total: 5,
      answered: 0,
      subjectTitle: '2、 以下哪些属于软件需求工程的主要活动？（多选）',
      options: [
        { letter: 'A', text: '需求获取' },
        { letter: 'B', text: '需求分析与建模' },
        { letter: 'C', text: '编写营销文案' },
        { letter: 'D', text: '需求验证与确认' },
      ],
    })
  );
}

// ----------------------------------------------------------------------------
// 判断题：A.正确 B.错误
// ----------------------------------------------------------------------------
export function judgePage() {
  return make(
    answerPage({
      typeName: '判断题',
      index: 1,
      total: 5,
      answered: 0,
      subjectTitle: '3、 需求规格说明书应当在编码阶段之后才开始编写。',
      options: [
        { letter: 'A', text: '正确' },
        { letter: 'B', text: '错误' },
      ],
    })
  );
}

// ----------------------------------------------------------------------------
// 随堂测验落地页：含「再测一次」按钮 + 及格分/总分等正文 + switch-btn(上一讲/下一讲)
// ----------------------------------------------------------------------------
export function quizLandingPage() {
  return make(`<!DOCTYPE html><html><body>
<div class="contentArea">
  <div class="test-result">
    <div>随堂测验</div>
    <div>6/10</div>
    <div>及格分/总分</div>
    <div>无限制 测验次数</div>
    <div>0</div>
    <div>我的得分（最高分）</div>
    <div>不通过</div>
    <div class="retry-btn">再测一次</div>
  </div>
</div>
<div class="switch-btn"><div class="pre">上一讲</div><div class="next">下一讲</div></div>
</body></html>`);
}

// ----------------------------------------------------------------------------
// 视频页：含 <video> + .vjs-big-play-button（hasVideo 由调用方传 true）
// ----------------------------------------------------------------------------
export function videoPage() {
  return make(`<!DOCTYPE html><html><body>
<div class="player-wrapper">
  <video class="vjs-tech" src="blob:fake"></video>
  <button class="vjs-big-play-button" type="button"><span>播放</span></button>
</div>
</body></html>`);
}

// ----------------------------------------------------------------------------
// 课件页：content-document document-content + edm3client iframe；当前节点「本章课件（可下载）」
// ----------------------------------------------------------------------------
export function coursewarePage() {
  return make(`<!DOCTYPE html><html><body>
<div class="catalog-tree">
  <div class="tree-node-content">视频讲解</div>
  <div class="tree-node-content is-current">本章课件（可下载）</div>
</div>
<div class="content-document document-content"></div>
<iframe src="https://talent.shixizhi.huawei.com/edm3client/static/index.html"></iframe>
</body></html>`);
}

// ----------------------------------------------------------------------------
// 目录：catalog-tree > 多个 tree-node-content，当前项加 is-current
//   curText：当前项文本（默认「随堂测验」）
// ----------------------------------------------------------------------------
export function catalogPage(curText = '随堂测验') {
  return make(`<!DOCTYPE html><html><body>
<div class="catalog-tree">
  <div class="tree-node-content">第一节 课程介绍</div>
  <div class="tree-node-content">视频讲解</div>
  <div class="tree-node-content is-current">${curText}</div>
  <div class="tree-node-content">下一章</div>
</div>
</body></html>`);
}

// ----------------------------------------------------------------------------
// 结课测试目录：当前项文本含「结课测试」
// ----------------------------------------------------------------------------
export function finalTestCatalogPage() {
  return catalogPage('结课测试');
}
