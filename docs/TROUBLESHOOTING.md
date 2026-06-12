# 踩坑记录 & 解法（TROUBLESHOOTING）

按区域记录已遇到的问题、根因与解法。改动相关代码前先读对应条目，避免重蹈覆辙。格式：**现象 → 根因 → 解法（版本）**。

---

## 一、飞跃·刷课 Grinder · 结课考试

### ★ 题库永远 0 命中 / 整卷「全选 A」
- **现象**：结课考试每题都选 A，得分极低；明明题库里有这些题。
- **根因（CDP 实测）**：`readQuestion` 取题干的容器是 `.test-content || .contentArea || document.body`，但**结课考试 live 页根本没有 `.test-content`/`.contentArea`** → fallback 到 `body` → 题干被读成整页垃圾（「姓名/考号/剩余时间/第1题…第50题答题卡」），不是真正题目文字 → 拿垃圾查题库永远不命中 → 落到 AI；AI 又失败（额度用完/网络）就触发兜底「绝不留空→选第一项 A」。**注意**：全选清一色 A ＝ 没拿到任何答案；若是「选项解析选错」会是各种错误字母而非全 A。
- **解法（v2.9.11）**：题干容器改用 **`.type-name` 最近的、含 `.option-list-item` 的祖先块**（实测 `.right-subjects-inner`，只含 题型+题干+选项+本题导航），与入库 harvest 同款；并 strip 「尝试键盘方向键/存疑/收藏/剩余时间」+ 去题号前缀 `^\d+、`。`extractQuestion`（sxz-core）同步，加 test 复刻 live DOM。
- **诊断手段**：`window.__SXZ.readQuestion()` 读 live 题干；`window.__SXZ.state.examSrcStat` 看来源（`云题库`/`AI`/`AI失败`）。

### 防「全 A 废卷」白白浪费考试次数
- **现象**：来源失效时还是把全 A 卷自动交了，浪费一次机会。
- **解法（v2.9.10）**：① 答题前 `examPreflight`（题库 `/health` 探活 + Key 检查），按 `answerSource` 确认至少一个来源可用，否则**暂停不答**；② 交卷前若真实命中（题库/AI 成功）< 40% → **不自动交卷**、暂停报错。

### 自动交卷没点掉二次确认弹窗 = 没真正交上
- **现象**：点了「交卷」但没提交成功。
- **根因**：交卷有二次确认框（常是「继续作答 / 确认交卷」并排）。
- **解法（v2.9.5）**：`examConfirmBtn` 循环找确认按钮，**明确排除「继续作答/取消/返回/放弃」**，命中「确认交卷/确定/提交」或 Ant `.ant-btn-primary`，直到离开作答页/出成绩才算成功。

### 考试页「暂停」按不灭
- **现象**：点暂停后 1~2 秒又自己跑起来。
- **根因**：v2.9.4 加的「考试页自动开跑 watcher」（每 1.5s 在 examContent/examInfo/examResult 路径 `!running` 就 `start()`）把手动暂停又启动了。
- **解法（v2.9.9）**：加 `STATE.userStopped`，`stop()` 置 true（并中断在飞 AI `STATE._xhr.abort()`、清 `examRunning`），watcher 加 `!STATE.userStopped` 守卫。

### 答题用时太短被判异常
- **解法（v2.9.10）**：自动交卷前若**答题用时 < 10min** 等够再交（用户可随时手动交）。用时取 `examTotalSec(=max 剩余) - 当前剩余`（平台计时），墙钟 `examStartMs` 兜底。

### 复盘页被误当作答页去「作答」
- **根因**：答题详情/复盘也走 `examContent` 路由、也有 `.type-name`。
- **解法（v2.9.3/2.9.4）**：`isExamReviewPage`（body 含**每题级**「正确答案：X / 我的得分：」）→ `onExamPage` 否决、`progress` 顶部拦截。注意结果**汇总**页的「答题详情/考试报告」是按钮文字、得分叫「您的得分」，不能用来判复盘（早期误判过）。

### 「开始考试 / 再考一次」打不开 / 不托管
- **根因**：「开始考试」经 `window.open` 开新标签，**合成点击/CDP 可信点击都被弹窗拦截** → 必须真人点；且 `startEngine` 只装监听不 `start()`，新考试页引擎是停的。
- **解法**：真实点击 → `installExamArm`（`EXAM_ARM_RE` 含「开始考试/再考一次/重新考试…」）写 GM 标记（3 分钟）→ 新页 watcher 自动 `start()` → 全自动托管（无需先去设置勾选）。

