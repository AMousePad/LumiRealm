<a name="readme-top"></a>

<div align="center">

<img src="../logo.png" alt="LumiRealm" width="640"/>

[English](../README.md) | [한국어](readme-ko_kr.md) | [日本語](readme-ja_jp.md) | [简体中文](readme-zh_cn.md) | [繁體中文](readme-zh_tw.md) | **Deutsch** | [Русский](readme-ru_ru.md)

[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](../LICENSE)
[![Lumiverse](https://img.shields.io/badge/Lumiverse-1.2.0%2B-blueviolet)](https://github.com/prolix-oc/Lumiverse)
[![RisuAI](https://img.shields.io/badge/RisuAI-port-9cf?logo=svelte)](https://github.com/kwaroran/Risuai)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-bundle-fbf0df?logo=bun)](https://bun.sh)

</div>

---

LumiRealm ist eine [Lumiverse](https://github.com/prolix-oc/Lumiverse)-Erweiterung, die [RisuAI](https://github.com/kwaroran/Risuai)-Charakterkarten, Module und Lorebooks in Lumiverse ausführt. Ein integrierter RisuRealm-Bot-Browser ist enthalten.

Die vollständige Anleitung findest du im **[Wiki](https://github.com/AMousePad/LumiRealm/wiki)**.

## Funktionen

- Importiere Charakterkarten aus `.charx`-, `.png`-, `.json`- und `.jpg`/`.jpeg`-Dateien oder durchsuche RisuRealm direkt in der Erweiterung.
- Importiere `.risum`- und `.charx`-Module, einzelne Lorebooks und Regex-Skripte. Weise Module einzelnen Charakteren zu oder aktiviere sie global.
- Führe CBS-Makros, Lua- und V2-Trigger, Anzeige-Regex und Lorebooks aus. Anzeige-Regex wird im Browser ausgeführt.
- Prüfe Karteninhalte unter **Viewer**, verwalte Chatvariablen und Schalter unter **State** und exportiere Karten und Module unter **Import**. Exportiere zugewiesene Module getrennt von der Karte.

## Screenshots

|                Beispielkarte                 |                       RisuRealm-Browser                       |
| :------------------------------------------: | :-----------------------------------------------------------: |
| ![1778064388761](../image/README/1778064388761.png) | ![1778064256839](../image/README/1778064256839.png) |

|                     Viewer                     |                    Zustand                     |
| :--------------------------------------------: | :--------------------------------------------: |
| ![1778064299483](../image/README/1778064299483.png) | ![1778064443131](../image/README/1778064443131.png) |

## Installation

Dieser Branch benötigt **Lumiverse 1.2.0 oder höher**, wie in [spindle.json](../spindle.json) angegeben. Weitere Entwicklungsabhängigkeiten stehen unten unter **Branches**.

1. Öffne deine Lumiverse-Instanz.
2. Öffne **Erweiterungen** in der Seitenleiste und füge hinzu:

   ```txt
   https://github.com/AMousePad/LumiRealm
   ```
3. Erteile alle von LumiRealm angeforderten Berechtigungen. [Warum?](https://github.com/AMousePad/LumiRealm/wiki/Architecture)
4. Aktiviere die Erweiterung. Der **LumiRealm**-Tab erscheint in der Seitenleiste.

## Branches

Wähle den Branch passend zu deiner Lumiverse-Version.

- **`main`** ist der Standard für veröffentlichte Lumiverse-Versionen.
- **`staging`** dient der Entwicklung und kann noch unveröffentlichte Lumiverse-Änderungen voraussetzen. Funktionen wechseln zu `main`, sobald die benötigten Änderungen im Host veröffentlicht sind.

Zum Wechseln öffne den Erweiterungs-Tab und nutze die Schaltfläche **Branch** beim LumiRealm-Eintrag.

## Kompatibilität

RisuAIs Verhalten ist die Referenz, die Kompatibilität ist jedoch nicht vollständig. Lumiverse übernimmt weiterhin Markdown, die HTML-Bereinigung und HTML-Inseln (isolierte Bereiche einer Nachricht). Karten, deren CSS oder Bedienelemente auf Elemente außerhalb einer Insel angewiesen sind, können anders aussehen oder funktionieren als in RisuAI.

## Fehler melden

Gib deine LumiRealm- und Lumiverse-Versionen samt Branches, Browser und Gerät, Schritte zum Reproduzieren und das Verhalten derselben Inhalte in RisuAI an.

Für ein Protokoll öffne **LumiRealm → Settings → Debug → Logs**, aktiviere **Enable logging**, reproduziere den Fehler und klicke auf **Download**. Der Download schaltet die Protokollierung aus. Aktiviere **Include chat data** nur, wenn du Nachrichteninhalte teilen möchtest, und prüfe die Datei vor dem Veröffentlichen.

Anleitungen zur Entwicklung und zu Tests findest du in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Community

- **[Discord](https://github.com/AMousePad/LumiRealm/wiki/Discord)**: Im Lumiverse-Server!
- **[Issues](https://github.com/AMousePad/LumiRealm/issues)**: Fehlerberichte und Funktionswünsche.
- **[Wiki](https://github.com/AMousePad/LumiRealm/wiki)**: Benutzerhandbuch und Architektur-Tiefgang.

## Lizenz

**GPL-3.0-or-later.** LumiRealm ist ein abgeleitetes Werk von [RisuAI](https://github.com/kwaroran/Risuai) (GPL-3.0, © 2024 Kwaroran) und enthält für Lumiverse portierten und angepassten Code sowie Styles.

<p align="right">(<a href="#readme-top">nach oben</a>)</p>
