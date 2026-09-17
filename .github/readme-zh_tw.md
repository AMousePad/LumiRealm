<a name="readme-top"></a>

<div align="center">

<img src="../logo.png" alt="LumiRealm" width="640"/>

[English](../README.md) | [한국어](readme-ko_kr.md) | [日本語](readme-ja_jp.md) | [简体中文](readme-zh_cn.md) | **繁體中文** | [Deutsch](readme-de_de.md) | [Русский](readme-ru_ru.md)

[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](../LICENSE)
[![Lumiverse](https://img.shields.io/badge/Lumiverse-1.2.0%2B-blueviolet)](https://github.com/prolix-oc/Lumiverse)
[![RisuAI](https://img.shields.io/badge/RisuAI-port-9cf?logo=svelte)](https://github.com/kwaroran/Risuai)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-bundle-fbf0df?logo=bun)](https://bun.sh)

</div>

---

LumiRealm 是一個 [Lumiverse](https://github.com/prolix-oc/Lumiverse) 擴充功能，可在 Lumiverse 中執行 [RisuAI](https://github.com/kwaroran/Risuai) 的角色卡、模組與世界書。內建 RisuRealm 機器人瀏覽器。

完整指南請見 **[Wiki](https://github.com/AMousePad/LumiRealm/wiki)**。

## 功能

- 匯入 `.charx`、`.png`、`.json` 和 `.jpg`/`.jpeg` 角色卡，或在擴充功能內瀏覽 RisuRealm。
- 匯入 `.risum` 和 `.charx` 模組、獨立的世界書及正規表示式腳本。模組可以連結至個別角色，也可以全域啟用。
- 執行 CBS 巨集、Lua 和 V2 觸發器、顯示用正規表示式及世界書。顯示用正規表示式在瀏覽器中執行。
- 在 **Viewer** 中查看卡片內容，在 **State** 中管理聊天變數和開關，在 **Import** 中匯出卡片和模組。連結的模組需要與卡片分別匯出。

## 螢幕截圖

|                  範例卡片                   |                       RisuRealm 瀏覽                       |
| :------------------------------------------: | :--------------------------------------------------------: |
| ![1778064388761](../image/README/1778064388761.png) | ![1778064256839](../image/README/1778064256839.png) |

|                     檢視器                     |                     狀態                      |
| :--------------------------------------------: | :--------------------------------------------: |
| ![1778064299483](../image/README/1778064299483.png) | ![1778064443131](../image/README/1778064443131.png) |

## 安裝

此分支需要 **Lumiverse 1.2.0 以上版本**，詳見 [spindle.json](../spindle.json)。開發版的額外相依需求請參閱下方的 **分支** 段落。

1. 開啟你的 Lumiverse 執行實例。
2. 開啟側邊欄中的 **擴充功能** 並新增:

   ```txt
   https://github.com/AMousePad/LumiRealm
   ```
3. 請授予 LumiRealm 要求的所有權限。[為什麼?](https://github.com/AMousePad/LumiRealm/wiki/Architecture)
4. 啟用擴充功能後,**LumiRealm** 分頁會出現在側邊欄中。

## 分支

請選擇與所用 Lumiverse 版本相符的分支。

- **`main`** 是供已發布 Lumiverse 版本使用的預設分支。
- **`staging`** 用於開發，可能需要尚未發布的 Lumiverse 變更。所需的宿主變更發布後，對應功能才會移入 `main`。

若要切換分支，請在擴充功能分頁中使用 LumiRealm 項目的 **Branch** 按鈕。

## 相容性

LumiRealm 以 RisuAI 的行為為準，但相容性尚不完整。Markdown、HTML 清理和 HTML 島（訊息中相互隔離的區域）仍由 Lumiverse 處理。如果卡片的 CSS 或控制項依賴 HTML 島以外的元素，顯示效果或行為可能與 RisuAI 不同。

## 回報問題

請提供 LumiRealm 和 Lumiverse 的版本及分支、瀏覽器和裝置、重現步驟，以及相同內容在 RisuAI 中的表現。

要收集日誌，請開啟 **LumiRealm → Settings → Debug → Logs**，啟用 **Enable logging**，重現問題後按下 **Download**。下載後會停止記錄日誌。只有在準備分享訊息內容時才啟用 **Include chat data**，並在發布前檢查檔案。

開發和測試說明請參閱 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 社群

- **[Discord](https://github.com/AMousePad/LumiRealm/wiki/Discord)**: Lumiverse 伺服器見!
- **[Issues](https://github.com/AMousePad/LumiRealm/issues)**: Bug 回報與功能請求。
- **[Wiki](https://github.com/AMousePad/LumiRealm/wiki)**: 使用者指南與架構深入說明。

## 授權條款

**GPL-3.0-or-later.** LumiRealm 是 [RisuAI](https://github.com/kwaroran/Risuai)（GPL-3.0，© 2024 Kwaroran）的衍生作品，包含為 Lumiverse 移植和調整的程式碼及樣式。

<p align="right">(<a href="#readme-top">回到頂端</a>)</p>
