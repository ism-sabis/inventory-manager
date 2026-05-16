import fs from 'fs';
import path from 'path';
import https from 'https';
import { URL } from 'url';
import type { Page, PuppeteerLifeCycleEvent } from 'puppeteer';
import {
  resetCheckpointForFreshRun,
  runGobildaStepPipeline,
  STEP_SINGLE_FILE_LOCAL_ONLY_BYTES,
  STEP_TOTAL_TRACKING_THRESHOLD_BYTES,
} from '../../../src/gobildaStepPipeline';
import { createPage, getPage, setPageStatus } from '../../../src/puppeteerEnv';
import { resolveInRepo } from '../../../src/repoPaths';

jest.setTimeout(2147483647);

const BASE_URL = 'https://www.gobilda.com';
const RESULTS_DIR = resolveInRepo('Results', 'robotics', 'GoBilda');
const NOW = new Date();
const TIMESTAMP = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}_${String(NOW.getHours()).padStart(2, '0')}-${String(NOW.getMinutes()).padStart(2, '0')}-${String(NOW.getSeconds()).padStart(2, '0')}`;
const XML_OUTPUT_PATH = path.join(RESULTS_DIR, `${TIMESTAMP}_gobilda_inventory.xml`);
const UPC_SKU_CHART_OUTPUT_PATH = path.join(RESULTS_DIR, `${TIMESTAMP}_gobilda_upc_sku_chart.csv`);
const CHECKPOINT_PATH = path.join(RESULTS_DIR, 'gobilda_checkpoint.json');

const UPC_KEYS = ['upc', 'gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'ean', 'barcode'];
const PRODUCT_LINK_HINTS = ['product', 'kit', 'motor', 'wheel', 'gear', 'shaft', 'mount', 'channel', 'bolt', 'screw', 'bearing', 'encoder', 'servo', 'battery', 'hub'];
const WAIT_UNTIL: PuppeteerLifeCycleEvent = 'networkidle2';
const PAGE_TIMEOUT_MS = Number(process.env.GOBILDA_PAGE_TIMEOUT_MS ?? '120000');
const PRODUCT_SCRAPE_TIMEOUT_MS = Number(process.env.GOBILDA_PRODUCT_SCRAPE_TIMEOUT_MS ?? '180000');
const CATEGORY_DELAY_MS = Number(process.env.GOBILDA_CATEGORY_DELAY_MS ?? '300');
const NETWORK_SETTLE_MS = Number(process.env.GOBILDA_NETWORK_SETTLE_MS ?? '500');
const PRODUCT_DELAY_MIN_MS = Number(process.env.GOBILDA_PRODUCT_DELAY_MIN_MS ?? '200');
const PRODUCT_DELAY_MAX_MS = Number(process.env.GOBILDA_PRODUCT_DELAY_MAX_MS ?? '800');
const GOTO_RETRY_ATTEMPTS = Number(process.env.GOBILDA_GOTO_RETRY_ATTEMPTS ?? '5');
const GOTO_RETRY_BASE_DELAY_MS = Number(process.env.GOBILDA_GOTO_RETRY_BASE_DELAY_MS ?? '400');
const ENABLE_NETWORK_UPC_FALLBACK = process.env.GOBILDA_ENABLE_NETWORK_UPC_FALLBACK !== '0';
const GOBILDA_CONCURRENCY = (() => {
  const parsed = Number(process.env.GOBILDA_CONCURRENCY ?? '20');
  // allow override up to a safe upper bound
  const val = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 20;
  return Math.max(1, Math.min(50, val));
})();

interface ScrapedProduct {
  url: string;
  title: string;
  sku: string;
  upc: string;
  upcSource: string;
  discontinued: boolean;
  brand: string;
  price: string;
  availability: string;
  description: string;
  breadcrumbs: string[];
  images: string[];
  downloads: Array<{ name: string; url: string; sku: string; productUrl: string; productTitle: string }>;
  specs: Array<{ key: string; value: string }>;
  categories: string[];
  hiddenFields: Record<string, string>;
  dataAttributes: Record<string, string>;
  metaFields: Record<string, string>;
  jsonLd: unknown[];
  inlineScriptMatches: string[];
  networkMatches: Record<string, string[]>;
  missingUpc: boolean;
  scrapeErrors: string[];
}

interface DiscoveryStats {
  sitemapUrls: number;
  storefrontUrls: number;
  dedupedUrls: number;
}

interface CheckpointData {
  processedUrls: string[];
  failedUrls: Array<{ url: string; error: string }>;
  products: ScrapedProduct[];
}

function countProductsWithStepFiles(products: ScrapedProduct[]): number {
  return products.filter((product) => product.downloads.some((download) => /\.zip(\?|$)/i.test(download.url) && /step/i.test(`${download.url} ${download.name}`))).length;
}

async function gotoWithRetry(page: Page, url: string, context: string): Promise<void> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= GOTO_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: WAIT_UNTIL, timeout: PAGE_TIMEOUT_MS });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < GOTO_RETRY_ATTEMPTS) {
        await sleep(GOTO_RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  throw new Error(
    `${context} failed after ${GOTO_RETRY_ATTEMPTS} attempts for ${url}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function csvEscape(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

function extractXmlLocValues(xml: string): string[] {
  const values: string[] = [];
  const pattern = /<loc>([\s\S]*?)<\/loc>/gi;
  let match = pattern.exec(xml);
  while (match) {
    const value = normalizeWhitespace(decodeXmlEntities(match[1]));
    if (value) {
      values.push(value);
    }
    match = pattern.exec(xml);
  }
  return values;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  return new Promise<T>((resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((value) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        resolve(value);
      })
      .catch((error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        reject(error);
      });
  });
}

