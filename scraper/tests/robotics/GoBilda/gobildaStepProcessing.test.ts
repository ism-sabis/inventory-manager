import fs from 'fs';
import path from 'path';
import {
  runGobildaStepPipeline,
  STEP_SINGLE_FILE_LOCAL_ONLY_BYTES,
  STEP_TOTAL_TRACKING_THRESHOLD_BYTES,
} from '../../../src/gobildaStepPipeline';
import { resolveInRepo } from '../../../src/repoPaths';

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
}

interface CheckpointData {
  processedUrls: string[];
  failedUrls: Array<{ url: string; error: string }>;
  products: ScrapedProduct[];
}

function countProductsWithStepFiles(products: ScrapedProduct[]): number {
  return products.filter((product) => product.downloads.some((download) => /\.zip(\?|$)/i.test(download.url) && /step/i.test(`${download.url} ${download.name}`))).length;
}

const RESULTS_DIR = resolveInRepo('Results', 'robotics', 'GoBilda');
const CHECKPOINT_PATH = path.join(RESULTS_DIR, 'gobilda_checkpoint.json');

// Use 30-day timeout for STEP processing
jest.setTimeout(2147483647);

function ensureResultsDir(): void {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

describe('GoBILDA STEP Processing', () => {
  it('processes STEP downloads from latest product scrape checkpoint', async () => {
    ensureResultsDir();

    const checkpoint = loadCheckpoint();
    if (!checkpoint || !checkpoint.products || checkpoint.products.length === 0) {
      throw new Error(
        `No checkpoint found at ${CHECKPOINT_PATH}. Run product scraper first to generate checkpoint with products and downloads.`
      );
    }

    const products = checkpoint.products;
    const allDownloads = products.flatMap((product) => product.downloads);
    const productsWithStepFiles = countProductsWithStepFiles(products);

    if (allDownloads.length === 0) {
      throw new Error('No downloads found in checkpoint. Product scraper must have completed product data collection.');
    }

    console.log(`Loading ${products.length} products from checkpoint`);
    console.log(`Processing ${allDownloads.length} total download items`);
    console.log(`Products with STEP files: ${productsWithStepFiles}`);

    // Generate a timestamp for this STEP processing run
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;

    const stepPipelineResult = await runGobildaStepPipeline({
      timestamp,
      resultsDir: RESULTS_DIR,
      downloads: allDownloads,
      logger: (message) => console.log(message),
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

    // Assertions
    expect(allDownloads.length).toBeGreaterThan(0);
    expect(fs.existsSync(stepPipelineResult.runDirs.runRootDir)).toBe(true);
    expect(fs.existsSync(stepPipelineResult.runDirs.runStepFilesDir)).toBe(true);
  });
});
