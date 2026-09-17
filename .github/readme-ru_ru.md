<a name="readme-top"></a>

<div align="center">

<img src="../logo.png" alt="LumiRealm" width="640"/>

[English](../README.md) | [한국어](readme-ko_kr.md) | [日本語](readme-ja_jp.md) | [简体中文](readme-zh_cn.md) | [繁體中文](readme-zh_tw.md) | [Deutsch](readme-de_de.md) | **Русский**

[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](../LICENSE)
[![Lumiverse](https://img.shields.io/badge/Lumiverse-1.2.0%2B-blueviolet)](https://github.com/prolix-oc/Lumiverse)
[![RisuAI](https://img.shields.io/badge/RisuAI-port-9cf?logo=svelte)](https://github.com/kwaroran/Risuai)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-bundle-fbf0df?logo=bun)](https://bun.sh)

</div>

---

LumiRealm — это расширение [Lumiverse](https://github.com/prolix-oc/Lumiverse), которое запускает карточки персонажей, модули и лорбуки [RisuAI](https://github.com/kwaroran/Risuai) непосредственно внутри Lumiverse. Включает встроенный браузер ботов RisuRealm.

Полное руководство — в **[Wiki](https://github.com/AMousePad/LumiRealm/wiki)**.

## Возможности

- Импорт карточек персонажей из файлов `.charx`, `.png`, `.json` и `.jpg`/`.jpeg`, а также поиск в RisuRealm прямо в расширении.
- Импорт модулей `.risum` и `.charx`, отдельных лорбуков и regex-скриптов. Модули можно подключать к отдельным персонажам или включать глобально.
- Выполнение CBS-макросов, Lua- и V2-триггеров, regex для отображения и лорбуков. Regex для отображения выполняются в браузере.
- Просмотр содержимого карточек в **Viewer**, управление переменными чата и переключателями в **State**, экспорт карточек и модулей в **Import**. Подключённые модули нужно экспортировать отдельно от карточки.

## Скриншоты

|              Пример карточки               |                       Поиск в RisuRealm                       |
| :----------------------------------------: | :----------------------------------------------------------: |
| ![1778064388761](../image/README/1778064388761.png) | ![1778064256839](../image/README/1778064256839.png) |

|                    Просмотрщик                    |                  Состояние                  |
| :--------------------------------------------: | :--------------------------------------------: |
| ![1778064299483](../image/README/1778064299483.png) | ![1778064443131](../image/README/1778064443131.png) |

## Установка

Эта ветка требует **Lumiverse 1.2.0 или новее**, как указано в [spindle.json](../spindle.json). Дополнительные зависимости версии для разработки описаны ниже в разделе **Ветки**.

1. Откройте свой инстанс Lumiverse.
2. Откройте **Расширения** на боковой панели и добавьте:

   ```txt
   https://github.com/AMousePad/LumiRealm
   ```
3. Предоставьте все разрешения, запрашиваемые LumiRealm. [Почему?](https://github.com/AMousePad/LumiRealm/wiki/Architecture)
4. Включите расширение. Вкладка **LumiRealm** появится в боковой панели.

## Ветки

Выберите ветку, соответствующую вашей версии Lumiverse.

- **`main`** — ветка по умолчанию для выпущенных версий Lumiverse.
- **`staging`** предназначена для разработки и может требовать ещё не выпущенных изменений Lumiverse. Возможности переносятся в `main`, когда необходимые изменения хоста выходят в релизе.

Для смены ветки откройте вкладку расширений и нажмите **Branch** у LumiRealm.

## Совместимость

Поведение RisuAI служит эталоном, но совместимость пока неполная. Lumiverse по-прежнему обрабатывает Markdown, очистку HTML и HTML-острова (изолированные части сообщения). Карточки, чьи CSS или элементы управления зависят от элементов за пределами острова, могут выглядеть или работать иначе, чем в RisuAI.

## Сообщения об ошибках

Укажите версии и ветки LumiRealm и Lumiverse, браузер и устройство, шаги воспроизведения и поведение того же содержимого в RisuAI.

Для записи журнала откройте **LumiRealm → Settings → Debug → Logs**, включите **Enable logging**, воспроизведите ошибку и нажмите **Download**. Скачивание отключает запись журнала. Включайте **Include chat data** только если намерены поделиться содержимым сообщений, и проверьте файл перед публикацией.

Инструкции по разработке и тестированию приведены в [CONTRIBUTING.md](../CONTRIBUTING.md).

## Сообщество

- **[Discord](https://github.com/AMousePad/LumiRealm/wiki/Discord)**: На сервере Lumiverse!
- **[Issues](https://github.com/AMousePad/LumiRealm/issues)**: отчёты об ошибках и пожелания.
- **[Wiki](https://github.com/AMousePad/LumiRealm/wiki)**: руководство пользователя и подробный разбор архитектуры.

## Лицензия

**GPL-3.0-or-later.** LumiRealm — производная работа от [RisuAI](https://github.com/kwaroran/Risuai) (GPL-3.0, © 2024 Kwaroran), содержащая код и стили, перенесённые и адаптированные для Lumiverse.

<p align="right">(<a href="#readme-top">наверх</a>)</p>
