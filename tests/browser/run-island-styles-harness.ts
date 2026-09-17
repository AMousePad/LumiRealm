import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';

const built = await Bun.build({ entrypoints: ['src/bghtml/island-styles.ts', 'src/bghtml/render.ts'], target: 'browser' });
assert(built.success, built.logs.join('\n'));
const scripts = new Map(await Promise.all(built.outputs.map(async output => [output.path.split(/[\\/]/).at(-1), await output.text()] as const)));

for (const engine of [chromium, firefox]) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://islands.test/**', route => route.fulfill({
      contentType: route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html',
      body: scripts.get(new URL(route.request().url()).pathname.slice(1)) ?? '<!doctype html><html><head></head><body></body></html>',
    }));
    await page.goto('http://islands.test/');
    await page.addScriptTag({ type: 'module', content:
      `import {setupIslandStyles} from '/island-styles.js'; import {setupBgHtmlRenderer} from '/render.js';
       window.manager = setupIslandStyles(); window.setupBgHtmlRenderer = setupBgHtmlRenderer;` });
    await page.waitForFunction(() => !!(window as any).manager);
    const result = await page.evaluate(async () => {
      const manager = (window as any).manager;
      document.head.insertAdjacentHTML('beforeend', '<style>.narration{font:23px/31px Georgia;color:rgb(11,22,33)}</style>');
      document.body.innerHTML = '<div data-message-id="message"><p class="narration">Themed narration</p><div data-lumiverse-html-island></div></div>';
      const host = document.querySelector('[data-lumiverse-html-island]')!;
      const root = host.attachShadow({ mode: 'open' });
      const base = '<style data-lumi-island-base>:host{font-size:14px;line-height:1.65}h1{font-size:1.35em}*,*::before,*::after{box-sizing:border-box}</style>';
      const html = '<div class="panel"><img style="width:40px;height:40px" alt="" /><div class="layer">Overlay</div></div>'
        + '<section style="font-size:11px"><h1>Menu</h1></section>'
        + '<button data-lumiverse-regex-action="preserved">Choose</button>';
      root.innerHTML = base + html;
      const prose = document.querySelector('.narration')!;
      const proseStyle = () => { const s = getComputedStyle(prose); return [s.fontFamily, s.fontSize, s.lineHeight, s.color]; };
      const before = proseStyle();
      const foreign = new CSSStyleSheet();
      foreign.replaceSync('button{color:rgb(44,55,66)}');
      root.adoptedStyleSheets = [foreign];
      manager.setActiveChat('first');
      manager.setStylesheets([':host .panel{position:relative;width:300px;height:300px}.panel .layer{position:absolute;inset:0}']);
      const panel = root.querySelector('.panel')!;
      const layer = root.querySelector('.layer')!;
      const heading = root.querySelector('h1')!;
      const metrics = {
        width: getComputedStyle(panel).width, height: getComputedStyle(panel).height,
        position: getComputedStyle(layer).position,
        overlapping: layer.getBoundingClientRect().top === panel.getBoundingClientRect().top,
        headingSize: getComputedStyle(heading).fontSize,
        lineHeight: getComputedStyle(host).lineHeight,
        action: root.querySelector('button')!.getAttribute('data-lumiverse-regex-action'),
        actionColor: getComputedStyle(root.querySelector('button')!).color,
      };
      const sheets = Array.from(root.adoptedStyleSheets);
      root.innerHTML = html;
      const replacementHasStyles = root.adoptedStyleSheets.every((s, i) => s === sheets[i])
        && getComputedStyle(root.querySelector('.layer')!).position === 'absolute';
      manager.setActiveChat('second');
      const cleared = getComputedStyle(root.querySelector('.layer')!).position === 'static';
      manager.setActiveChat(null);
      const restored = root.adoptedStyleSheets.length === 1 && root.adoptedStyleSheets[0] === foreign
        && !!root.querySelector('[data-lumi-island-base]') && !host.classList.contains('not-island-prose');
      const nativeHeadingSize = getComputedStyle(root.querySelector('h1')!).fontSize;
      manager.destroy();
      return { metrics, before, after: proseStyle(), replacementHasStyles, cleared, restored, nativeHeadingSize };
    });
    assert.deepEqual(result.metrics, {
      width: '300px', height: '300px', position: 'absolute', overlapping: true,
      headingSize: '24.75px', lineHeight: '20px', action: 'preserved', actionColor: 'rgb(44, 55, 66)',
    });
    assert.deepEqual(result.before, result.after);
    assert(result.replacementHasStyles);
    assert(result.cleared);
    assert(result.restored);
    assert.equal(result.nativeHeadingSize, '14.85px');
    const renderedStyles = await page.evaluate(async () => {
      const manager = (window as any).manager;
      document.body.innerHTML = '<div data-message-id="screen"><div data-component="MessageContent"><div data-lumiverse-html-island></div><div class="window">Light DOM panel</div></div></div>';
      const host = document.querySelector('[data-lumiverse-html-island]')!;
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<div class="window">Game window</div>';
      manager.setActiveChat('screen');
      const panel = shadow.querySelector('.window')!;
      const light = document.querySelector('.window')!;
      const visibility = (el: Element) => {
        const css = getComputedStyle(el);
        return [css.opacity, css.visibility, css.animationName];
      };
      const initial = visibility(panel);
      const other = document.createElement('div');
      other.setAttribute('data-lumiverse-html-island', '');
      const source = other.attachShadow({ mode: 'open' });
      source.innerHTML = '<style>.window{opacity:0;visibility:hidden;animation:reveal 2s 26.5s forwards}@keyframes reveal{to{opacity:1;visibility:visible}}</style>';
      host.parentElement!.prepend(other);
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await settle();
      const withIntro = visibility(panel);
      const sharedWithLight = visibility(light);
      source.innerHTML = '';
      await settle();
      const withoutIntro = visibility(panel);
      const lightCleared = visibility(light);
      manager.setStylesheets(['.window{color:rgb(1,2,3)}', '.window{color:rgb(4,5,6)}', '.window{color:rgb(1,2,3)}']);
      const repeatedRuleColor = getComputedStyle(panel).color;
      manager.destroy();
      return { initial, withIntro, sharedWithLight, withoutIntro, lightCleared, repeatedRuleColor };
    });
    assert.deepEqual(renderedStyles.initial, ['1', 'visible', 'none']);
    assert.deepEqual(renderedStyles.withIntro, ['0', 'hidden', 'reveal']);
    assert.deepEqual(renderedStyles.sharedWithLight, ['0', 'hidden', 'reveal']);
    assert.deepEqual(renderedStyles.withoutIntro, ['1', 'visible', 'none']);
    assert.deepEqual(renderedStyles.lightCleared, ['1', 'visible', 'none']);
    assert.equal(renderedStyles.repeatedRuleColor, 'rgb(1, 2, 3)');
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const images = await page.evaluate(async () => {
        document.body.innerHTML = '<div data-message-id="scene"><div class="prose"><div class="backdrop"><img alt="" /></div><div class="frame"><img alt="" /></div></div></div>';
        const nativeStyle = document.createElement('style');
        nativeStyle.textContent = '.prose img{max-width:100%;max-height:240px;object-fit:contain}';
        document.head.append(nativeStyle);
        const ctx = { dom: { createElement(tag: string, attrs: Record<string, string>) {
          const el = document.createElement(tag);
          for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
          return el;
        } } };
        const noop = () => {};
        const renderer = (window as any).setupBgHtmlRenderer(ctx, { info: noop, debug: noop, trace: noop, warn: noop, error: noop });
        renderer.setActiveChat('scene');
        renderer.handleMessage({ type: 'render_bg_html', chatId: 'scene', bgHtml: '<style>'
          + '.backdrop{position:relative;height:55vh}.backdrop img{position:absolute;top:75%;width:100%;height:250%;object-fit:cover}'
          + '.frame{position:relative;height:100vh}.frame img{position:absolute;bottom:3%;width:100%;height:60%;object-fit:cover}'
          + '</style>' });
        await Promise.all(Array.from(document.querySelectorAll('img'), async img => {
          img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="blue"/></svg>');
          await img.decode();
        }));
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const backdrop = box('.backdrop'), image = box('.backdrop img'), frame = box('.frame'), panel = box('.frame img');
        const result = { height: image.height, expectedHeight: backdrop.height * 2.5,
          top: image.top - backdrop.top, expectedTop: backdrop.height * 0.75,
          frameHeight: panel.height, expectedFrameHeight: frame.height * 0.6,
          frameBottom: frame.bottom - panel.bottom, expectedFrameBottom: frame.height * 0.03 };
        renderer.destroy();
        const nativeCap = getComputedStyle(document.querySelector('img')!).maxHeight;
        nativeStyle.remove();
        return { ...result, nativeCap };
      });
      assert(Math.abs(images.height - images.expectedHeight) < 0.1, JSON.stringify(images));
      assert(Math.abs(images.top - images.expectedTop) < 0.1);
      assert(Math.abs(images.frameHeight - images.expectedFrameHeight) < 0.1);
      assert(Math.abs(images.frameBottom - images.expectedFrameBottom) < 0.1);
      assert.equal(images.nativeCap, '240px');
    }
    assert.deepEqual(errors, []);
    console.log(`${engine.name()}: island layout, typography, theme, replacement and cleanup checks passed`);
  } finally {
    await browser.close();
  }
}
