<div align="center">

# 飞跃·解题 Solver

### 希冀（CourseGrading / educg）Java/OJ AI 自动解题

<sub>feiyue-solver · ScriptCat Userscript · XjuSelab</sub>

> 提取题目 → 模型生成 → 自动提交 → 读判题；一键开刷、失败读样例多版本重试、自动跳题。<br/>
> _Extract → generate → submit → grade — streamed, self-correcting, one-click batch._

[![安装 / 更新](https://img.shields.io/badge/安装_·_更新-v2.6.1-00485B?style=flat-square)](https://feiyue.selab.top/feiyue-solver.user.js)
[![飞跃手册](https://img.shields.io/badge/飞跃手册-feiyue.selab.top-0F7B6C?style=flat-square&logo=cloudflare&logoColor=white)](https://feiyue.selab.top)
[![源码](https://img.shields.io/badge/源码-xju--feiyue--scripts-2383E2?style=flat-square&logo=github&logoColor=white)](https://github.com/XjuSelab/xju-feiyue-scripts)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![OpenAI 兼容](https://img.shields.io/badge/OpenAI_兼容-stream%20SSE-9065B0?style=flat-square&logo=openai&logoColor=white)

</div>

---

希冀（CourseGrading / educg）编程题平台的 AI 解题脚本：
**提取完整题目 → DeepSeek 生成 → 自动提交 → 轮询并显示判题结果**，支持**一键串行开刷所有作业 / 所有题目、失败读样例多版本重试、自动跳题**。

支持四种题型：**普通编程题**（`programList`，上传 .java）、**在线编辑编程题**（`programList_ce`，源码走 `cgsoucecode`+`byCE` 提交，部分 `programList` 链接会 302 跳到此页）、**程序填空题**（`programFillGapList`，填 `answerN` 空位）、**接口实现题**（`programWithInterfaceList`，上传含包名主类的 .java）。开刷时先读取各作业 index 页，构建**已校验且排序**的题目队列，只跳转真实存在的链接（不会再跳到空页）。

UI 参照 [Aurash](../Aurash/) 的 Notion 风格设计令牌（暖白底、近黑字、细描边、6/8/12 圆角、lucide 线性图标）。

![面板预览](docs/screenshot.png)
![配置页](docs/config.png)

## 安装 · Install

脚本猫里访问安装链接（**带 `?v=` 绕过 Cloudflare 缓存**）：

```
https://feiyue.selab.top/feiyue-solver.user.js?v=261
```

> 裸链接 `…/feiyue-solver.user.js` 会被 Cloudflare 边缘缓存（默认 4h TTL），更新后短时间内可能拿到旧版本——装新版请用带 `?v=` 的链接，或在 Cloudflare 给该路径加一条 Bypass Cache 规则。
> 首次运行脚本猫会提示「允许跨域连接」到 API 域名，**必须点允许**，否则请求会一直挂起。

## 使用 · Usage

1. 打开任意编程题页（或希冀任意页）：右下角出现 **飞跃·解题 Solver** 面板。**首次无 Key 时**有蓝色**悬浮箭头**指向右上角齿轮，引导你去配置。
2. 点齿轮 / 模型按钮进入**配置页**，填 **API Base URL**（**默认 `https://api.deepseek.com`（DeepSeek 首推）**，可换 `https://aiapis.help/v1`（GPT 代理要带 `/v1`）等任意 OpenAI 兼容服务）、**API Key**（不知去哪拿？配置页给了 **GPT 系 `aiapis.help/console`** 与 **DeepSeek 系 `platform.deepseek.com`** 跳转链接），点 **刷新模型列表**（调 `<BaseURL>/models`），在**主模型 / 重试强模型下拉**里选即可，无需手敲；没有的选「其他/自定义」手填。默认主模型 `deepseek-chat`、强模型 `deepseek-reasoner`，**思考模式默认关**。
3. **解本题**：当前题一键生成并提交，显示得分。
4. **一键开刷全部**：先读作业列表建校验队列，从第一题起串行解所有作业的所有题，自动提交、自动跳下一题。可随时**停止开刷**。
   - **未抽题自动抽取**：开刷前遇到「还没抽题」的作业（有「抽取题目」按钮）会自动 POST 抽一次再读题；**已抽过的（显示「重新抽取题目」）绝不重抽**，避免换题清进度。抽题后轮询回读确认生效，**请勿在抽取期间重复点「开刷」**。
   - **失败纠错**：未满分时读取判题「错误样例」（**全部失败测试点**的期望输出 vs 实际输出），**追加到同一对话**喂回模型（**不换模型**）让其据上下文纠正后重新提交。
   - **版本计划**：v1 直接解 → v2 同模型按样例纠错 → **v3 同模型据失败样例反推通用规则**（**v2.5.0 起不再鼓励打表/逐例特判**——硬编码可见点几乎必挂隐藏用例，改为提示反推题目真正的通用规则/边界）→ 主模型**连错 ≥3 次**后，追加一版升级到「重试强模型」（进入前**重置单题预算 + 压缩上下文**）。
   - **思考时间给够（v2.6.0）**：单次模型调用超时**默认 6 分钟**且**与单题总时钟解耦**——不再因「前一版用掉大半时间」就把正在产 token 的长思考秒杀（v2.4 起难题"超时/被跳过变多"的主因）。单题总预算**默认 15 分钟**，仅作「是否再起新一版」的版间闸门；超时跳过时进度里标「超时」。单次超时 / 单题预算 / `max_tokens` 都可在配置页「高级」里调（留空=自动/默认）。
5. 选项：思考模式（DeepSeek `thinking` 开关，**默认关**）、自动提交、跳过已满分、失败重试次数（设为 ≥3 即启用强模型升级）。
6. **流式进度（v2.3 / v2.4.5 / v2.4.6）**：调用模型时状态行实时显示 **「思考中 N字 / 生成中 M字（已用时 Ns）」**——一眼分清「在思考 / 在生成 / 卡住」。**v2.4.5 按阶段判定**：只有「出正文后静默」才提示「⚠ 可能卡住」，「思考中静默」放宽到 35s 且只平静提示「仍在思考」，不再把推理模型的静默推理误判为「响应慢/卡住」。**v2.4.6 修真流式**：脚本猫（ScriptCat，MV3 扩展）默认 `responseType:'text'` 走后台原生 XHR，正文只在 `onload` 一次性回传、`onprogress` 期间拿不到中间文本——逐字进度其实是**假的**（整段缓冲到最后一蹦）；改用 **`responseType:'stream'` 自己读 `ReadableStream` 增量解码**，才是脚本猫下唯一可靠的真增量路径（Tampermonkey 非 MV3 本就能流）。拿不到流的管理器（Violentmonkey / Greasemonkey / 老版）**自动回退** `responseText` 整段返回，答案仍正确、绝不回归。首次调用会在诊断日志记一条**流式探针**（本管理器到底拿没拿到中间文本）。另：生成阶段静默到 60s 且已有正文会**主动收口已拿到的正文**（防服务端流完不发 `[DONE]` 又不关连接时干等到超时）。
7. **日志 / 诊断（v2.3）**：右上角**齿轮旁的铃铛**——遇特殊情况（无 Key / 401 / 连不上 / 模型不支持 / 卡住 / 超时）弹**新手引导式 banner** + 操作按钮；点开是**带时间戳的历史时间线**（每步：调用/思考/生成/提交/判题/报错）；**一键复制诊断日志**（自动隐藏 API Key），方便定位排查。有未读告警时铃铛带红点。
8. **上下文压缩 + 强模型升级（v2.4 / v2.5.0）**：同题内每连错 2 次压缩对话，省 token、降干扰、防撞上下文上限；主模型连错 ≥3 次后用强模型（思考模式）从干净上下文、满时间预算重解。**v2.5.0 修正**：压缩从「只留最近一轮」改为**保留最近两轮（代码+失败反馈）**——难题多版纠错时模型不再「失忆」、反复踩同一坑、只盯最近一批失败点（这是 v2.4 起难题正确率下降的主因之一）。
9. **自适应 max_tokens（v2.6.0）**：思考模型把 `max_tokens` 大量花在推理上，给少了会"只思考没正文"（返回空，难题失败的高频形态）。改为**默认思考模式给 32768、普通 8192**，且**思考耗尽预算（`finish_reason=length`）时自动翻倍加大重试本版**（封顶 65536）；若某模型不支持该 `max_tokens`（如 `deepseek-chat` 硬顶 8192、返回 400），**自动记住其上限并降回重试**，后续请求自动钳到该上限不再 400。日志会区分「思考耗尽 token 预算（已自动加大重试）」与普通空返回。**v2.6.1（审查修复）**：`capped` 仅匹配真正的 `max_tokens` 输出超限（排除「输入上下文超限 / 限流」，否则会被误学成错误的 token 上限缓存、之后所有思考调用都被饿死）；学习上限从死写 8192 改为「被拒值减半、封顶 8192」逐版收敛；已提交后至少轮询 90 秒拿判题（防总预算耗尽后把已交答案当失败丢弃）。

### 兼容性（rainman 实测，v2.3）
| 服务商 | Base URL | 可用模型 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` / `deepseek-reasoner`（默认，发 `thinking` 参数） |
| 小米 mimo | `https://token-plan-cn.xiaomimimo.com/v1` | `mimo-v2.5-pro` 等 |
| 火山·编程计划 | `https://ark.cn-beijing.volces.com/api/coding/v3` | ✅ `kimi-k2-250711`、`deepseek-v3-250324`；❌ `deepseek-v3-1`/`deepseek-r1`/`doubao-seed-1-6`（该 endpoint 只对部分模型开放，选错会 404 `UnsupportedModel`，脚本会提示换模型） |

> 任意 OpenAI 兼容 `/chat/completions` + SSE 流式服务均可。Base URL 填到带 `/v1` 或 `/coding/v3` 的前缀，脚本自动拼 `/chat/completions` 与 `/models`。

## 文件 · Files

| 文件 | 说明 |
|---|---|
| `feiyue-solver.user.js` | **主交付物**：脚本猫用户脚本 |
| `harden-nginx.sh` | 部署加固：把安装链接固定从 `~/public-scripts` 提供（独立于 Aurash 构建），含 `nginx -t` + 失败回滚 |
| `preview-gen.mjs` | 抽脚本 CSS 生成预览页（纯 node） |
| `test-extract.mjs` | jsdom 离线单测（54 项：多题型提取 / 填空模板 / 失败反馈解析 / 版本计划 / **上下文压缩(含末尾 assistant 边界)** / 判分） |
| `test-stream.mjs` | **流式 SSE 解析单测**（vm 沙箱，无依赖，17 项：reasoning/content 分离、半行容错、CRLF、错误体、非 SSE 回退、**`finish_reason` 捕获**(length/stop、usage-only 尾帧不清空、全 null→null)） |
| `test-transport.mjs` | **传输层单测**（vm 沙箱，无依赖，15 项：模拟 `responseType:'stream'` 的 `ReadableStream`(脚本猫式·永不 close) 真增量路径 + 无流时回退 `responseText` 不回归 + 非 SSE 错误体 reject + 流内 content/error 共存不吞 + 生成静默 60s 硬收口 + **思考耗尽预算→reject(`starved`)** + **stop 无正文→`empty`(不误判)** + **`max_tokens` 超限 400→reject(`capped`)** + **输入上下文超限 400→NOT `capped`**(v2.6.1)） |
| `test-compact.mjs` | **上下文压缩单测**（vm 沙箱，无依赖，9 项：v2.5.0 保留最近两轮代码+反馈、丢更早累积、以 user 结尾、幂等性——难题多版纠错防失忆） |
| `test-tokens.mjs` | **自适应 max_tokens 单测**（vm 沙箱，无依赖，21 项：`autoTokens` 思考开/关默认 + 用户值优先 + 学习上限钳制；`decideRetry` starved 翻倍 ×2、封顶 65536、非 starved 不重试；`isCapErr` 仅真正的 `max_tokens` 超限算 capped、上下文超限/限流不算(v2.6.1)） |
| `test-boot.mjs` | **启动冒烟 + 诊断面板集成测试**（jsdom，16 项：铃铛/日志浮层/引导 banner/**复制诊断绝不含 Key**） |
| `live-stream.mjs` | 活体流式验证：用脚本真实 `parseSSE` 解真实 API 流（量「首响应/首正文/思考字数/生成字数」），凭据走 `MIMO_KEY`/`ARK_KEY` |
| `shot.mjs` | 无头浏览器视觉验证（playwright，桩页面注入脚本，截取面板/日志/思考·生成/引导 banner） |
| `gen.mjs` / `e2e.sh` | 端到端验证（jsdom 提取 + 真实 LLM + 真实提交），需 WSL fixtures，凭据走 `CG_USER`/`CG_PASS` 环境变量 |

> 仓库内不含任何账号或 API Key。

## 工作原理（已验证接口契约）· How it works

- **题目提取**：DOM `.col-10` 内、面包屑与首个 `<hr>` 之间取标题+题面；`problemID` 取自 `#showmessageFrame` 的 `src`；作业/题目列表从页面链接发现。
- **生成**：`POST <BaseURL>/chat/completions`，**`stream:true` 流式** + **`responseType:'stream'`**（`max_tokens` **自适应**：思考模式默认 32768、普通 8192，思考耗尽预算自动加大重试、按模型学习其 token 上限；`temperature=0`）。脚本自己 `getReader()` 读 `ReadableStream`、`TextDecoder({stream:true})` 增量解码，喂给 `parseSSE`（分离 `reasoning_content`/`content`，按累积全文整体重解析、尾部半行容错）；**收口走 `onload`**（脚本猫 content 端的流不会被 `close()`，读流只当实时进度喂料，`onload` 时 chunk 已全部入队、消息间 microtask 已抽干缓冲），拿不到流则回退 `onload` 的 `responseText`/`response`（非 stream 管理器一次性给），非 SSE 再按普通 JSON 回退。DeepSeek 端点附带 `thinking:{type:enabled|disabled}`（推理模型 token 给不足会导致 `content` 为空——v2.6.0 起检测到「思考占满、`finish_reason=length`」会自动加大 `max_tokens` 重试本版）。流式既消除「长生成空闲挂起＝无响应」，又让 UI 在脚本猫下也能**真·实时**显示思考/生成进度。
- **提交**：用 `GM_xmlhttpRequest` 直接 multipart POST 到 `showProcessMsg.jsp`（`FILE1`=源文件 + `cgSubmitBtn`/`wtime`/`javaMainCLass`）；**不走页面提交按钮**——该按钮提交后会被 `disable`，重试时会导致新代码没真正提交（"三次同一报错"的根因）。填空题改 POST `answerN` 字段；接口题用页面预填的 `javaMainCLass`、文件名取末段、且**不重定义评测已提供的接口**（否则 duplicate class）。
- **判题**：轮询 `GET longtimerunJSON.jsp?assignID&problemID`，GBK 用 `TextDecoder('gbk')` 解码。
- **开刷**：跨页状态机，进度存 `GM_setValue`，每页 `location` 跳下一题后自动续跑。队列项按 **`assignID|页型|proNum`** 唯一标识——同一作业可同时有多种题型（如 53 既有填空又有接口），`proNum` 会跨题型重复，必须含页型才不丢题/不冲突。
- **失败纠错**：失败时先触发 `judgeDetailsCheck` 生成再 POST `assignment/moretest/dynamictest.jsp` 取 `pre#wrongContent<N>`(实际)/`pre#rightContent<N>`(期望)，作为新一轮 user 消息**追加进同一对话**，同模型据上下文纠正；仅最后一版升级到强模型。判题新鲜度用「最后一次提交时间」判断（修复重复提交内容相同时的卡死）。

## 限制 · Limits

- 仅适配 Java 课程（平台锁定 `progLanguage=java`）。
- 题面纯文本提取，**图片描述**的题目模型看不到。
- 生成代码强制 ASCII；需中文输出的题需手动处理。
- 浏览器必须能访问所配 API 域名；连不上/报错时铃铛「日志/诊断」会给出具体原因与引导，**复制诊断日志**（隐藏 Key）便于自查或反馈。

---

<div align="center">
<sub>新疆大学 · 软件开发实验室（XjuSelab） · <a href="https://github.com/XjuSelab/xju-feiyue-scripts">github.com/XjuSelab/xju-feiyue-scripts</a></sub>
</div>
