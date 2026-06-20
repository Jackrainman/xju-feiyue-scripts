# 规范（CONVENTIONS）

本仓库所有用户脚本遵循统一的命名、版本与部署约定。

## 命名

每个脚本有两层名字：**技术 ID**（目录 / 文件 / URL，机器用）和**显示名**（README / `@name`，人看）。

### 技术 ID（文件名 / 目录 / URL）

- 文件名：`feiyue-<工具名>.user.js`，全小写、连字符分隔、无空格无中文。`<工具名>` = 显示名里的英文 `-er` 词小写（`solver`、`grinder`、`downloader` …）。
  - 例：`feiyue-solver.user.js`、`feiyue-grinder.user.js`。
- 每个脚本一个目录：`scripts/feiyue-<工具名>/`，内含脚本本体、可选后端、`tests/`、`README.md`。
- **技术 ID 一旦有安装用户即冻结**（它就是 feiyue 发布 URL，改名=断掉老用户自动更新）；内测期（无用户）可放开改。

### 显示名：工具系 `-er`

品牌显示名统一格式：`飞跃·<动作> <动作>er`。

- **中文**：`飞跃·<二字动作>`——取功能的核心动词、二字对仗。
- **英文**：核心动作 + `-er`（施动者 / 工具名），单词、首字母大写。

现行：

| 技术 ID | 中文 | English | 动作取意 |
|---|---|---|---|
| `feiyue-solver` | 飞跃·解题 | **Solver** | solve 解题 |
| `feiyue-grinder` | 飞跃·刷课 | **Grinder** | grind 正是游戏「刷」的本义 |
| `feiyue-importer` | 飞跃·导入 | **Importer** | import 导入 |

新脚本沿用此式（下载→`Downloader`、翻译→`Translator`、导出→`Exporter` …），保证一眼归类、可无限扩展。

> `@name` 直接写成 `飞跃·<动作> <动作>er`（用途放 `@description`）。改 `@name`/`@namespace` 会让 Tampermonkey 当成新脚本、老用户丢配置——所以**只在无安装用户时改**（见下「脚本身份」）。

## 元数据（UserScript header）

- `@version` 用 [semver](https://semver.org) `MAJOR.MINOR.PATCH`：
  - PATCH = 修 bug / 措辞 / 性能；MINOR = 新功能且向下兼容；MAJOR = 破坏性（GM 存储 key、对外接口变更）。
  - **每次改动脚本都要自增 `@version`**，否则 Tampermonkey 不会更新。
- `@updateURL` 与 `@downloadURL` 统一指向裸链接：
  ```
  // @updateURL    https://feiyue.selab.top/<filename>.user.js
  // @downloadURL  https://feiyue.selab.top/<filename>.user.js
  ```
- 发布 URL：一脚本一 URL，**不在路径里嵌版本号**；历史版本靠 git 提交追溯。
- 验证回源：链接后加 `?v=<版本>` 绕 Cloudflare 缓存（缓存 4h），`cf-cache-status: MISS` 即最新。

### ⚠️ 脚本身份（`@name` + `@namespace`）

Tampermonkey 用 `@name`+`@namespace` 作脚本身份。**改了会被当成新脚本，老用户丢本地配置**（API Key、GM 标记）。规则：

- **有安装用户后**，`@name` / `@namespace` / 技术 ID 一律冻结，不再改名。
- **内测期（无用户）可放开对齐**——本仓两脚本已在内测期统一为：

  | 脚本 | `@name` | `@namespace` |
  |---|---|---|
  | feiyue-solver | `飞跃·解题 Solver` | `https://feiyue.selab.top/feiyue-solver` |
  | feiyue-grinder | `飞跃·刷课 Grinder` | `https://feiyue.selab.top/feiyue-grinder` |
  | feiyue-importer | `飞跃·导入 Importer` | `https://feiyue.selab.top/feiyue-importer` |

- 新脚本一律按工具系 `-er` 取名，`@namespace` 用 `https://feiyue.selab.top/feiyue-<工具名>`。

## 版本与 git

- 改 `@version` → `git commit`，commit message 体现脚本与版本，如 `feat(sxz): 强制重答 v2.9.12`。
- 可选打 tag `<scope>-v<版本>`（如 `sxz-v2.9.12`）便于检索；本仓不强制 GitHub Release。

## 部署

- 唯一部署源是本仓的 `deploy/`，从**本机**执行（链路：本机 → `win-wsl2`(ssh -p 2222) → `huawei2`(二跳) → `~/public-scripts/`，nginx `aurash-tunnel` 精确 location 提供）。
- `deploy/deploy.sh [--dry-run] [脚本名…]`：推 `.user.js` 到 huawei2，并调 `ensure-nginx-locations.sh` 幂等校验 nginx location。
- `deploy/deploy-bank.sh`：仅在改了 huawei 后端时用，重建 `feiyue-grinder-bank` 容器——**务必保留 `/data` 卷（题库数据）**。

## 测试

- 纯逻辑用 jsdom + `node:test` 离线单测；改脚本内被测函数时同步 `tests/` 里的拷贝（如 huawei 的 `sxz-core.mjs`）。
- 提交前至少 `node -c <脚本>` 语法校验 + 跑该脚本的测试。