---

## 二、飞跃·刷课 Grinder · 随堂测验 / 课程

### 交空卷 / 只剩最后一题有答案
- **现象**：明明看到 5 题都有勾选动画，提交后前 4 题空着。
- **根因（CDP 抓包铁证）**：平台**不每题保存**，交卷时发 ONE 个 `POST .../useranswer/v1/answer`，body `examAnswerList` ＝【客户端模型里所有已答题】；顶部「已答 X/Y」＝客户端模型。旧版单选「取消所有已选」在自动跳过渡瞬间误删了模型里的答案 → 批量缺题。
- **解法（v2.7.6）**：单选/判断**绝不「取消所有」**（平台 radio 互斥，点新目标自动灭旧）；`await getAnswer` 后校验题号没变才落点（`freshOpt` 实时按字母取节点）；交卷前 `countersStable` 校验已答==总数，缺则 `fillBackward`（用「上一题」回退、记账答案补齐，**绝不重调 AI**）。

### 跨章节乱跳（第1章随堂测验 → 第4章）
- **根因**：平台「下一讲」按钮在章节边界会乱跳。
- **解法（v2.7.7）**：**节点驱动 advance**——目录树全展开，叶子节点 = `.header-icon use` 的 `xlink:href` 含 `icon-catalog-(video|edm-document|quiz|exam)`，章节/子标题跳过，已完成（`i.anticon-check`）跳过；`clickReal` 直接点目标节点，不用平台下一讲。

### 课件「无翻页控件」/ 测验「直接交卷」/ 加载卡死
- **根因**：`.submit-btn`/`<iframe>`/`<video>` 在多种页面**常驻残留**，靠 DOM 元素判类型会误判。
- **解法（v2.7）**：`detectType` 改以**目录当前节点名**（`.tree-node-content.is-current` 文本）为准；各处理器内部自等加载（去掉中央就绪门槛，避免卡「加载中」）。课件要**滚动翻完每一页**（edm3 同域帧滚 `.wrapper` 到底）；doCourseware 前轮询等翻页控件出现（~13s）。

### 视频目录 ✓ 不出现（要刷新才显示）
- **解法**：播到真 `ended` 后，等目录该节点出现 `i.anticon-check`（真完成）再切，最多等 8s。

### 状态栏分不清是题库还是 AI 答的
- **解法（v2.9.9）**：`getAnswer(qd, label)` 分阶段 setNote：查题库=「题库搜索中」、调 AI=「AI 思考中」；交卷后 `reportExamSrc` 汇总「题库命中 X / AI 解 Y」。

### 想强制重做已答 / 已满分
- **解法（v2.9.12）**：设置「强制重答」`CFG.force`——`solveExam`/`examFillUnanswered` 已答也重做、`solveQuiz` 已满分也不跳。

### 浏览器最小化被登出 / 课程评价弹窗
- **解法（v2.9.1）**：`installKeepAlive` 防挂机（record-replay 网络心跳重放最后 same-origin GET、Worker ticker、WebAudio 静音、合成事件）。`autoEvaluate` 自动点星+提交（4 重 AND 守卫防误触）。

---

## 三、飞跃·解题 Solver（CourseGrading）

### 「三次同一报错」/ 重试没真正提交
- **根因**：页面提交按钮提交后会被 `disable`，重试时新代码没真正提交。
- **解法**：用 `GM_xmlhttpRequest` **multipart 直 POST 到 `showProcessMsg.jsp`**（不走页面按钮）。

### 同一作业多题型丢题 / 冲突
- **根因**：同一作业可同时有填空+接口题，`proNum` 跨题型重复。
- **解法**：开刷队列项用 **`assignID|页型|proNum`** 唯一标识。

### DeepSeek 返回 `content` 为空
- **根因**：v4 是推理模型，`max_tokens` 给不足会导致空。
- **解法**：`max_tokens=8192`；判题新鲜度用「最后一次提交时间」判断（修复重复提交内容相同时卡死）。

### 接口题 duplicate class / 跨域请求挂起
- **解法**：接口题**不重定义评测已提供的接口**；脚本猫首次会提示「允许跨域连接」到 API 域名，**必须点允许**否则请求一直挂起。

> 更多见 [scripts/feiyue-solver/README.md](../scripts/feiyue-solver/README.md) 的「工作原理」。

---

## 四、共享云题库 sxz-bank

