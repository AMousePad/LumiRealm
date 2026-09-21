<a name="readme-top"></a>

<div align="center">

<img src="logo.png" alt="LumiRealm" width="640"/>

English | [한국어](.github/readme-ko_kr.md) | [日本語](.github/readme-ja_jp.md) | [简体中文](.github/readme-zh_cn.md) | [繁體中文](.github/readme-zh_tw.md) | [Deutsch](.github/readme-de_de.md) | [Русский](.github/readme-ru_ru.md)

[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)
[![Lumiverse](https://img.shields.io/badge/Lumiverse-1.2.0%2B-blueviolet)](https://github.com/prolix-oc/Lumiverse)
[![RisuAI](https://img.shields.io/badge/RisuAI-port-9cf?logo=svelte)](https://github.com/kwaroran/Risuai)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-bundle-fbf0df?logo=bun)](https://bun.sh)

</div>

---

LumiRealm is a [Lumiverse](https://github.com/prolix-oc/Lumiverse) extension that runs [RisuAI](https://github.com/kwaroran/Risuai) character cards, modules, and lorebooks inside Lumiverse. Includes an inbuilt RisuRealm bot browser.

Full guide on the **[Wiki](https://github.com/AMousePad/LumiRealm/wiki)**.

## Features

- Import character cards from `.charx`, `.png`, `.json`, and `.jpg`/`.jpeg` files, or browse RisuRealm in the extension.
- Import `.risum` and `.charx` modules, standalone lorebooks, and regex scripts. Attach modules to individual characters or enable them globally.
- Run CBS macros, Lua and V2 triggers, display regex, and lorebooks. Display regex runs in the browser.
- Inspect card contents in **Viewer**, manage chat variables and toggles in **State**, and export cards and modules from **Import**. Export attached modules separately from the card.

## Screenshots

|                  Example Card                  |                                                    RisuRealm browse                                                    |
| :--------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------: |
| ![1778064388761](image/README/1778064388761.png) | ![1778064256839](image/README/1778064256839.png) |

|                     Viewer                     |                     State                     |
| :--------------------------------------------: | :--------------------------------------------: |
| ![1778064299483](image/README/1778064299483.png) | ![1778064443131](image/README/1778064443131.png) |

## Installation

The baseline requirement is **Lumiverse 1.2.0 or later**, as declared in [spindle.json](spindle.json). The current `staging` branch also requires the host changes described under **Branches** below.

1. Open your Lumiverse instance.
2. Open **Extensions** in the sidebar and add:

   ```txt
   https://github.com/AMousePad/LumiRealm
   ```
3. Grant all permissions requested by LumiRealm. [Why?](https://github.com/AMousePad/LumiRealm/wiki/Architecture)
4. Enable the extension. The **LumiRealm** tab appears in the sidebar.

## Branches

Pick the branch that matches the Lumiverse you're running.

- **`main`** is the default for released Lumiverse versions.
- **`staging`** currently requires the companion Lumiverse frontend runtime changes, including document routing, runtime state, required generation hooks, and display/macro processing contracts. The baseline version alone is insufficient. Features move to `main` when their host dependencies are released.

To switch branches after installing, go to the extensions tab and use the **Branch** button on the LumiRealm entry.

## Compatibility

RisuAI's behavior is the reference, but compatibility is not complete. Lumiverse still handles Markdown, HTML sanitization, and HTML islands (isolated sections of a message). Cards whose CSS or controls rely on elements outside an island can render or behave differently from RisuAI.

## Reporting bugs

Include your LumiRealm and Lumiverse versions and branches, browser/device, reproduction steps, and how the same content behaves in RisuAI.

To capture a log, open **LumiRealm → Settings → Debug → Logs**, turn on **Enable logging**, reproduce the problem, then click **Download**. Downloading turns logging off. Enable **Include chat data** only if you intend to share message content, and review the file before posting it.

For development and testing instructions, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Community

- **[Discord](https://github.com/AMousePad/LumiRealm/wiki/Discord)**: In the Lumiverse server!
- **[Issues](https://github.com/AMousePad/LumiRealm/issues)**: bug reports + feature requests.
- **[Wiki](https://github.com/AMousePad/LumiRealm/wiki)**: user guide + architecture deep-dive.

## License

**GPL-3.0-or-later.** LumiRealm is a derivative work of [RisuAI](https://github.com/kwaroran/Risuai) (GPL-3.0, © 2024 Kwaroran), with code and styles ported and adapted for Lumiverse.

<p align="right">(<a href="#readme-top">back to top</a>)</p>
