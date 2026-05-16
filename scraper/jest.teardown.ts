import { closeBrowser } from './src/puppeteerEnv';

export default async function globalTeardown() {
  await closeBrowser();
}

