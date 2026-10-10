<a name="readme-top"></a>

<div align="center">

<img src="../logo.png" alt="LumiRealm" width="640"/>

[English](../README.md) | [한국어](readme-ko_kr.md) | [日本語](readme-ja_jp.md) | **简体中文** | [繁體中文](readme-zh_tw.md) | [Deutsch](readme-de_de.md) | [Русский](readme-ru_ru.md)

[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](../LICENSE)
[![Lumiverse](https://img.shields.io/badge/Lumiverse-1.2.0%2B-blueviolet)](https://github.com/prolix-oc/Lumiverse)
[![RisuAI](https://img.shields.io/badge/RisuAI-port-9cf?logo=svelte)](https://github.com/kwaroran/Risuai)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-bundle-fbf0df?logo=bun)](https://bun.sh)

</div>

---

LumiRealm 是一个 [Lumiverse](https://github.com/prolix-oc/Lumiverse) 扩展，可以在 Lumiverse 中运行 [RisuAI](https://github.com/kwaroran/Risuai) 的角色卡、模块和世界书。内置 RisuRealm 机器人浏览器。

完整指南请见 **[Wiki](https://github.com/AMousePad/LumiRealm/wiki)**。

## 功能

- 导入 `.charx`、`.png`、`.json` 和 `.jpg`/`.jpeg` 角色卡，或在扩展内浏览 RisuRealm。
- 导入 `.risum` 和 `.charx` 模块、独立的世界书及正则表达式脚本。模块可以关联到单个角色，也可以全局启用。
- 运行 CBS 宏、Lua 和 V2 触发器、显示正则表达式及世界书。显示正则表达式在浏览器中执行。
- 在 **Viewer** 中查看卡片内容，在 **State** 中管理聊天变量和开关，在 **Import** 中导出卡片和模块。关联的模块需要与卡片分别导出。

## 截图

|                  示例卡片                   |                       RisuRealm 浏览                       |
| :------------------------------------------: | :--------------------------------------------------------: |
| ![1778064388761](../image/README/1778064388761.png) | ![1778064256839](../image/README/1778064256839.png) |

|                     查看器                     |                     状态                      |
| :--------------------------------------------: | :--------------------------------------------: |
| ![1778064299483](../image/README/1778064299483.png) | ![1778064443131](../image/README/1778064443131.png) |

## 安装

此分支需要 **Lumiverse 1.2.0 或更高版本**，详见 [spindle.json](../spindle.json)。开发版的额外依赖请参阅下方的 **分支** 部分。

1. 打开你的 Lumiverse 实例。
2. 打开侧边栏中的 **扩展** 并添加:

   ```txt
   https://github.com/AMousePad/LumiRealm
   ```
3. 请授予 LumiRealm 请求的所有权限。[为什么?](https://github.com/AMousePad/LumiRealm/wiki/Architecture)
4. 启用扩展后,**LumiRealm** 标签会出现在侧边栏中。

## 分支

请选择与所用 Lumiverse 版本相匹配的分支。

- **`main`** 是面向已发布 Lumiverse 版本的默认分支。
- **`staging`** 用于开发，可能需要尚未发布的 Lumiverse 改动。所需的宿主改动发布后，相应功能才会移入 `main`。

若要切换分支，请在扩展选项卡中使用 LumiRealm 条目的 **Branch** 按钮。

## 兼容性

LumiRealm 以 RisuAI 的行为为准，但兼容性尚不完整。Markdown、HTML 清理和 HTML 岛（消息中相互隔离的区域）仍由 Lumiverse 处理。如果卡片的 CSS 或控件依赖 HTML 岛之外的元素，显示效果或行为可能与 RisuAI 不同。

## 报告问题

请提供 LumiRealm 和 Lumiverse 的版本及分支、浏览器和设备、复现步骤，以及相同内容在 RisuAI 中的表现。

要收集日志，请打开 **LumiRealm → Settings → Debug → Logs**，启用 **Enable logging**，复现问题后点击 **Download**。下载后会停止记录日志。只有在准备分享消息内容时才启用 **Include chat data**，并在发布前检查文件。

开发和测试说明请参阅 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 社区

- **[Discord](https://github.com/AMousePad/LumiRealm/wiki/Discord)**: Lumiverse 服务器见!
- **[Issues](https://github.com/AMousePad/LumiRealm/issues)**: Bug 反馈与功能请求。
- **[Wiki](https://github.com/AMousePad/LumiRealm/wiki)**: 用户指南和架构深入说明。

## 许可证

**GPL-3.0-or-later.** LumiRealm 是 [RisuAI](https://github.com/kwaroran/Risuai)（GPL-3.0，© 2024 Kwaroran）的衍生作品，包含为 Lumiverse 移植和调整的代码及样式。

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>
