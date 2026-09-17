import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { splitAndRewriteBgBundle, unprefixCssClassSelectors } from "./rewriter.js";
import { mountBgHost, type BgMountHandle } from "./mount.js";
import { stripCssImports, splitCssImports } from "./strip-imports.js";
import { setupIslandStyles } from "./island-styles.js";

// Lumi renders message-embedded HTML with no .chattext ancestor. Inject a
// chat-scope stylesheet into document.head scoped to [data-message-id]. One
// style element per chat, replaced on chat-switch, removed on dismount.

const CHAT_SCOPE_STYLE_ID = "risu-compat-chat-scope-css";

function upsertChatScopeStyle(css: string): void {
  let el = document.getElementById(CHAT_SCOPE_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = CHAT_SCOPE_STYLE_ID;
    el.setAttribute("data-risu-compat", "chat-scope");
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

function removeChatScopeStyle(): void {
  const el = document.getElementById(CHAT_SCOPE_STYLE_ID);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

// Frontend bg-HTML orchestrator. One mount per chat.

export interface BgHtmlMessage {
  readonly type: "render_bg_html";
  readonly chatId: string;
  readonly bgHtml: string;
}

export interface BgHtmlClearMessage {
  readonly type: "clear_bg_html";
  readonly chatId: string;
}

export interface BgHtmlRenderer {
  setActiveChat(chatId: string | null): void;
  handleMessage(msg: BgHtmlMessage | BgHtmlClearMessage): void;
  destroy(): void;
}

interface Flog {
  error(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
  info(msg: string, ...rest: unknown[]): void;
  debug(msg: string, ...rest: unknown[]): void;
  trace(msg: string, ...rest: unknown[]): void;
}

export function setupBgHtmlRenderer(
  ctx: SpindleFrontendContext,
  flog: Flog,
): BgHtmlRenderer {
  flog.info("bg-html renderer: init");

  let activeChatId: string | null = null;
  let handle: BgMountHandle | null = null;
  let lastCss: string | null = null;
  const islandStyles = setupIslandStyles();

  function dismount(): void {
    if (handle) {
      flog.info(`bg-html renderer: dismount chatId=${activeChatId}`);
      handle.destroy();
      handle = null;
      lastCss = null;
    }
    removeChatScopeStyle();
    islandStyles.setStylesheets([]);
    activeChatId = null;
  }

  return {
    setActiveChat(chatId): void {
      if (activeChatId !== chatId) dismount();
      islandStyles.setActiveChat(chatId);
    },
    handleMessage(msg: BgHtmlMessage | BgHtmlClearMessage): void {
      if (msg.type === "clear_bg_html") {
        // Chat-switch to a card with empty bg-html sends clear for the new
        // chatId. activeChatId still points at the old chat, so the old guard
        // `activeChatId === msg.chatId` skipped dismount and the old chat's
        // chat-scope style leaked onto the new chat's content.
        if (activeChatId !== null && activeChatId !== msg.chatId) {
          flog.info(
            `bg-html renderer: chat-switch to empty bg, dismounting prior chat=${activeChatId}`,
          );
        }
        dismount();
        return;
      }
      // render_bg_html
      if (msg.chatId !== activeChatId) {
        dismount();
        activeChatId = msg.chatId;
      }
      let bundle;
      try {
        bundle = splitAndRewriteBgBundle(msg.bgHtml);
      } catch (err) {
        flog.error("bg-html renderer: rewrite failed", err);
        return;
      }
      if (!handle) {
        flog.info(`bg-html renderer: mount chatId=${msg.chatId} html_len=${bundle.html.length} css_len=${bundle.css.length}`);
        handle = mountBgHost(ctx);
      }
      const cssChanged = bundle.css !== lastCss;
      if (cssChanged) {
        handle.updateCss(bundle.css);
        lastCss = bundle.css;
      }
      handle.updateHtml(bundle.html);
      // Chat-scope injection for display-regex-embedded HTML.
      let chatBundle;
      try {
        chatBundle = splitAndRewriteBgBundle(msg.bgHtml, {
          scopePrefix: "[data-message-id] ",
          // Universal selectors become :host-scoped, inert at document level.
          rewriteUniversalToHost: true,
          rewriteClassNames: false,
        });
        chatBundle = { ...chatBundle, css: unprefixCssClassSelectors(chatBundle.css) };
      } catch (err) {
        flog.error("bg-html renderer: chat-scope rewrite failed", err);
        chatBundle = null;
      }
      if (chatBundle) {
        const islandBundle = splitAndRewriteBgBundle(msg.bgHtml, {
          scopePrefix: ':host ',
          rewriteUniversalToHost: false,
          rewriteClassNames: false,
        });
        const cleanCss = (css: string) => unprefixCssClassSelectors(stripCssImports(css));
        islandStyles.setStylesheets([cleanCss(islandBundle.css)]);
        // [data-message-id] img specificity (0,1,1) beats Lumi's .proseImage (0,1,0).
        // Risu leaves image height to the author; a viewport cap shrinks layered backdrops.
        const imgReset =
          "[data-message-id] img { max-width: 100%; max-height: none; }\n";
        // Lumi sets overflow:hidden + contain:layout, which clips absolute
        // hover popups and creates a containing block for position:fixed.
        // The per-chat extension-relaxed mode handles fixed, drop both for Risu chats.
        const bubbleContainment =
          "[data-message-id] { overflow: visible !important; contain: none !important; }\n";
        // @import must precede other rules. Hoist them back to top after
        // preamble prepend, or Google Fonts silently stops loading.
        const { imports, rest } = splitCssImports(chatBundle.css);
        const chatScopeCss =
          (imports ? imports + "\n" : "")
          + imgReset
          + bubbleContainment
          + rest;
        upsertChatScopeStyle(chatScopeCss);
        flog.info(
          `bg-html renderer: chat-scope CSS injected css_len=${chatScopeCss.length} ` +
            `(imports_hoisted_len=${imports.length}, body_len=${rest.length}, ` +
            `+img-reset +bubble-containment preambles)`,
        );
      }
      flog.info(
        `bg-html renderer: applied chatId=${msg.chatId} html_len=${bundle.html.length} css_len=${bundle.css.length} css_changed=${cssChanged}`,
      );
    },
    destroy(): void {
      dismount();
      islandStyles.destroy();
    },
  };
}
