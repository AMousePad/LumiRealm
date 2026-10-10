<a name="readme-top"></a>

<div align="center">

<img src="../logo.png" alt="LumiRealm" width="640"/>

[English](../README.md) | [한국어](readme-ko_kr.md) | **日本語** | [简体中文](readme-zh_cn.md) | [繁體中文](readme-zh_tw.md) | [Deutsch](readme-de_de.md) | [Русский](readme-ru_ru.md)

[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](../LICENSE)
[![Lumiverse](https://img.shields.io/badge/Lumiverse-1.2.0%2B-blueviolet)](https://github.com/prolix-oc/Lumiverse)
[![RisuAI](https://img.shields.io/badge/RisuAI-port-9cf?logo=svelte)](https://github.com/kwaroran/Risuai)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-bundle-fbf0df?logo=bun)](https://bun.sh)

</div>

---

LumiRealm は、[RisuAI](https://github.com/kwaroran/Risuai) のキャラクターカード、モジュール、ロアブックを [Lumiverse](https://github.com/prolix-oc/Lumiverse) 内で動作させる Lumiverse 拡張機能です。RisuRealm のボットブラウザを内蔵しています。

詳しいガイドは **[Wiki](https://github.com/AMousePad/LumiRealm/wiki)** をご覧ください。

## 機能

- `.charx`、`.png`、`.json`、`.jpg`/`.jpeg` のキャラクターカードをインポートできます。拡張機能内で RisuRealm を閲覧することもできます。
- `.risum` と `.charx` のモジュール、単独のロアブック、正規表現スクリプトをインポートできます。モジュールは個別のキャラクターに紐付けるか、グローバルに有効化できます。
- CBS マクロ、Lua・V2 トリガー、表示用の正規表現、ロアブックを実行します。表示用の正規表現はブラウザ内で実行されます。
- **Viewer** でカードの内容を確認し、**State** でチャット変数やトグルを管理し、**Import** からカードやモジュールをエクスポートできます。紐付けたモジュールはカードとは別にエクスポートしてください。

## スクリーンショット

|                  カード例                   |                       RisuRealm 検索                       |
| :------------------------------------------: | :--------------------------------------------------------: |
| ![1778064388761](../image/README/1778064388761.png) | ![1778064256839](../image/README/1778064256839.png) |

|                    ビューア                    |                     ステート                    |
| :--------------------------------------------: | :--------------------------------------------: |
| ![1778064299483](../image/README/1778064299483.png) | ![1778064443131](../image/README/1778064443131.png) |

## インストール

このブランチには、[spindle.json](../spindle.json) に記載のとおり **Lumiverse 1.2.0 以上** が必要です。開発版の追加要件は、下の **ブランチ** を参照してください。

1. Lumiverse のインスタンスを開きます。
2. サイドバーの **拡張機能** を開き、次を追加します:

   ```txt
   https://github.com/AMousePad/LumiRealm
   ```
3. LumiRealm が要求するすべての権限を許可してください。[なぜ?](https://github.com/AMousePad/LumiRealm/wiki/Architecture)
4. 拡張を有効にすると、サイドバーに **LumiRealm** タブが表示されます。

## ブランチ

使用中の Lumiverse に合ったブランチを選んでください。

- **`main`** は、リリース済みの Lumiverse 向けの既定ブランチです。
- **`staging`** は開発用で、未リリースの Lumiverse の変更が必要な場合があります。ホスト側の必要な変更がリリースされると、機能が `main` に移ります。

ブランチを切り替えるには、拡張機能タブで LumiRealm の **Branch** ボタンを使ってください。

## 互換性

RisuAI の動作を基準としていますが、互換性は完全ではありません。Markdown、HTML のサニタイズ、HTML アイランド（メッセージ内の分離された領域）は引き続き Lumiverse が処理します。CSS や操作部品がアイランド外の要素に依存するカードは、RisuAI と表示や動作が異なる場合があります。

## バグ報告

LumiRealm と Lumiverse のバージョンとブランチ、ブラウザと端末、再現手順、同じ内容が RisuAI でどう動作するかを記載してください。

ログを取得するには、**LumiRealm → Settings → Debug → Logs** で **Enable logging** を有効にし、問題を再現してから **Download** を押してください。ダウンロードするとログ記録は停止します。メッセージ内容を共有する場合に限り **Include chat data** を有効にし、投稿前にファイルを確認してください。

開発とテストの手順は [CONTRIBUTING.md](../CONTRIBUTING.md) を参照してください。

## コミュニティ

- **[Discord](https://github.com/AMousePad/LumiRealm/wiki/Discord)**: Lumiverse サーバーでお会いしましょう!
- **[Issues](https://github.com/AMousePad/LumiRealm/issues)**: バグ報告と機能リクエスト。
- **[Wiki](https://github.com/AMousePad/LumiRealm/wiki)**: ユーザーガイドとアーキテクチャ詳細解説。

## ライセンス

**GPL-3.0-or-later.** LumiRealm は [RisuAI](https://github.com/kwaroran/Risuai) (GPL-3.0, © 2024 Kwaroran) の派生著作物で、Lumiverse 向けに移植・調整したコードとスタイルを含みます。

<p align="right">(<a href="#readme-top">トップへ戻る</a>)</p>
