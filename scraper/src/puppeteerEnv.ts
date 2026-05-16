// src/puppeteerEnv.ts
import puppeteer, { Browser, Page } from 'puppeteer';
import { ensureDirInRepo } from './repoPaths';

let browser: Browser | undefined;
let page: Page | undefined;

const DEFAULT_VIEWPORT = {
  width: 1220,
  height: 1080,
};

function parseHeadlessMode(): boolean | 'shell' {
  const raw = (process.env.PUPPETEER_HEADLESS || '').toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off') {
    return false;
  }
  if (raw === 'true' || raw === '1' || raw === 'on') {
    return true;
  }
  return 'shell';
}

async function applyWatchOnlyGuards(targetPage: Page): Promise<void> {
  await targetPage.evaluateOnNewDocument(() => {
    const block = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
    };

    const blockedEvents = [
      'click',
      'dblclick',
      'mousedown',
      'mouseup',
      'pointerdown',
      'pointerup',
      'touchstart',
      'touchend',
      'contextmenu',
      'dragstart',
      'drop',
      'keydown',
      'keypress',
      'keyup',
      'wheel',
    ];

    for (const eventName of blockedEvents) {
      window.addEventListener(eventName, block, true);
    }

    const style = document.createElement('style');
    style.id = '__watch_only_overlay';
    style.textContent = `
      html, body { cursor: not-allowed !important; }
      body { user-select: none !important; }
      * { -webkit-user-select: none !important; user-select: none !important; }
    `;
    document.documentElement.appendChild(style);
  });
}

async function setupPage(targetPage: Page, watchOnly: boolean): Promise<Page> {
  await targetPage.evaluateOnNewDocument(() => {
    const overlayId = '__gobilda_worker_overlay';

    const readState = (): { label?: string; status?: string } => {
      try {
        return JSON.parse(window.name || '{}') as { label?: string; status?: string };
      } catch {
        return {};
      }
    };

    const render = (): void => {
      const state = readState();
      const label = state.label && state.label.trim().length > 0 ? state.label : 'Worker';
      const status = state.status && state.status.trim().length > 0 ? state.status : 'Idle';
      const root = document.documentElement || document.body;
      if (!root) {
        return;
      }

      let overlay = document.getElementById(overlayId) as HTMLDivElement | null;
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.style.position = 'fixed';
        overlay.style.inset = '12px 12px auto auto';
        overlay.style.zIndex = '2147483647';
        overlay.style.maxWidth = '360px';
        overlay.style.padding = '12px 14px';
        overlay.style.border = '1px solid rgba(255, 255, 255, 0.15)';
        overlay.style.borderRadius = '12px';
        overlay.style.background = 'rgba(12, 18, 28, 0.92)';
        overlay.style.color = '#f3f7ff';
        overlay.style.fontFamily = 'Consolas, Monaco, monospace';
        overlay.style.fontSize = '12px';
        overlay.style.lineHeight = '1.45';
        overlay.style.whiteSpace = 'pre-wrap';
        overlay.style.boxShadow = '0 16px 40px rgba(0, 0, 0, 0.35)';
        overlay.style.pointerEvents = 'none';
        root.appendChild(overlay);
      }

      overlay.textContent = `${label}\n${status}`;
      document.title = `${label} - ${status}`;
    };

    (window as Window & { __gobildaRenderWorkerOverlay?: () => void }).__gobildaRenderWorkerOverlay = render;
    window.addEventListener('DOMContentLoaded', render);
    render();
  });

  if (watchOnly) {
    await applyWatchOnlyGuards(targetPage);
  }

  await targetPage.setViewport(DEFAULT_VIEWPORT);
  targetPage.setDefaultTimeout(120000);
  targetPage.setDefaultNavigationTimeout(120000);
  return targetPage;
}

export async function launchBrowser() {
  const watchOnly = process.env.PUPPETEER_WATCH_ONLY === '1';
  const parsedSlowMo = Number(process.env.PUPPETEER_SLOWMO ?? '0');
  const slowMo = Number.isFinite(parsedSlowMo) && parsedSlowMo >= 0 ? parsedSlowMo : 0;
  const userDataDir = ensureDirInRepo('.cache', 'puppeteer', 'profile');

  browser = await puppeteer.launch({
    headless: watchOnly ? false : parseHeadlessMode(),
    slowMo,
    userDataDir,
    args: ['--start-maximized'],
    defaultViewport: null,
  });

  page = await setupPage(await browser.newPage(), watchOnly);
}

export async function createPage(): Promise<Page> {
  if (!browser) {
    throw new Error('Browser has not been launched');
  }

  const watchOnly = process.env.PUPPETEER_WATCH_ONLY === '1';
  return setupPage(await browser.newPage(), watchOnly);
}

export function getPage(): Page {
  if (!page) {
    throw new Error('Browser page has not been initialized');
  }

  return page;
}

export async function setPageStatus(page: Page, label: string, status: string): Promise<void> {
  await page.evaluate(
    ({ nextLabel, nextStatus }) => {
      window.name = JSON.stringify({ label: nextLabel, status: nextStatus });
      const render = (window as Window & { __gobildaRenderWorkerOverlay?: () => void }).__gobildaRenderWorkerOverlay;
      if (typeof render === 'function') {
        render();
      }
    },
    { nextLabel: label, nextStatus: status }
  );
}

export async function closeBrowser() {
  if (browser) await browser.close();
}