- **选项乱序导致按字母选错** → 题库**存正确选项内容**（非字母），`lettersFromTexts` 在当前题按内容（归一化精确 + 高重叠子串）匹配出字母。
- **题库被脏数据污染** → 只入「满分确认正确」的题；`UNIQUE(stem_norm,ans_key)` 去重 votes++。
- **结课考试是大题库随机抽 50**（两次仅 ~11 题重叠）→ 单次入库覆盖率低，需**每次考完从结果页采全 50 正确答案入库**累积。结果页采集：examInfo 点考试记录 → examResult → 「答题详情」→ examContent 复盘，**翻题靠键盘方向键**，每题显示「正确答案：X」（字母）+ 选项，字母映射到内容入库。

---

## 五、部署 / 基础设施

### Tampermonkey 永不自动更新（卡在旧版本）
- **现象**：连发好几版，用户浏览器一直是老版本、新功能全没生效。
- **根因**：脚本头**缺 `@updateURL`/`@downloadURL`** → TM 不知去哪查更新，冻结在首次安装版本。
- **解法（v2.9.7）**：头部加 `@updateURL`+`@downloadURL` 指向 feiyue 裸链接。**诊断「新功能没生效」先 CDP 读面板版本**（`document.querySelector('.titles i').innerText`），别假设用户已更新。首次仍需手动开 `?v=` 链接重装一次。

### 改名后老用户丢配置
- **根因**：Tampermonkey 用 `@name`+`@namespace` 作身份，改了当成新脚本，老用户丢 API Key 等。
- **解法**：有安装用户后**冻结** `@name`/`@namespace`/技术 ID；仅内测期（无用户）可对齐改名（本仓即在内测期把 ID 统一成 `feiyue-solver`/`feiyue-grinder`）。

### 二跳 scp 超慢 / 超时
- **根因**：`scp ... && ssh huawei2 "..."` 链式命令很慢。
- **解法**：拆成**单条** `scp /tmp/f huawei2:~/public-scripts/`（单条很快）；huawei2 侧操作用持久 ssh 会话直接跑。

### 新 URL 返回 HTML 而非脚本
- **根因**：nginx 缺该文件的精确 `location = /xxx.user.js`，落到 Aurash SPA 的 `location /` fallback。
- **解法**：每个脚本一条精确 location（`deploy/ensure-nginx-locations.sh` 幂等加）；删了文件但留 location ＝ 干净 404（比删 location 落到 SPA 返回 200 HTML 更好）。

### Cloudflare 缓存 / UA 拦截
- 裸链接边缘缓存 4h → 更新后用 `?v=<版本>` 验证，`cf-cache-status: MISS` 才是回源最新。
- CF **挡 `Python-urllib` UA（403）**，放行 curl/浏览器/GM UA → 脚本/调试用浏览器 UA。

### Docker / sudo
- Docker Hub i/o timeout → 用 `docker.m.daocloud.io` 镜像源拉基础镜像再 tag。
- huawei2 sudo 间歇极慢、会话重建会丢 sudo 缓存 → 给大超时、必要时让用户重新注入。

---

## 六、Chrome / CDP 调试（开发期）

### Chrome 继承代理导致请求慢/不稳
- **现象**：题库 4s 超时全挂、AI 时好时坏。
- **根因**：从带 `http_proxy=127.0.0.1:10808` 的 shell 启动 Chrome 会**继承代理**；feiyue/aiapis 走代理可能慢/不稳（本次实测带不带代理都可达，但要留意）。
- **诊断**：`cat /proc/<pid>/environ | grep -i proxy` 看 Chrome 是否带代理；页面里 `fetch(url,{mode:'no-cors'})` 探网络可达性（GM 不能从注入 eval 调）。

### window.open 弹窗被合成点击拦截
- 「开始考试/再考一次」开新标签必须**真人点击**；CDP 可信点击也开不出 → 用 arm 机制（真实点击写 GM 标记，新页自动托管）。

### 结果页复盘翻题
- 翻题靠**键盘方向键**（`Input.dispatchKeyEvent` ArrowUp/Down），页面提示「尝试键盘方向键」；脚本悬浮层里的「下一题」文字会误导按钮查找。

### 其它
- 启动 Chrome 前清 `~/.config/google-chrome-shuake/Singleton*` 锁；zsh 下 `--remote-allow-origins=*` 要引号。
- WSL 重启会清 `/tmp`（CDP 临时脚本需重建）、可能掉华为登录（短信验证码手动重登）。