function resolveScrapeConcurrency(taskCount: number): number {
  return Math.max(1, Math.min(GOBILDA_CONCURRENCY, taskCount || 1));
}

function toAbsoluteUrl(value: string): string {
  if (!value) {
    return '';
  }
  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return '';
  }
}

function canonicalizeProductUrl(urlValue: string): string {
  try {
    const parsed = new URL(urlValue);
    parsed.hash = '';
    parsed.searchParams.delete('sort');
    parsed.searchParams.delete('limit');
    if (parsed.searchParams.toString().length === 0) {
      parsed.search = '';
    }
    if (parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return urlValue;
  }
}

function isLikelyProductUrl(urlValue: string): boolean {
  if (!urlValue.startsWith(BASE_URL)) {
    return false;
  }

  const lower = urlValue.toLowerCase();
  if (lower.includes('/blog') || lower.includes('/support') || lower.includes('/privacy') || lower.includes('/returns') || lower.includes('/login.php') || lower.includes('/cart.php') || lower.includes('/sitemap')) {
    return false;
  }

  if (lower.includes('/content/') || lower.endsWith('.pdf') || lower.endsWith('.zip')) {
    return false;
  }

  return PRODUCT_LINK_HINTS.some((hint) => lower.includes(hint));
}

function looksLikeUpcValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (/^[0-9]{8}$/.test(trimmed) || /^[0-9]{12,14}$/.test(trimmed)) {
    return true;
  }
  return /^[A-Za-z0-9\-_.]{8,32}$/.test(trimmed);
}

function extractKeyValueMatchesFromText(text: string): Record<string, string[]> {
  const matches: Record<string, Set<string>> = {};
  const patterns = [
    /"([a-zA-Z0-9_\-]*(?:upc|gtin|ean|barcode|mpn|sku)[a-zA-Z0-9_\-]*)"\s*:\s*"([^"\\]{1,120})"/g,
    /'([a-zA-Z0-9_\-]*(?:upc|gtin|ean|barcode|mpn|sku)[a-zA-Z0-9_\-]*)'\s*:\s*'([^'\\]{1,120})'/g,
    /\b([a-zA-Z0-9_\-]*(?:upc|gtin|ean|barcode|mpn|sku)[a-zA-Z0-9_\-]*)\b\s*[:=]\s*"([^"\\]{1,120})"/g,
    /\b([a-zA-Z0-9_\-]*(?:upc|gtin|ean|barcode|mpn|sku)[a-zA-Z0-9_\-]*)\b\s*[:=]\s*'([^'\\]{1,120})'/g,
  ];

  for (const pattern of patterns) {
    let current: RegExpExecArray | null = pattern.exec(text);
    while (current) {
      const key = current[1].toLowerCase();
      const value = normalizeWhitespace(current[2]);
      if (!matches[key]) {
        matches[key] = new Set<string>();
      }
      if (value) {
        matches[key].add(value);
      }
      current = pattern.exec(text);
    }
  }

  return Object.fromEntries(Object.entries(matches).map(([key, valueSet]) => [key, Array.from(valueSet)]));
}

function walkObjectForKeys(input: unknown, result: Record<string, string[]>): void {
  if (!input || typeof input !== 'object') {
    return;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      walkObjectForKeys(item, result);
    }
    return;
  }

  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = rawKey.toLowerCase();
    if (UPC_KEYS.some((upcKey) => key.includes(upcKey)) || key.includes('sku') || key.includes('mpn')) {
      const value = rawValue == null ? '' : normalizeWhitespace(String(rawValue));
      if (value) {
        if (!result[key]) {
          result[key] = [];
        }
        if (!result[key].includes(value)) {
          result[key].push(value);
        }
      }
    }

    if (typeof rawValue === 'object') {
      walkObjectForKeys(rawValue, result);
    }
  }
}

function pickBestUpc(product: {
  networkMatches: Record<string, string[]>;
  hiddenFields: Record<string, string>;
  dataAttributes: Record<string, string>;
  metaFields: Record<string, string>;
  jsonLd: unknown[];
  inlineScriptMatches: string[];
}): { value: string; source: string } {
  const prioritizedSources: Array<{ source: string; values: string[] }> = [];

  for (const [key, values] of Object.entries(product.networkMatches)) {
    if (UPC_KEYS.some((upcKey) => key.includes(upcKey))) {
      prioritizedSources.push({ source: `network:${key}`, values });
    }
  }

  for (const [key, value] of Object.entries(product.hiddenFields)) {
    const lower = key.toLowerCase();
    if (UPC_KEYS.some((upcKey) => lower.includes(upcKey))) {
      prioritizedSources.push({ source: `hidden:${key}`, values: [value] });
    }
  }

  for (const [key, value] of Object.entries(product.dataAttributes)) {
    const lower = key.toLowerCase();
    if (UPC_KEYS.some((upcKey) => lower.includes(upcKey))) {
      prioritizedSources.push({ source: `data:${key}`, values: [value] });
    }
  }

  for (const [key, value] of Object.entries(product.metaFields)) {
    const lower = key.toLowerCase();
    if (UPC_KEYS.some((upcKey) => lower.includes(upcKey))) {
      prioritizedSources.push({ source: `meta:${key}`, values: [value] });
    }
  }

  for (const [index, jsonLdItem] of product.jsonLd.entries()) {
    const found: Record<string, string[]> = {};
    walkObjectForKeys(jsonLdItem, found);
    for (const [key, values] of Object.entries(found)) {
      if (UPC_KEYS.some((upcKey) => key.includes(upcKey))) {
        prioritizedSources.push({ source: `jsonld:${index}:${key}`, values });
      }
    }
  }

  for (const match of product.inlineScriptMatches) {
    if (looksLikeUpcValue(match)) {
      prioritizedSources.push({ source: 'inline-script', values: [match] });
    }
  }

  for (const source of prioritizedSources) {
    for (const value of source.values) {
      if (looksLikeUpcValue(value)) {
        return { value: value.trim(), source: source.source };
      }
    }
  }

  return { value: '', source: '' };
}

