<a name="readme-top"></a>

<div align="center">

<img src="../logo.png" alt="LumiRealm" width="640"/>

[English](../README.md) | **한국어** | [日本語](readme-ja_jp.md) | [简体中文](readme-zh_cn.md) | [繁體中文](readme-zh_tw.md) | [Deutsch](readme-de_de.md) | [Русский](readme-ru_ru.md)

[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](../LICENSE)
[![Lumiverse](https://img.shields.io/badge/Lumiverse-1.2.0%2B-blueviolet)](https://github.com/prolix-oc/Lumiverse)
[![RisuAI](https://img.shields.io/badge/RisuAI-port-9cf?logo=svelte)](https://github.com/kwaroran/Risuai)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-bundle-fbf0df?logo=bun)](https://bun.sh)

</div>

---

LumiRealm은 [RisuAI](https://github.com/kwaroran/Risuai) 캐릭터 카드, 모듈, 로어북을 [Lumiverse](https://github.com/prolix-oc/Lumiverse) 안에서 실행하는 Lumiverse 확장입니다. RisuRealm 봇 브라우저가 내장되어 있습니다.

자세한 안내는 **[위키](https://github.com/AMousePad/LumiRealm/wiki)** 를 참고하세요.

## 기능

- `.charx`, `.png`, `.json`, `.jpg`/`.jpeg` 캐릭터 카드를 가져오거나 확장 안에서 RisuRealm을 탐색할 수 있습니다.
- `.risum` 및 `.charx` 모듈, 별도의 로어북과 정규식 스크립트를 가져올 수 있습니다. 모듈은 개별 캐릭터에 연결하거나 전역으로 활성화할 수 있습니다.
- CBS 매크로, Lua 및 V2 트리거, 표시용 정규식, 로어북을 실행합니다. 표시용 정규식은 브라우저에서 실행됩니다.
- **Viewer**에서 카드 내용을 확인하고, **State**에서 채팅 변수와 토글을 관리하며, **Import**에서 카드와 모듈을 내보낼 수 있습니다. 연결된 모듈은 카드와 별도로 내보내야 합니다.

## 스크린샷

|                  예시 카드                   |                       RisuRealm 탐색                       |
| :------------------------------------------: | :--------------------------------------------------------: |
| ![1778064388761](../image/README/1778064388761.png) | ![1778064256839](../image/README/1778064256839.png) |

|                      뷰어                      |                      상태                      |
| :--------------------------------------------: | :--------------------------------------------: |
| ![1778064299483](../image/README/1778064299483.png) | ![1778064443131](../image/README/1778064443131.png) |

## 설치

이 브랜치는 [spindle.json](../spindle.json)에 명시된 대로 **Lumiverse 1.2.0 이상**이 필요합니다. 개발 버전의 추가 요구 사항은 아래 **브랜치** 항목을 참고하세요.

1. Lumiverse 인스턴스를 엽니다.
2. 사이드바의 **확장**을 열고 다음을 추가합니다:

   ```txt
   https://github.com/AMousePad/LumiRealm
   ```
3. LumiRealm이 요청하는 모든 권한을 허용하세요. [이유는?](https://github.com/AMousePad/LumiRealm/wiki/Architecture)
4. 확장을 활성화하면 사이드바에 **LumiRealm** 탭이 표시됩니다.

## 브랜치

사용 중인 Lumiverse에 맞는 브랜치를 선택하세요.

- **`main`**은 정식 출시된 Lumiverse 버전을 위한 기본 브랜치입니다.
- **`staging`**은 개발용이며 아직 출시되지 않은 Lumiverse 변경 사항이 필요할 수 있습니다. 필요한 호스트 변경 사항이 출시되면 해당 기능이 `main`으로 이동합니다.

브랜치를 바꾸려면 확장 탭에서 LumiRealm 항목의 **Branch** 버튼을 사용하세요.

## 호환성

RisuAI의 동작을 기준으로 삼지만 호환성이 완전하지는 않습니다. Markdown, HTML 정제, HTML 아일랜드(메시지 안의 격리된 영역)는 여전히 Lumiverse가 처리합니다. CSS나 조작 요소가 아일랜드 밖의 요소에 의존하는 카드는 RisuAI와 다르게 표시되거나 동작할 수 있습니다.

## 버그 신고

LumiRealm과 Lumiverse의 버전 및 브랜치, 브라우저와 기기, 재현 단계, 같은 콘텐츠가 RisuAI에서 어떻게 동작하는지 알려주세요.

로그를 수집하려면 **LumiRealm → Settings → Debug → Logs**에서 **Enable logging**을 켜고 문제를 재현한 뒤 **Download**를 누르세요. 다운로드하면 로그 기록이 꺼집니다. 메시지 내용을 공유하려는 경우에만 **Include chat data**를 켜고, 게시하기 전에 파일을 확인하세요.

개발 및 테스트 방법은 [CONTRIBUTING.md](../CONTRIBUTING.md)를 참고하세요.

## 커뮤니티

- **[Discord](https://github.com/AMousePad/LumiRealm/wiki/Discord)**: Lumiverse 서버에서 만나요!
- **[이슈](https://github.com/AMousePad/LumiRealm/issues)**: 버그 신고와 기능 요청.
- **[위키](https://github.com/AMousePad/LumiRealm/wiki)**: 사용자 가이드와 아키텍처 심층 분석.

## 라이선스

**GPL-3.0-or-later.** LumiRealm은 [RisuAI](https://github.com/kwaroran/Risuai) (GPL-3.0, © 2024 Kwaroran)의 파생 저작물이며, Lumiverse용으로 포팅하고 수정한 코드와 스타일을 포함합니다.

<p align="right">(<a href="#readme-top">맨 위로</a>)</p>
