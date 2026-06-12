# CLAUDE.md — xju-feiyue-scripts

飞跃实验室（XjuSelab）的 Tampermonkey 用户脚本 monorepo。两个脚本 + 一个共享后端，统一通过 `feiyue.selab.top` 分发。

## 仓库地图

```
scripts/feiyue-solver/    飞跃·解题 Solver — CourseGrading(Java/OJ) AI 解题(原 cg-ai-solver/xiji)
scripts/feiyue-grinder/   飞跃·刷课 Grinder — 华为实习汁(小学期)自动刷课(原 huawei-sxz-shuake)
  ├─ feiyue-grinder.user.js
  ├─ sxz-bank/            共享云题库后端(stdlib http.server + SQLite + Docker)
  └─ tests/               jsdom + node:test
deploy/                   本机一键部署到 feiyue 的脚本
docs/DEVELOPMENT.md       架构 / 开发流程 / 测试 / 部署 / CDP 调试
docs/TROUBLESHOOTING.md   ★ 踩过的坑 & 解法(改动前必读)
CONVENTIONS.md            命名 / 版本 / @updateURL / 身份 规范
```

> `import.user.js`（飞跃·导入）不在本仓，归 [Aurash](https://github.com/winbeau/Aurash) 管。

## 铁律（改动前必看）

1. **改脚本必自增 `@version`**，否则 Tampermonkey 不更新。脚本头必须有 `@updateURL`+`@downloadURL` 指向 feiyue 裸链接（缺了就永远不自动更新——本仓血泪教训）。
2. **改 grinder 里被测的纯逻辑函数时，同步 `scripts/feiyue-grinder/tests/sxz-core.mjs` 的拷贝**，否则测试与线上脚本脱节。
3. **不要改已发布脚本的 `@name` / `@namespace` / 技术 ID**——Tampermonkey 以此为身份，改了会被当成新脚本、用户丢配置（API Key 等）。仅在「无安装用户（内测期）」时可对齐改名。
4. **部署只能从本机跑**：`huawei2`（华为云）只能经 `win-wsl2` 内网二跳访问，GitHub 云端 CI 到不了它。用 `deploy/deploy.sh`，不要尝试 CI 自动部署。
5. **API Key / 账号绝不进仓库**，只存浏览器本地 GM。提交前 `grep -rE 'sk-[A-Za-z0-9]{20,}' scripts/` 自查。
6. **sxz-bank 的题库数据**（`/data/bank.db`）在 Docker 卷里，重建容器**勿删卷**。

## 常用命令

```bash
# 测试(grinder)
cd scripts/feiyue-grinder/tests && npm i && node --test *.mjs    # 78 项
# 语法
node -c scripts/feiyue-grinder/feiyue-grinder.user.js
node -c scripts/feiyue-solver/feiyue-solver.user.js
# 部署到 feiyue(本机)
bash deploy/deploy.sh [--dry-run] [脚本名过滤]
# 回源验证(改完)
curl -A Mozilla 'https://feiyue.selab.top/feiyue-grinder.user.js?v=<版本>' | grep -m1 @version
```

## 调试 / 部署链路

- 本机 →（`ssh -p 2222 winbeau@win-wsl2`）win-wsl2 →（二跳 `ssh huawei2`）huawei2。
- win-wsl2 上有 GUI Chrome（CDP 端口 9333）驱动华为实习汁实测；二跳 scp **要拆成单条**（链式 `&& ssh huawei2 "..."` 会超慢/超时）。
- 详见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。遇到问题先翻 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)。
