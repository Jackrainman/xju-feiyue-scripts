<div align="center">

# feiyue·scripts

### xju-feiyue-scripts · 新疆大学软件开发实验室脚本猫合集

<sub>ScriptCat Userscripts · XjuSelab · Xinjiang University</sub>

> _One edge to ship them, ScriptCat to keep them fresh._

[![主页](https://img.shields.io/badge/主页-selab.top-2383E2?style=flat-square&logo=githubpages&logoColor=white)](https://selab.top)
[![飞跃手册](https://img.shields.io/badge/飞跃手册-feiyue.selab.top-0F7B6C?style=flat-square&logo=cloudflare&logoColor=white)](https://feiyue.selab.top)
![ScriptCat](https://img.shields.io/badge/ScriptCat-脚本猫-00485B?style=flat-square)
![脚本](https://img.shields.io/badge/脚本-3-9065B0?style=flat-square&logo=javascript&logoColor=white)
![Open Source](https://img.shields.io/badge/Open%20Source-by%20default-37352F?style=flat-square&logo=git&logoColor=white)

</div>

---

软件开发实验室（XjuSelab）维护的脚本猫（ScriptCat）用户脚本统一仓库。所有脚本通过 [`feiyue.selab.top`](https://feiyue.selab.top) 分发，脚本猫经 `@updateURL` 自动更新。

## 脚本列表 · Scripts

命名采用「工具系 -er」：中文 `飞跃·<动作>` + 英文 `<动作>er`（见 [CONVENTIONS](./CONVENTIONS.md#命名)）。

| 脚本 | 技术 ID | 用途 | 安装 / 更新 |
| :-- | :-- | :-- | :--: |
| **飞跃·解题 Solver** | `feiyue-solver` | 希冀（Java/OJ）AI 自动解题、一键开刷 | [![安装](https://img.shields.io/badge/安装-v2.6.1-00485B?style=flat-square)](https://feiyue.selab.top/feiyue-solver.user.js) |
| **飞跃·刷课 Grinder** | `feiyue-grinder` | 华为小学期全自动刷课（视频 / 课件 / 测验 / 考试） | [![安装](https://img.shields.io/badge/安装-v2.10.0-00485B?style=flat-square)](https://feiyue.selab.top/feiyue-grinder.user.js) |
| **飞跃·导入 Importer** | `feiyue-importer` | 教务成绩单一键导入飞跃学分统计 | [![安装](https://img.shields.io/badge/安装-v1.6.0-00485B?style=flat-square)](https://feiyue.selab.top/feiyue-importer.user.js) |

> 点「安装」徽章，脚本猫会弹出安装 / 更新页。装过的会自动检查更新（Cloudflare 边缘缓存 4h，手动强制可在链接后加 `?v=<版本>` 回源验证）。徽章上的版本号即当前发布版。

## 目录结构 · Layout

```
scripts/
  feiyue-solver/     # 飞跃·解题 Solver + tests + dev 辅助(gen.mjs / e2e.sh / preview-gen.mjs)
  feiyue-grinder/    # 飞跃·刷课 Grinder
    └─ feiyue-grinder-bank/   # 共享云题库后端(stdlib http.server + SQLite + Docker)
    └─ tests/                 # jsdom + node:test
  feiyue-importer/   # 飞跃·导入 Importer(教务成绩单一键导入飞跃学分统计)
deploy/              # 本机一键部署到 feiyue 的脚本(见下)
docs/                # 开发文档 + 踩坑记录
```

## 开发 & 部署 · Develop & Deploy

1. 直接在 `scripts/<名>/` 下编辑 `.user.js`，改动后**自增 `@version`**（改被测纯函数要同步 `feiyue-grinder/tests/sxz-core.mjs`）。
2. 跑测试：`cd scripts/feiyue-grinder/tests && npm i && node --test *.mjs`（78 项）。
3. 提交：`git commit -am "feat(grinder): … v2.10.1"`。
4. 部署到 feiyue：`bash deploy/deploy.sh`（本机执行，经 win-wsl2 二跳推到 huawei2 的 `~/public-scripts/`）。

> 部署必须从本机跑：huawei2（华为云）只能经 win-wsl2 内网二跳访问，GitHub 云端 CI 到不了它，故不用 CI 自动部署。

## 文档 · Docs

| 文档 | 内容 |
| :-- | :-- |
| [CLAUDE.md](./CLAUDE.md) | 在本仓工作的铁律 / 命令 / 链路（Claude Code 入口） |
| [CONVENTIONS.md](./CONVENTIONS.md) | 命名（工具系 `-er`）/ 版本 / `@updateURL` / 身份 / 部署 规范 |
| [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) | 两脚本架构 / 答题来源链 / feiyue-grinder-bank / 测试 / 部署 / CDP 调试 |
| [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) | **★ 踩过的坑 & 解法**（改动前必读：全选 A / 题库 0 命中 / 暂停失效 / 不自动更新 / 二跳部署 …） |

---

<div align="center">
<sub>新疆大学 · 软件开发实验室（XjuSelab） · PR 与合作欢迎 · <a href="https://github.com/XjuSelab">github.com/XjuSelab</a></sub>
</div>
