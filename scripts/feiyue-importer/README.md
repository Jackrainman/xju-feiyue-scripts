<div align="center">

# 飞跃·导入 Importer

### 新疆大学教务系统成绩单 → 飞跃学分统计 一键导入

<sub>feiyue-importer · ScriptCat Userscript · XjuSelab</sub>

> 教务页一个悬浮按钮：导出成绩单 PDF → 回传飞跃 → 自动出学分报告。<br/>
> _One button on the jwxt grade page — export → stash → parsed credits, no password touched._

[![安装 / 更新](https://img.shields.io/badge/安装_·_更新-v1.6.0-00485B?style=flat-square)](https://feiyue.selab.top/feiyue-importer.user.js)
[![飞跃手册](https://img.shields.io/badge/飞跃手册-feiyue.selab.top-0F7B6C?style=flat-square&logo=cloudflare&logoColor=white)](https://feiyue.selab.top)
[![源码](https://img.shields.io/badge/源码-xju--feiyue--scripts-2383E2?style=flat-square&logo=github&logoColor=white)](https://github.com/XjuSelab/xju-feiyue-scripts)
![grant none](https://img.shields.io/badge/@grant-none-9065B0?style=flat-square)

</div>

---

在新疆大学教务系统成绩页加「**导入飞跃**」悬浮按钮：一键导出成绩单 PDF，回传飞跃后端中转端点，切回飞跃「学分统计」标签页即自动解析出报告。**全程用你自己已登录的教务会话，不碰密码。**

## 安装 · Install

脚本猫里访问安装链接（**带 `?v=` 绕过 Cloudflare 缓存**）：

```
https://feiyue.selab.top/feiyue-importer.user.js?v=160
```

> 也可在飞跃「学分统计」页的**导入向导**里点「安装脚本」一键装（向导会自动检测安装状态并前进）。

## 工作原理 · How it works

- **`@grant none`**：运行在页面上下文，行为等同书签——同源 `fetch` 教务 `topdf`/`download`（浏览器自动带上你已登录的会话 cookie，含 HttpOnly 的），再 **no-cors multipart POST** 把 PDF 回传到飞跃后端中转端点 `https://feiyue.selab.top/notes/transcript-stash`；随后切回飞跃 `/credits` 自动解析。
- **学号取真值**：不读 `document.cookie`（`webvpn_username` 常为 HttpOnly，JS 读不到 → 误判未登录），改从 `topdf` 返回的 `<学号>_时间.pdf` 里取真实学号；`kingo.guest` 才算真未登录。
- **只在顶层框架注入**（教务是 frameset，否则每个子框架各冒一个按钮）。
- **自报安装**：在 `feiyue.selab.top` / `winbeau.top` 上**不注入按钮**，只设 `window.__feiyueImporterReady` / `<html data-feiyue-importer>` 并派发 `feiyue:importer-ready`，供飞跃导入向导检测安装进度。

## 适配范围 · Matches

| `@match` | 作用 |
| :-- | :-- |
| `jwxt-443.webvpn.xju.edu.cn:8040/*` | 教务成绩页：注入「导入飞跃」按钮 |
| `feiyue.selab.top/*`、`winbeau.top/*` | 飞跃站点：只自报已安装，不注入按钮 |

> 后端中转端点 `/notes/transcript-stash` 与导入向导属 [Aurash](https://github.com/winbeau/Aurash)（飞跃 web 应用），本脚本只负责教务侧导出与回传。

---

<div align="center">
<sub>新疆大学 · 软件开发实验室（XjuSelab） · <a href="https://github.com/XjuSelab/xju-feiyue-scripts">github.com/XjuSelab/xju-feiyue-scripts</a></sub>
</div>
