# 开发文档（DEVELOPMENT）

两个 AI 脚本（`feiyue-solver` / `feiyue-grinder`）都是单文件 Tampermonkey IIFE（`@grant GM_*`，靠 `GM_xmlhttpRequest` 跨域调 AI/题库），通过 `feiyue.selab.top` 分发。共享代码（`callLLM`、Notion 设计令牌、lucide 图标、`makeDraggable`）目前**各脚本内联**，不抽不构建（见 [CONVENTIONS](../CONVENTIONS.md)）。第三个脚本 `feiyue-importer`（飞跃·导入）是 `@grant none` 的纯页面脚本（无 AI、行为等同书签），架构独立，见 [`scripts/feiyue-importer/README.md`](../scripts/feiyue-importer/README.md)。

---

## 一、飞跃·刷课 Grinder（华为实习汁）架构

`scripts/feiyue-grinder/feiyue-grinder.user.js`（~1260 行）。

### 1.1 平台事实（CDP 实测）
- 课程页 `e.huawei.com/.../sxz-course/home` 内嵌**跨域同进程 iframe** `talent.shixizhi.huawei.com/.../application-learn`（视频/目录/随堂测验都在此帧）→ 脚本 `@match shixizhi`。
- **结课考试是独立路由 `talent.shixizhi.huawei.com/iexam/<cid>/examContent`、独立标签**，没有 application-learn 帧、没有目录树，有 `.exam-watermark`。
- 选项组件统一 `.option-list-item`（内 `.option-order-str`=字母、`.option-content`=内容），题型 `.type-name`。

### 1.2 角色分发（脚本末尾）
`HOST`/`PATH` 判定 `IS_TOP` / `IS_SHIXIZHI` / `IS_VIEWER`：
- 课件查看器子帧（`edm3client`）→ 仅装防挂机。
- 嵌入的学习帧（shixizhi 非顶层）→ `startEngine()`（纯引擎）。
- 顶层 e.huawei → UI 面板；顶层直接访问 shixizhi → 引擎+UI 同窗（`engineLocal`）。
- 顶层与帧之间 `postMessage` 通信（顶层发 cmd → `iframe.sxz-iframe`；帧 → `parent.postMessage` 状态）。

### 1.3 主循环
`start()` → `setInterval(tick, 1000)`。`tick()`：驱动视频 + 防挂机 + 课程评价弹窗 + `progress()`。
`progress()`（被 `STATE.busy` 串行化）按页面类型分支：
1. **复盘只读页**（`isExamReviewPage`，examContent 路由但含「正确答案/我的得分」）→ 绝不作答。
2. **结课考试**（`onExamPage` / `onExamInfoPage` / `onExamResultPage`）→ `solveExam` / 处理须知 / 引导「再考一次」。
3. 否则按**目录当前节点文本** `detectType` → video / courseware / quiz / final / loading。**类型以节点名为准**（DOM 元素残留会误判，见 TROUBLESHOOTING）。

### 1.4 答题来源链（`getAnswer`）
**题库优先**：① 本场已知正确（`STATE.correctByStem`，存正确选项内容）→ ② 本地题库（GM `sxz_bank`，字母制）→ ③ **云题库**（`bankRemoteSearch` 返回正确选项**内容**数组，用 `lettersFromTexts` 在当前题按内容匹配出字母，**防选项乱序**）→ ④ AI（同一对话，含上下文）。
- `CFG.answerSource`：`ai_bank`（默认=题库优先+AI兜底）/ `bank`（仅题库）/ `ai`（仅AI跳过题库）。
- 状态栏分阶段：查题库=「题库搜索中」、调 AI=「AI 思考中」。
- 结课考试交卷后 `reportExamSrc` 汇总「题库命中 X / AI 解 Y」。

### 1.5 结课考试模块（`solveExam`）
进入前 `examPreflight`（题库 `/health` 探活 + Key 检查）→ 逐题作答（单选不自动跳，下一题=`.subject-btn` 按文字找）→ 答题卡补全 → **防废卷**（命中<40% 不交卷、暂停）→ **答题用时<10min 等够再交** → `examSubmit`（点 `.hand-exams-btn` + `examConfirmBtn` 点确认弹窗，排除「继续作答」）。`CFG.force`=强制重答（已答/已满分也重做）。`@updateURL` 真实点击「开始考试/再考一次」→ `armExam`（GM 标记 3 分钟）→ 新标签自动托管（无需先开设置）。