function requestText(urlValue: string, redirectCount = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      urlValue,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; gobilda-inventory-scraper/1.0)',
          Accept: 'application/xml,text/xml,text/html;q=0.9,*/*;q=0.8',
        },
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;

        if (statusCode >= 300 && statusCode < 400 && res.headers.location && redirectCount < 5) {
          const redirected = new URL(res.headers.location, urlValue).toString();
          resolve(requestText(redirected, redirectCount + 1));
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Request failed for ${urlValue} with status ${statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      }
    );

    req.setTimeout(30000, () => {
      req.destroy(new Error(`Request timeout for ${urlValue}`));
    });

    req.on('error', (error) => reject(error));
  });
}

async function discoverUrlsFromSitemaps(): Promise<Set<string>> {
  const sitemapIndex = await requestText(`${BASE_URL}/xmlsitemap.php`);
  const productSitemaps = extractXmlLocValues(sitemapIndex).filter((loc) => loc.includes('type=products'));

  const productUrls = new Set<string>();

  for (const sitemapUrl of productSitemaps) {
    try {
      const xml = await requestText(sitemapUrl);
      const urlEntries = extractXmlLocValues(xml);

      for (const entry of urlEntries) {
        const loc = entry ? canonicalizeProductUrl(entry) : '';
        if (loc.startsWith(BASE_URL)) {
          productUrls.add(loc);
        }
      }
    } catch (error) {
      console.warn(`Failed to parse product sitemap ${sitemapUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return productUrls;
}

async function discoverUrlsFromStorefront(page: Page, maxPagesPerCategory: number): Promise<Set<string>> {
  const rootCategories = [
    `${BASE_URL}/structure`,
    `${BASE_URL}/motion`,
    `${BASE_URL}/electronics`,
    `${BASE_URL}/hardware`,
    `${BASE_URL}/kits`,
    `${BASE_URL}/merch`,
  ];

  const categoriesToVisit: string[] = [...rootCategories];
  const visitedCategories = new Set<string>();
  const discoveredProducts = new Set<string>();

  while (categoriesToVisit.length > 0) {
    const categoryUrl = categoriesToVisit.shift();
    if (!categoryUrl) {
      continue;
    }

    const canonicalCategory = canonicalizeProductUrl(categoryUrl);
    if (visitedCategories.has(canonicalCategory)) {
      continue;
    }
    visitedCategories.add(canonicalCategory);

    for (let pageNumber = 1; pageNumber <= maxPagesPerCategory; pageNumber += 1) {
      const urlForPage = pageNumber === 1 ? canonicalCategory : `${canonicalCategory}?page=${pageNumber}`;
      try {
        await gotoWithRetry(page, urlForPage, 'Storefront category discovery');
      } catch {
        break;
      }

      const data = await page.evaluate((currentBaseUrl) => {
        const links = Array.from(document.querySelectorAll('a[href]'))
          .map((node) => (node as HTMLAnchorElement).href)
          .filter((href) => href.startsWith(currentBaseUrl));

        const productLinks = Array.from(
          new Set(
            links.filter((href) => {
              const lower = href.toLowerCase();
              const hasProductClasses = href.includes('/products/') || href.includes('/product/');
              const isCandidateBySlug = lower.split('/').filter(Boolean).length >= 3;
              return hasProductClasses || isCandidateBySlug;
            })
          )
        );

        const categoryLinks = Array.from(
          new Set(
            links.filter((href) => {
              const lower = href.toLowerCase();
              if (lower.includes('/blog') || lower.includes('/support') || lower.includes('/privacy') || lower.includes('/returns')) {
                return false;
              }
              if (lower.includes('/cart.php') || lower.includes('/login.php')) {
                return false;
              }
              if (lower.endsWith('.pdf') || lower.endsWith('.zip')) {
                return false;
              }
              return true;
            })
          )
        );

        const productCardCount = document.querySelectorAll('.card, .product').length;

        return { productLinks, categoryLinks, productCardCount };
      }, BASE_URL);

      let newProductsOnThisPage = 0;
      for (const maybeProduct of data.productLinks) {
        const canonical = canonicalizeProductUrl(maybeProduct);
        if (isLikelyProductUrl(canonical)) {
          if (!discoveredProducts.has(canonical)) {
            discoveredProducts.add(canonical);
            newProductsOnThisPage += 1;
          }
        }
      }

      for (const maybeCategory of data.categoryLinks) {
        const canonical = canonicalizeProductUrl(maybeCategory);
        if (!visitedCategories.has(canonical) && !categoriesToVisit.includes(canonical) && !isLikelyProductUrl(canonical)) {
          categoriesToVisit.push(canonical);
        }
      }

      if (data.productCardCount === 0 || newProductsOnThisPage === 0) {
        break;
      }
    }

    await sleep(CATEGORY_DELAY_MS);
  }

  return discoveredProducts;
}

async function collectNetworkMatches(
  page: Page,
  url: string,
  reportStatus?: (status: string) => Promise<void> | void
): Promise<Record<string, string[]>> {
  const aggregateMatches: Record<string, Set<string>> = {};
  const processing: Array<Promise<void>> = [];

  const responseHandler = (response: import('puppeteer').HTTPResponse): void => {
    const request = response.request();
    const resourceType = request.resourceType();
    if (resourceType !== 'xhr' && resourceType !== 'fetch') {
      return;
    }

    processing.push(
      (async () => {
        try {
          const headers = response.headers();
          const contentType = (headers['content-type'] ?? '').toLowerCase();
          if (!contentType.includes('json') && !contentType.includes('javascript') && !contentType.includes('text')) {
            return;
          }

          const body = await response.text();
          if (!body) {
            return;
          }

          const textMatches = extractKeyValueMatchesFromText(body);
          for (const [key, values] of Object.entries(textMatches)) {
            if (!aggregateMatches[key]) {
              aggregateMatches[key] = new Set<string>();
            }
            for (const value of values) {
              aggregateMatches[key].add(value);
            }
          }

          if (contentType.includes('json')) {
            try {
              const parsed = JSON.parse(body) as unknown;
              const objectMatches: Record<string, string[]> = {};
              walkObjectForKeys(parsed, objectMatches);
              for (const [key, values] of Object.entries(objectMatches)) {
                if (!aggregateMatches[key]) {
                  aggregateMatches[key] = new Set<string>();
                }
                for (const value of values) {
                  aggregateMatches[key].add(value);
                }
              }
            } catch {
              // Ignore JSON parsing errors and keep regex matches.
            }
          }
        } catch {
          // Ignore individual response processing errors.
        }
      })()
    );
  };

  page.on('response', responseHandler);
  await reportStatus?.('Loading network fallback');
  await gotoWithRetry(page, url, 'Network UPC fallback load');
  await reportStatus?.('Waiting for network responses');
  await sleep(NETWORK_SETTLE_MS);
  await Promise.allSettled(processing);
  page.off('response', responseHandler);

  return Object.fromEntries(
    Object.entries(aggregateMatches).map(([key, valueSet]) => [key, Array.from(valueSet)])
  );
}

async function scrapeProduct(
  page: Page,
  productUrl: string,
  reportStatus?: (status: string) => Promise<void> | void
): Promise<ScrapedProduct> {
  const scrapeErrors: string[] = [];
  let networkMatches: Record<string, string[]> = {};

  await reportStatus?.('Opening product page');
  await gotoWithRetry(page, productUrl, 'Primary product scrape');
  await reportStatus?.('Reading page content');

  const domData = await page.evaluate((productUrl: string) => {
    const clean = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

    const title = clean(document.querySelector('h1')?.textContent);

    const skuTextCandidates: string[] = [];
    const allTextNodes = Array.from(document.querySelectorAll('body *'))
      .map((el) => clean(el.textContent))
      .filter((text) => text.length > 0 && text.length < 160);
    for (const text of allTextNodes) {
      if (/sku\s*:/i.test(text)) {
        skuTextCandidates.push(text);
      }
    }

    const skuFromLabel = skuTextCandidates.length > 0 ? skuTextCandidates[0] : '';
    const skuMatch = skuFromLabel.match(/sku\s*:\s*([a-z0-9\-_.]+)/i);
    const sku = skuMatch?.[1] ?? '';

    const brand =
      clean(document.querySelector('[itemprop="brand"]')?.textContent) ||
      clean(document.querySelector('.productView-brand a')?.textContent);

    const price =
      clean(document.querySelector('.price--withoutTax')?.textContent) ||
      clean(document.querySelector('.price')?.textContent);

    const availability =
      clean(document.querySelector('[data-product-stock]')?.textContent) ||
      clean(document.querySelector('.productView-info-value')?.textContent);

    const pageText = clean(document.body?.textContent);
    const discontinued = /discontinued|no longer available|out of production|retired/i.test(`${availability} ${pageText}`);

    const description = clean(document.querySelector('.productView-description')?.textContent);

    const breadcrumbs = Array.from(document.querySelectorAll('.breadcrumbs a, .breadcrumbs span'))
      .map((node) => clean(node.textContent))
      .filter(Boolean);

    const categories = Array.from(document.querySelectorAll('a[href*="/structure"], a[href*="/motion"], a[href*="/electronics"], a[href*="/hardware"], a[href*="/kits"], a[href*="/merch"]'))
      .map((node) => clean(node.textContent))
      .filter(Boolean);

    const imageUrls = new Set<string>();
    for (const img of Array.from(document.querySelectorAll('img'))) {
      const htmlImg = img as HTMLImageElement;
      if (htmlImg.src) {
        imageUrls.add(htmlImg.src);
      }
      const dataSrc = htmlImg.getAttribute('data-src');
      if (dataSrc) {
        imageUrls.add(dataSrc);
      }
    }
    for (const node of Array.from(document.querySelectorAll('a[data-image-gallery-new-image-url], a[href]'))) {
      const link = node.getAttribute('data-image-gallery-new-image-url') || node.getAttribute('href');
      if (link && /\.(jpg|jpeg|png|webp)(\?|$)/i.test(link)) {
        imageUrls.add(link);
      }
    }

    const downloads = Array.from(document.querySelectorAll('a[href$=".pdf"], a[href$=".zip"]')).map((link) => ({
      name: clean(link.textContent),
      url: (link as HTMLAnchorElement).href,
      sku,
      productUrl,
      productTitle: title,
    }));

    const specs: Array<{ key: string; value: string }> = [];
    for (const row of Array.from(document.querySelectorAll('table tr'))) {
      const cells = Array.from(row.querySelectorAll('th, td')).map((cell) => clean(cell.textContent));
      if (cells.length >= 2 && cells[0] && cells[1]) {
        specs.push({ key: cells[0], value: cells[1] });
      }
    }

    const hiddenFields: Record<string, string> = {};
    for (const input of Array.from(document.querySelectorAll('input[type="hidden"][name]'))) {
      const name = input.getAttribute('name') || '';
      const value = (input as HTMLInputElement).value || input.getAttribute('value') || '';
      if (name && value) {
        hiddenFields[name] = clean(value);
      }
    }

    const dataAttributes: Record<string, string> = {};
    const dataAttributeNameRegex = /(upc|gtin|ean|barcode|sku|mpn)/i;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const attrs = Array.from(el.attributes);
      for (const attr of attrs) {
        if (dataAttributeNameRegex.test(attr.name) && attr.value) {
          dataAttributes[attr.name] = clean(attr.value);
        }
      }
    }

    const metaFields: Record<string, string> = {};
    for (const meta of Array.from(document.querySelectorAll('meta'))) {
      const key = meta.getAttribute('name') || meta.getAttribute('property') || meta.getAttribute('itemprop') || '';
      const content = meta.getAttribute('content') || '';
      if (key && content) {
        metaFields[key] = clean(content);
      }
    }

    const jsonLd: unknown[] = [];
    for (const scriptNode of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        const text = scriptNode.textContent || '';
        if (!text.trim()) {
          continue;
        }
        jsonLd.push(JSON.parse(text));
      } catch {
        // Ignore malformed JSON-LD blocks.
      }
    }

    const inlineScriptMatches: string[] = [];
    const candidateRegex = /(?:upc|gtin|ean|barcode)\s*[:=]\s*["']([^"']{6,64})["']/gi;
    for (const scriptNode of Array.from(document.querySelectorAll('script:not([type]), script[type="text/javascript"]'))) {
      const content = scriptNode.textContent || '';
      if (!content || !/(upc|gtin|ean|barcode|sku|mpn)/i.test(content)) {
        continue;
      }
      let match = candidateRegex.exec(content);
      while (match) {
        inlineScriptMatches.push(clean(match[1]));
        match = candidateRegex.exec(content);
      }
    }

    return {
      title,
      sku,
      discontinued,
      brand,
      price,
      availability,
      description,
      breadcrumbs,
      categories,
      images: Array.from(imageUrls),
      downloads,
      specs,
      hiddenFields,
      dataAttributes,
      metaFields,
      jsonLd,
      inlineScriptMatches,
    };
  }, productUrl);

  const normalizedImages = domData.images.map((img) => toAbsoluteUrl(img)).filter(Boolean);

  let chosenUpc = pickBestUpc({
    networkMatches,
    hiddenFields: domData.hiddenFields,
    dataAttributes: domData.dataAttributes,
    metaFields: domData.metaFields,
    jsonLd: domData.jsonLd,
    inlineScriptMatches: domData.inlineScriptMatches,
  });

  if (!chosenUpc.value && ENABLE_NETWORK_UPC_FALLBACK) {
    try {
      await reportStatus?.('Scanning network responses');
      networkMatches = await collectNetworkMatches(page, productUrl, reportStatus);
      chosenUpc = pickBestUpc({
        networkMatches,
        hiddenFields: domData.hiddenFields,
        dataAttributes: domData.dataAttributes,
        metaFields: domData.metaFields,
        jsonLd: domData.jsonLd,
        inlineScriptMatches: domData.inlineScriptMatches,
      });
    } catch (error) {
      scrapeErrors.push(`Network UPC fallback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await reportStatus?.('Done');

  return {
    url: productUrl,
    title: domData.title,
    sku: domData.sku,
    upc: chosenUpc.value,
    upcSource: chosenUpc.source,
    discontinued: domData.discontinued,
    brand: domData.brand,
    price: domData.price,
    availability: domData.availability,
    description: domData.description,
    breadcrumbs: domData.breadcrumbs,
    images: normalizedImages,
    downloads: domData.downloads,
    specs: domData.specs,
    categories: domData.categories,
    hiddenFields: domData.hiddenFields,
    dataAttributes: domData.dataAttributes,
    metaFields: domData.metaFields,
    jsonLd: domData.jsonLd,
    inlineScriptMatches: domData.inlineScriptMatches,
    networkMatches,
    missingUpc: chosenUpc.value.length === 0,
    scrapeErrors,
  };
}

function ensureResultsDir(): void {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

function writeCheckpoint(data: CheckpointData): void {
  const serialized = JSON.stringify(data, null, 2);
  fs.writeFileSync(CHECKPOINT_PATH, serialized, 'utf-8');
}

function loadCheckpoint(): CheckpointData | null {
  if (!fs.existsSync(CHECKPOINT_PATH)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(CHECKPOINT_PATH, 'utf-8');
    return JSON.parse(raw) as CheckpointData;
  } catch {
    return null;
  }
}

function buildUpcSkuConversionChart(products: ScrapedProduct[]): string {
  const rows: string[] = ['sku,upc,upc_source,missing_upc,url,title'];
  const seen = new Set<string>();

  for (const product of products) {
    const sku = product.sku || '';
    const upc = product.upc || '';
    const dedupeKey = `${sku}::${upc}::${product.url}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    rows.push(
      [
        csvEscape(sku),
        csvEscape(upc),
        csvEscape(product.upcSource),
        csvEscape(String(product.missingUpc)),
        csvEscape(product.url),
        csvEscape(product.title),
      ].join(',')
    );
  }

  return rows.join('\n');
}

function buildInventoryXml(
  products: ScrapedProduct[],
  stats: DiscoveryStats,
  productsWithStepFiles: number,
  failedUrls: Array<{ url: string; error: string }>
): string {
  const groupedBySku = new Map<string, ScrapedProduct[]>();
  for (const product of products) {
    const key = product.sku || `missing-sku:${product.url}`;
    if (!groupedBySku.has(key)) {
      groupedBySku.set(key, []);
    }
    groupedBySku.get(key)?.push(product);
  }

  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<inventory>');
  parts.push(`  <source>${xmlEscape('gobilda.com')}</source>`);
  parts.push(`  <generated_at>${xmlEscape(NOW.toISOString())}</generated_at>`);
  parts.push('  <discovery>');
  parts.push(`    <sitemap_urls>${stats.sitemapUrls}</sitemap_urls>`);
  parts.push(`    <storefront_urls>${stats.storefrontUrls}</storefront_urls>`);
  parts.push(`    <deduped_urls>${stats.dedupedUrls}</deduped_urls>`);
  parts.push('  </discovery>');
  parts.push('  <totals>');
  parts.push(`    <scraped_products>${products.length}</scraped_products>`);
  parts.push(`    <products_with_step_files>${productsWithStepFiles}</products_with_step_files>`);
  parts.push(`    <grouped_sku_nodes>${groupedBySku.size}</grouped_sku_nodes>`);
  parts.push(`    <missing_upc_products>${products.filter((item) => item.missingUpc).length}</missing_upc_products>`);
  parts.push(`    <failed_urls>${failedUrls.length}</failed_urls>`);
  parts.push('  </totals>');
  parts.push('  <products>');

  for (const [groupKey, groupProducts] of groupedBySku.entries()) {
    const primary = groupProducts[0];
    const hasSku = !groupKey.startsWith('missing-sku:');
    const upcValues = Array.from(new Set(groupProducts.map((item) => item.upc).filter(Boolean)));
    const availabilityMentionsDiscontinued = /discontinued|no longer available|out of production|retired/i.test(primary.availability);

    parts.push(`    <product sku="${xmlEscape(hasSku ? groupKey : '')}" missing_sku="${String(!hasSku)}">`);
    parts.push(`      <sku>${xmlEscape(primary.sku)}</sku>`);
    parts.push(`      <upc>${xmlEscape(primary.upc || '')}</upc>`);
    parts.push(`      <upc_source>${xmlEscape(primary.upcSource)}</upc_source>`);
    parts.push(`      <missing_upc>${String(primary.missingUpc)}</missing_upc>`);
    if (!availabilityMentionsDiscontinued) {
      parts.push(`      <discontinued>${String(primary.discontinued)}</discontinued>`);
    }
    parts.push('      <all_upc_values>');
    for (const upc of upcValues) {
      parts.push(`        <upc>${xmlEscape(upc)}</upc>`);
    }
    parts.push('      </all_upc_values>');
    parts.push('      <entries>');

    for (const item of groupProducts) {
      parts.push('        <entry>');
      parts.push(`          <url>${xmlEscape(item.url)}</url>`);
      parts.push(`          <title>${xmlEscape(item.title)}</title>`);
      parts.push(`          <brand>${xmlEscape(item.brand)}</brand>`);
      parts.push(`          <price>${xmlEscape(item.price)}</price>`);
      parts.push(`          <availability>${xmlEscape(item.availability)}</availability>`);
      if (!/discontinued|no longer available|out of production|retired/i.test(item.availability)) {
        parts.push(`          <discontinued>${String(item.discontinued)}</discontinued>`);
      }
      parts.push(`          <description>${xmlEscape(item.description)}</description>`);

      parts.push('          <breadcrumbs>');
      for (const crumb of item.breadcrumbs) {
        parts.push(`            <crumb>${xmlEscape(crumb)}</crumb>`);
      }
      parts.push('          </breadcrumbs>');

      parts.push('          <categories>');
      for (const category of item.categories) {
        parts.push(`            <category>${xmlEscape(category)}</category>`);
      }
      parts.push('          </categories>');

      parts.push('          <images>');
      for (const image of item.images) {
        parts.push(`            <image>${xmlEscape(image)}</image>`);
      }
      parts.push('          </images>');

      parts.push('          <downloads>');
      for (const file of item.downloads) {
        parts.push(`            <file name="${xmlEscape(file.name)}">${xmlEscape(file.url)}</file>`);
      }
      parts.push('          </downloads>');

      parts.push('          <specs>');
      for (const spec of item.specs) {
        parts.push(`            <spec name="${xmlEscape(spec.key)}">${xmlEscape(spec.value)}</spec>`);
      }
      parts.push('          </specs>');

      parts.push('          <inspect_data>');
      parts.push('            <hidden_fields>');
      for (const [key, value] of Object.entries(item.hiddenFields)) {
        parts.push(`              <field name="${xmlEscape(key)}">${xmlEscape(value)}</field>`);
      }
      parts.push('            </hidden_fields>');

      parts.push('            <data_attributes>');
      for (const [key, value] of Object.entries(item.dataAttributes)) {
        parts.push(`              <attr name="${xmlEscape(key)}">${xmlEscape(value)}</attr>`);
      }
      parts.push('            </data_attributes>');

      parts.push('            <meta_fields>');
      for (const [key, value] of Object.entries(item.metaFields)) {
        parts.push(`              <meta name="${xmlEscape(key)}">${xmlEscape(value)}</meta>`);
      }
      parts.push('            </meta_fields>');

      parts.push('            <inline_script_matches>');
      for (const value of item.inlineScriptMatches) {
        parts.push(`              <value>${xmlEscape(value)}</value>`);
      }
      parts.push('            </inline_script_matches>');

      parts.push('            <network_matches>');
      for (const [key, values] of Object.entries(item.networkMatches)) {
        parts.push(`              <match key="${xmlEscape(key)}">`);
        for (const value of values) {
          parts.push(`                <value>${xmlEscape(value)}</value>`);
        }
        parts.push('              </match>');
      }
      parts.push('            </network_matches>');

      parts.push('            <jsonld>');
      for (const block of item.jsonLd) {
        parts.push(`              <block>${xmlEscape(JSON.stringify(block))}</block>`);
      }
      parts.push('            </jsonld>');
      parts.push('          </inspect_data>');

      parts.push('          <diagnostics>');
      parts.push(`            <missing_upc>${String(item.missingUpc)}</missing_upc>`);
      parts.push('            <scrape_errors>');
      for (const errorText of item.scrapeErrors) {
        parts.push(`              <error>${xmlEscape(errorText)}</error>`);
      }
      parts.push('            </scrape_errors>');
      parts.push('          </diagnostics>');
      parts.push('        </entry>');
    }

    parts.push('      </entries>');
    parts.push('    </product>');
  }

  parts.push('  </products>');
  parts.push('  <failures>');
  for (const item of failedUrls) {
    parts.push('    <failure>');
    parts.push(`      <url>${xmlEscape(item.url)}</url>`);
    parts.push(`      <error>${xmlEscape(item.error)}</error>`);
    parts.push('    </failure>');
  }
  parts.push('  </failures>');
  parts.push('</inventory>');

  return parts.join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

describe('GoBILDA Inventory Scraper', () => {
  it('scrapes all product info and exports SKU-centric XML with UPC-SKU chart', async () => {
    ensureResultsDir();

    const resumeFromCheckpoint = process.env.GOBILDA_RESUME_CHECKPOINT === '1';
    const existingCheckpoint = resumeFromCheckpoint ? loadCheckpoint() : null;
    if (!resumeFromCheckpoint) {
      const deletedCheckpoint = resetCheckpointForFreshRun(CHECKPOINT_PATH);
      if (deletedCheckpoint) {
        console.log(`Starting fresh run (checkpoint reset): ${CHECKPOINT_PATH}`);
      }
    } else if (existingCheckpoint) {
      console.log(
        `Resuming from checkpoint: ${existingCheckpoint.processedUrls.length} processed, ${existingCheckpoint.failedUrls.length} failed, ${existingCheckpoint.products.length} successful`
      );
    }

    const limitFromEnv = process.env.GOBILDA_LIMIT ? Number(process.env.GOBILDA_LIMIT) : 0;
    const shouldLimit = Number.isFinite(limitFromEnv) && limitFromEnv > 0;

    const page = getPage();
    const sitemapUrls = await discoverUrlsFromSitemaps();
    const allUrls = Array.from(new Set(Array.from(sitemapUrls).map((value) => canonicalizeProductUrl(value))));

    const products: ScrapedProduct[] = existingCheckpoint?.products ? [...existingCheckpoint.products] : [];
    const processedUrls = new Set<string>(existingCheckpoint?.processedUrls ?? []);
    const failedUrls: Array<{ url: string; error: string }> = existingCheckpoint?.failedUrls ? [...existingCheckpoint.failedUrls] : [];
    const completedProductUrls = new Set(products.map((product) => canonicalizeProductUrl(product.url)));

    const urlsToProcess = (shouldLimit ? allUrls.slice(0, limitFromEnv) : allUrls).filter(
      (url) => !completedProductUrls.has(canonicalizeProductUrl(url))
    );

    const concurrency = resolveScrapeConcurrency(urlsToProcess.length);
    console.log(`GoBILDA STEP scrape concurrency: ${concurrency}`);

    let nextIndex = 0;
    let completedCount = 0;
    const workers = Array.from({ length: concurrency }, async (_, workerIndex) => {
      let workerPage = await createPage();
      const workerLabel = `Worker ${workerIndex + 1}/${concurrency}`;
      const reportWorkerStatus = async (status: string): Promise<void> => {
        await setPageStatus(workerPage, workerLabel, status);
      };

      await reportWorkerStatus('Idle');
      await workerPage.bringToFront().catch(() => undefined);

      try {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= urlsToProcess.length) {
            return;
          }

          const url = urlsToProcess[index];

          try {
            await reportWorkerStatus(`Scraping ${index + 1}/${urlsToProcess.length}`);
            let product: ScrapedProduct | null = null;
            let lastScrapeError: unknown = null;

            for (let attempt = 1; attempt <= GOTO_RETRY_ATTEMPTS && !product; attempt += 1) {
              try {
                await reportWorkerStatus(`Attempt ${attempt}/${GOTO_RETRY_ATTEMPTS}`);
                product = await withTimeout(
                  scrapeProduct(workerPage, url, reportWorkerStatus),
                  PRODUCT_SCRAPE_TIMEOUT_MS,
                  `Product scrape timed out after ${PRODUCT_SCRAPE_TIMEOUT_MS}ms for ${url}`
                );
              } catch (error) {
                lastScrapeError = error;
                if (attempt < GOTO_RETRY_ATTEMPTS) {
                  await reportWorkerStatus(`Retrying after attempt ${attempt}`);
                  await sleep(GOTO_RETRY_BASE_DELAY_MS * attempt);
                }
              }
            }

            if (!product) {
              throw lastScrapeError instanceof Error ? lastScrapeError : new Error(String(lastScrapeError));
            }

            await reportWorkerStatus(`Done ${index + 1}/${urlsToProcess.length}`);

            const failedIndex = failedUrls.findIndex((entry) => canonicalizeProductUrl(entry.url) === canonicalizeProductUrl(url));
            if (failedIndex !== -1) {
              failedUrls.splice(failedIndex, 1);
            }
            products.push(product);
          } catch (error) {
            failedUrls.push({
              url,
              error: error instanceof Error ? error.message : String(error),
            });

            await workerPage.close().catch(() => undefined);
            workerPage = await createPage();
            await reportWorkerStatus('Recovered after failure');
          }

          processedUrls.add(url);
          completedCount += 1;

          if (completedCount % 20 === 0) {
            writeCheckpoint({
              processedUrls: Array.from(processedUrls),
              failedUrls,
              products,
            });
            console.log(`Checkpoint saved at item ${completedCount}/${urlsToProcess.length}`);
          }

          const delayFloor = Math.min(PRODUCT_DELAY_MIN_MS, PRODUCT_DELAY_MAX_MS);
          const delayRange = Math.max(PRODUCT_DELAY_MAX_MS - delayFloor, 0);
          await reportWorkerStatus(`Cooling down ${index + 1}/${urlsToProcess.length}`);
          await sleep(delayFloor + Math.floor(Math.random() * (delayRange + 1)));
        }
      } finally {
        await reportWorkerStatus('Closing');
        await workerPage.close();
      }
    });

    await Promise.all(workers);

    const discoveryStats: DiscoveryStats = {
      sitemapUrls: sitemapUrls.size,
      storefrontUrls: 0,
      dedupedUrls: allUrls.length,
    };

    const productsWithStepFiles = countProductsWithStepFiles(products);
    const xml = buildInventoryXml(products, discoveryStats, productsWithStepFiles, failedUrls);
    const conversionChart = buildUpcSkuConversionChart(products);
    fs.writeFileSync(XML_OUTPUT_PATH, xml, 'utf-8');
    fs.writeFileSync(UPC_SKU_CHART_OUTPUT_PATH, conversionChart, 'utf-8');

    const allDownloads = products.flatMap((product) => product.downloads);
    const stepPipelineResult = await runGobildaStepPipeline({
      timestamp: TIMESTAMP,
      resultsDir: RESULTS_DIR,
      downloads: allDownloads,
      logger: (message) => console.log(message),
    });

    writeCheckpoint({
      processedUrls: Array.from(processedUrls),
      failedUrls,
      products,
    });

    console.log(`STEP run folder: ${stepPipelineResult.runDirs.runRootDir}`);
    console.log(`STEP extracted folder: ${stepPipelineResult.runDirs.runStepFilesDir}`);
    console.log(`STEP ZIP candidates: ${stepPipelineResult.stepZipCandidates.length}`);
    console.log(`STEP ZIP extracted successfully: ${stepPipelineResult.extractedZipCount}`);
    console.log(`STEP extraction failures: ${stepPipelineResult.extractionFailures.length}`);
    console.log(`STEP file count: ${stepPipelineResult.stats.fileCount}`);
    console.log(`STEP total extracted bytes: ${stepPipelineResult.stats.totalExtractedBytes} (${formatBytes(stepPipelineResult.stats.totalExtractedBytes)})`);
    console.log(
      `STEP largest extracted file bytes: ${stepPipelineResult.stats.largestSingleExtractedFileBytes} (${formatBytes(stepPipelineResult.stats.largestSingleExtractedFileBytes)})`
    );
    console.log(
      `STEP files over 100MB (${STEP_SINGLE_FILE_LOCAL_ONLY_BYTES} bytes threshold): ${
        stepPipelineResult.stats.filesOver100MB.length > 0
          ? stepPipelineResult.stats.filesOver100MB.map((item) => `${item.relativePath} (${formatBytes(item.bytes)})`).join('; ')
          : 'none'
      }`
    );
    console.log(`STEP total size over 2GB threshold (${STEP_TOTAL_TRACKING_THRESHOLD_BYTES} bytes): ${stepPipelineResult.retention.totalSizeOver2GB}`);
    console.log(`STEP local-only decision: ${stepPipelineResult.retention.localOnlyStepOutputs}`);
    console.log(`STEP retention reason: ${stepPipelineResult.retention.reason}`);

    expect(products.length).toBeGreaterThan(0);
    expect(fs.existsSync(XML_OUTPUT_PATH)).toBe(true);
    expect(fs.existsSync(UPC_SKU_CHART_OUTPUT_PATH)).toBe(true);
    expect(xml.includes('<inventory>')).toBe(true);

    console.log(`GoBILDA XML saved at: ${XML_OUTPUT_PATH}`);
    console.log(`GoBILDA UPC-SKU chart saved at: ${UPC_SKU_CHART_OUTPUT_PATH}`);
    console.log(`Total products scraped: ${products.length}`);
    console.log(`Products missing UPC: ${products.filter((item) => item.missingUpc).length}`);
    console.log(`Products with STEP files: ${productsWithStepFiles}`);
    console.log(`Failed URLs: ${failedUrls.length}`);

    // Reset the shared page to reduce lingering handles between long crawls.
    await page.goto('about:blank', { waitUntil: 'load', timeout: 10000 }).catch(() => undefined);
  });
});
