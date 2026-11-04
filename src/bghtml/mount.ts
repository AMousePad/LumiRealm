import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { resetNativeControls } from "../display/risu-button-click.js";

// Shadow-DOM mount for a card's background_html. One mount per chat.

export interface BgMountOptions {
  readonly target?: HTMLElement;
  /** Override the host placement. Default `'first-child'`.
   *  `'last-child'` causes the host to paint over Lumi chrome (regression). */
  readonly placement?: 'first-child' | 'last-child';
}

export interface BgMountHandle {
  /** Replace the HTML content of the slot without rebuilding the shadow. */
  updateHtml(html: string): void;
  updateCss(css: string): void;
  resetNativeControls(): void;
  /** Unmount and remove from DOM. Idempotent. */
  destroy(): void;
}

const HOST_HOST_CSS = `
:host {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
:host > div.chattext {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
:host > div.chattext > [data-risu-bg-slot] {
  width: 100%;
  height: 100%;
  pointer-events: none;
}
:host > div.chattext :is(a, button, [role='button'], input, textarea,
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
  // Inline fallback in case :host rules haven't computed yet at mount time.
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

  const shadow = host.attachShadow({ mode: "open" });

  const baseStyle = document.createElement("style");
  baseStyle.setAttribute("data-risu-bg-base", "");
  baseStyle.textContent = HOST_HOST_CSS;
  shadow.appendChild(baseStyle);

  const cardStyle = document.createElement("style");
  cardStyle.setAttribute("data-risu-bg-card", "");
  shadow.appendChild(cardStyle);

  const chattext = document.createElement("div");
  chattext.className = "chattext";
  shadow.appendChild(chattext);

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
