# 飞跃·刷课 Grinder（`feiyue-grinder`）

华为实习汁（shixizhi）课程全自动刷课。Tampermonkey 脚本。

**安装 / 更新**：<https://feiyue.selab.top/feiyue-grinder.user.js>

## 功能

- **视频**：自动播放（倍速/静音可调），播完出对勾才切下一节。
- **课件**：自动翻完每一页再前进。
- **随堂测验**：题库优先 + AI 兜底自动答题，未满分自动重测（带逐题正误记忆）。
- **结课考试**（独立 examContent 标签）：自动进入/确认须知/答题/交卷；用时不足 10 分钟会等够再交；答案来源大面积失败则暂停不交卷（防废卷）。
- **答案来源三选一**：题库优先+AI兜底（默认）/ 仅题库 / 仅AI；状态栏区分「题库搜索中 / AI 思考中」，交卷后给出「题库命中 X / AI 解 Y」。
- **共享云题库** `feiyue-grinder-bank`（见下），按选项内容匹配防乱序。
- 防挂机保活、课程评价弹窗自动处理、强制重答开关。

## 后端 `feiyue-grinder-bank/`

stdlib `http.server` + SQLite 的极简共享题库服务，Docker 部署在 huawei2，经 nginx `/feiyue-grinder-bank/` 反代（`https://feiyue.selab.top/feiyue-grinder-bank`）。

- `GET /search?q=<题干>&type=<题型>` → `{texts:[正确选项内容...], qtype, stem, votes}`
- `POST /add {stem,qtype,texts[]}`、`GET /stats`、`GET /health`
- 存「正确选项内容」而非字母（防选项乱序），归一化双向子串模糊匹配。
- 重建容器见 `deploy/deploy-bank.sh`，**数据卷勿删**。

## 测试

`cd tests && npm i && node --test *.mjs`（jsdom + node:test）。改脚本里被测纯函数时，同步 `tests/sxz-core.mjs` 的拷贝。

## API Key

OpenAI 兼容（GPT-5.5 / DeepSeek 可切），**仅存本地 GM，绝不进仓库**。