### 1.6 后端 `feiyue-grinder-bank/`
`bank_server.py`（stdlib `http.server` + `sqlite3`，无三方依赖）+ `Dockerfile`。生产跑 huawei2，nginx `/feiyue-grinder-bank/` 反代 → `https://feiyue.selab.top/feiyue-grinder-bank`。
- 表 `answers(stem_norm, stem, qtype, ans_texts JSON, ans_key, votes, UNIQUE(stem_norm,ans_key))`，**存正确选项内容**（防乱序），`norm()` 去空白+标点+小写。
- `GET /search?q=&type=`（精确 stem_norm 或双向子串模糊 ratio≥0.82，votes 最高）、`POST /add{stem,qtype,texts[]}`（UPSERT votes++，只入满分确认的）、`GET /stats`、`GET /health`。

---

## 二、飞跃·解题 Solver（CourseGrading）架构

详见 [scripts/feiyue-solver/README.md](../scripts/feiyue-solver/README.md)（已含完整接口契约）。要点：
- 提取题面（DOM）→ `POST <BaseURL>/chat/completions`（`max_tokens=8192,temperature=0`，DeepSeek 带 `thinking`）→ **`GM_xmlhttpRequest` multipart 直 POST 到 `showProcessMsg.jsp`**（不走页面提交按钮）→ 轮询 `longtimerunJSON.jsp`（GBK 解码）判题。
- 三题型：普通编程 / 程序填空 / 接口实现。跨页状态机「一键开刷」，进度存 `GM_setValue`，队列键 **`assignID|页型|proNum`**。
- 失败纠错：读判题错误样例 → 追加同一对话 → 同模型纠正 → 最后一版才升强模型；单题 ≤180s。

---

## 三、开发流程

1. 直接编辑 `scripts/<名>/*.user.js`（单文件，无构建）。改被测纯函数 → 同步 `feiyue-grinder/tests/sxz-core.mjs`。
2. **自增 `@version`**。
3. 测试：`cd scripts/feiyue-grinder/tests && npm i && node --test *.mjs`；`node -c <脚本>` 语法。
4. `git commit`（message 体现脚本+版本）。
5. `bash deploy/deploy.sh`（本机推 feiyue）。
6. 回源验证：`curl -A Mozilla '.../feiyue-grinder.user.js?v=<版本>' | grep @version`，`cf-cache-status: MISS` 即最新。

### 测试（jsdom + node:test）
- `tests/sxz-core.mjs` 是从脚本**手工抽取的纯函数拷贝**（`extractQuestion`/`parseLetters`/`detectType`/`lettersFromTexts`/`normStem`…），改脚本逻辑必同步。
- `fixtures.mjs` 用 jsdom 还原真实页面 DOM；各 `test-*.mjs` 断言提取/解析/判定/题库匹配/考试导航/防全A/复盘防护等。
- solver 的 `test-extract.mjs` 需外部 GBK fixtures（`/tmp/cgtest/`），属 xiji 既有设置。

---

## 四、部署

唯一部署源是 `deploy/`，**本机执行**（链路 本机 →`win-wsl2`(ssh -p 2222)→`huawei2`(二跳)→`~/public-scripts/`，nginx `aurash-tunnel` 精确 `location = /xxx.user.js` 提供）。

- `deploy/deploy.sh [--dry-run] [过滤]`：遍历 `scripts/*/*.user.js` 推到 huawei2。
- `deploy/ensure-nginx-locations.sh`：在 huawei2 以 root 跑，幂等加精确 location（**新增脚本首次必跑**，否则该 URL 落到 SPA fallback 返回 HTML）。
- `deploy/deploy-bank.sh`：仅改后端时用，重建容器**保留 `/data` 卷**。
- Cloudflare 边缘缓存 4h → `?v=<版本>` 验证回源。

---

## 五、CDP 调试工具（win-wsl2 `/tmp/`，开发期）

win-wsl2 上 GUI Chrome（`DISPLAY=:0`，`--user-data-dir=~/.config/google-chrome-shuake`，`--remote-debugging-port=9333 --remote-allow-origins=*`），用于驱动华为实习汁实测。常用临时脚本（WSL 重启 /tmp 会清，需重建）：
- `cdp_world.py <帧过滤>`：在指定帧的隔离世界跑 JS（`sxz-course`=顶窗 / `application-learn`=引擎帧 / `examContent`=考试帧）。
- `cdp_open_analyze.py <url>`、`cdp_trusted_click*.py`（`Input.dispatchMouseEvent` 可信点击，window.open 弹窗只能靠它或真人）。
- `window.__SXZ`（grinder 暴露）：`readQuestion()` 读 live 题、`state.examSrcStat` 看来源计数、`getState()`。
- 结果页复盘**翻题靠键盘方向键**（`Input.dispatchKeyEvent` ArrowUp/Down），不是按钮。
- 探网络可达性：页面里 `fetch(url, {mode:'no-cors'})`（GM 不能从注入 eval 调，故用 fetch 判网络）。

> 启动 Chrome 前清 `Singleton*` 锁；从带 `http_proxy` 的 shell 启动会**继承代理**（见 TROUBLESHOOTING）。
