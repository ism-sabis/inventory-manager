import { launchBrowser } from './src/puppeteerEnv';

// Show browser windows by default (headful mode)
if (!process.env.PUPPETEER_HEADLESS) {
  process.env.PUPPETEER_HEADLESS = 'false';
}

beforeAll(async () => {
  await launchBrowser();
});

