<div align="center">

# 飞跃·刷课 Grinder

### 华为小学期课程全自动刷课

<sub>feiyue-grinder · ScriptCat Userscript · XjuSelab</sub>

> 视频、课件、随堂测验、结课考试，一条龙跑完。<br/>
> _Video · slides · quizzes · finals — answered by a shared question bank, AI as fallback._

[![安装 / 更新](https://img.shields.io/badge/安装_·_更新-v2.10.0-00485B?style=flat-square)](https://feiyue.selab.top/feiyue-grinder.user.js)
[![飞跃手册](https://img.shields.io/badge/飞跃手册-feiyue.selab.top-0F7B6C?style=flat-square&logo=cloudflare&logoColor=white)](https://feiyue.selab.top)
[![仓库](https://img.shields.io/badge/源码-xju--feiyue--scripts-2383E2?style=flat-square&logo=github&logoColor=white)](https://github.com/XjuSelab/xju-feiyue-scripts)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![题库后端](https://img.shields.io/badge/题库后端-Docker%20%2B%20SQLite-2496ED?style=flat-square&logo=docker&logoColor=white)

</div>

---

华为小学期（shixizhi）课程全自动刷课的脚本猫（ScriptCat）脚本。**安装 / 更新**：<https://feiyue.selab.top/feiyue-grinder.user.js>

## 功能 · Features

- **视频**：自动播放（倍速 / 静音可调），播完出对勾才切下一节。
- **课件**：自动翻完每一页再前进。
- **随堂测验**：题库优先 + AI 兜底自动答题，未满分自动重测（带逐题正误记忆）。
- **结课考试**（独立 `examContent` 标签）：自动进入 / 确认须知 / 答题 / 交卷；用时不足 10 分钟会等够再交；答案来源大面积失败则暂停不交卷（防废卷）。
- **答案来源三选一**：题库优先 + AI 兜底（默认）/ 仅题库 / 仅 AI；状态栏区分「题库搜索中 / AI 思考中」，交卷后给出「题库命中 X / AI 解 Y」。
- **共享云题库** `feiyue-grinder-bank`（见下），按选项内容匹配防乱序。
- 防挂机保活、课程评价弹窗自动处理、强制重答开关。

## 后端 · `feiyue-grinder-bank/`

stdlib `http.server` + SQLite 的极简共享题库服务，Docker 部署在 huawei2，经 nginx `/feiyue-grinder-bank/` 反代（`https://feiyue.selab.top/feiyue-grinder-bank`）。

- `GET /search?q=<题干>&type=<题型>` → `{texts:[正确选项内容…], qtype, stem, votes}`
- `POST /add {stem,qtype,texts[]}`、`GET /stats`、`GET /health`
- 存「正确选项内容」而非字母（防选项乱序），归一化双向子串模糊匹配。
- 重建容器见 `deploy/deploy-bank.sh`，**数据卷勿删**。

## 测试 · Tests

```bash
cd tests && npm i && node --test *.mjs   # jsdom + node:test
```

> 改脚本里被测纯函数时，**同步 `tests/sxz-core.mjs` 的拷贝**，否则测试与线上脚本脱节。

## API Key

OpenAI 兼容，**默认 DeepSeek 官方**（`api.deepseek.com`；GPT-5.5 等可在设置切换）。**Key 仅存本地 GM，绝不进仓库。**

---

<div align="center">
<sub>新疆大学 · 软件开发实验室（XjuSelab） · <a href="https://github.com/XjuSelab/xju-feiyue-scripts">github.com/XjuSelab/xju-feiyue-scripts</a></sub>
</div>
