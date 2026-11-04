import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { resetNativeControls } from "../display/risu-button-click.js";

// Risu renders background html in the chat's document: cards pair labels and :has() rules in messages with inputs here, and neither crosses a shadow boundary.
export const BG_HOST_SELECTOR = "[data-risu-bg-host]";

export const BG_CSS_SCOPE = {
  scopePrefix: `${BG_HOST_SELECTOR} .chattext `,
  hostSelector: BG_HOST_SELECTOR,
} as const;

export interface BgMountOptions {
  readonly target?: HTMLElement;
  /** Override the host placement. Default `'first-child'`.
   *  `'last-child'` causes the host to paint over Lumi chrome (regression). */
  readonly placement?: 'first-child' | 'last-child';
}

export interface BgMountHandle {
  updateHtml(html: string): void;
  updateCss(css: string): void;
  resetNativeControls(): void;
  /** Unmount and remove from DOM. Idempotent. */
  destroy(): void;
}

const HOST_BASE_CSS = `
${BG_HOST_SELECTOR} {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
${BG_HOST_SELECTOR} > div.chattext {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
${BG_HOST_SELECTOR} > div.chattext > [data-risu-bg-slot] {
  width: 100%;
  height: 100%;
  pointer-events: none;
}
${BG_HOST_SELECTOR} > div.chattext :is(a, button, [role='button'], input, textarea,
  select, [data-rc-trigger]) {
  pointer-events: auto;
}
`.trim();

export function mountBgHost(
  ctx: SpindleFrontendContext,
  opts: BgMountOptions = {},
): BgMountHandle {
  const host = ctx.dom.createElement("div", {
    "data-risu-bg-host": "",
  });
  host.style.position = "absolute";
  host.style.inset = "0";
  host.style.pointerEvents = "none";

  const target = opts.target ?? document.body;
  const placement = opts.placement ?? "first-child";
  if (placement === "first-child" && target.firstChild) {
    target.insertBefore(host, target.firstChild);
  } else {
    target.appendChild(host);
  }

  const baseStyle = document.createElement("style");
  baseStyle.setAttribute("data-risu-bg-base", "");
  baseStyle.textContent = HOST_BASE_CSS;
  host.appendChild(baseStyle);

  const cardStyle = document.createElement("style");
  cardStyle.setAttribute("data-risu-bg-card", "");
  host.appendChild(cardStyle);

  const chattext = document.createElement("div");
  chattext.className = "chattext";
  host.appendChild(chattext);

  const slot = document.createElement("div");
  slot.setAttribute("data-risu-bg-slot", "");
  chattext.appendChild(slot);

  let destroyed = false;
  return {
    updateHtml(html: string): void {
      if (destroyed) return;
      slot.innerHTML = html;
    },
    updateCss(css: string): void {
      if (destroyed) return;
      if (cardStyle.textContent === css) return;
      cardStyle.textContent = css;
    },
    resetNativeControls(): void {
      if (!destroyed) resetNativeControls(slot);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      host.remove();
    },
  };
}
