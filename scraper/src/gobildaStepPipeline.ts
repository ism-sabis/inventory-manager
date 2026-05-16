import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import https from 'https';
import AdmZip from 'adm-zip';

export const STEP_SINGLE_FILE_LOCAL_ONLY_BYTES = 100 * 1024 * 1024;
export const STEP_TOTAL_TRACKING_THRESHOLD_BYTES = 2 * 1024 * 1024 * 1024;

export interface StepDownloadRef {
  name: string;
  url: string;
  sku: string;
  productUrl: string;
  productTitle: string;
}

export interface StepRunDirs {
  runRootDir: string;
  runStepFilesDir: string;
  runDownloadsDir: string;
  tempExtractRootDir: string;
}

export interface StepFileStat {
  relativePath: string;
  absolutePath: string;
  bytes: number;
}

export interface StepExtractionStats {
  totalExtractedBytes: number;
  largestSingleExtractedFileBytes: number;
  fileCount: number;
  filesOver100MB: StepFileStat[];
}

export interface StepRetentionDecision {
  localOnlyStepOutputs: boolean;
  totalSizeOver2GB: boolean;
  reason: string;
}

export interface GobildaStepPipelineResult {
  runDirs: StepRunDirs;
  stepZipCandidates: StepDownloadRef[];
  downloadedZipFiles: string[];
  extractedZipCount: number;
  extractionFailures: Array<{ zipUrl: string; error: string }>;
  stats: StepExtractionStats;
  retention: StepRetentionDecision;
}

function ensureDirectory(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureCleanDirectory(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDirectory(dir);
}

function sanitizeFileName(value: string): string {
  const clean = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return clean.length > 0 ? clean : 'download.zip';
}

function sanitizePathSegment(value: string, fallback: string): string {
  const clean = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return clean.length > 0 ? clean : fallback;
}

function ensureUniquePath(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return filePath;
  }

  const ext = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  let index = 1;

  while (true) {
    const candidate = `${base}_${index}${ext}`;
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

function filesHaveSameContents(firstPath: string, secondPath: string): boolean {
  const firstContents = fs.readFileSync(firstPath);
  const secondContents = fs.readFileSync(secondPath);
  return firstContents.length === secondContents.length && firstContents.equals(secondContents);
}

function moveOrDedupeFile(sourcePath: string, targetPath: string): void {
  if (fs.existsSync(targetPath)) {
    if (filesHaveSameContents(sourcePath, targetPath)) {
      fs.rmSync(sourcePath, { force: true });
      return;
    }

    const finalTarget = ensureUniquePath(targetPath);
    fs.renameSync(sourcePath, finalTarget);
    return;
  }

  fs.renameSync(sourcePath, targetPath);
}

function moveDirectoryContents(sourceDir: string, targetDir: string): void {
  ensureDirectory(targetDir);
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      moveDirectoryContents(sourcePath, targetPath);
      fs.rmSync(sourcePath, { recursive: true, force: true });
      continue;
    }

    moveOrDedupeFile(sourcePath, targetPath);
  }
}

function flattenSingleWrapperDirectory(dir: string): boolean {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) {
    return false;
  }

  const wrapperDir = path.join(dir, entries[0].name);
  const wrapperEntries = fs.readdirSync(wrapperDir, { withFileTypes: true });
  if (wrapperEntries.length === 0) {
    fs.rmSync(wrapperDir, { recursive: true, force: true });
    return false;
  }

  for (const child of wrapperEntries) {
    const sourcePath = path.join(wrapperDir, child.name);
    const targetPath = path.join(dir, child.name);
    moveOrDedupeFile(sourcePath, targetPath);
  }

  fs.rmSync(wrapperDir, { recursive: true, force: true });
  return true;
}

function listFilesRecursively(rootDir: string): StepFileStat[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files: StepFileStat[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      const stats = fs.statSync(absolutePath);
      files.push({
        absolutePath,
        relativePath: path.relative(rootDir, absolutePath).replace(/\\/g, '/'),
        bytes: stats.size,
      });
    }
  }

  return files;
}

function inferZipFileName(download: StepDownloadRef, index: number): string {
  const fallback = `step_${String(index + 1).padStart(4, '0')}.zip`;
  try {
    const parsed = new URL(download.url);
    const basename = path.basename(parsed.pathname) || fallback;
    const ensuredZip = basename.toLowerCase().endsWith('.zip') ? basename : `${basename}.zip`;
    return sanitizeFileName(ensuredZip);
  } catch {
    return fallback;
  }
}

function requestToFile(urlValue: string, outputPath: string, redirectCount = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlValue);
    } catch {
      reject(new Error(`Invalid URL: ${urlValue}`));
      return;
    }

    const client = parsedUrl.protocol === 'http:' ? http : https;
    const request = client.get(
      urlValue,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; gobilda-step-pipeline/1.0)',
          Accept: 'application/zip,*/*;q=0.8',
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;

        if (statusCode >= 300 && statusCode < 400 && location && redirectCount < 5) {
          const redirectedUrl = new URL(location, urlValue).toString();
          response.resume();
          requestToFile(redirectedUrl, outputPath, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`Download failed for ${urlValue} with status ${statusCode}`));
          return;
        }

        const file = fs.createWriteStream(outputPath);
        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });

        file.on('error', (error) => {
          response.destroy();
          file.close();
          fs.rmSync(outputPath, { force: true });
          reject(error);
        });
      }
    );

    request.setTimeout(45000, () => {
      request.destroy(new Error(`Timeout while downloading ${urlValue}`));
    });

    request.on('error', (error) => {
      fs.rmSync(outputPath, { force: true });
      reject(error);
    });
  });
}

export function resetCheckpointForFreshRun(checkpointPath: string): boolean {
  if (!fs.existsSync(checkpointPath)) {
    return false;
  }
  fs.rmSync(checkpointPath, { force: true });
  return true;
}

export function createGobildaStepRunDirectories(resultsDir: string, timestamp: string): StepRunDirs {
  const runRootDir = path.join(resultsDir, `${timestamp}_gobilda`);
  const runStepFilesDir = path.join(runRootDir, 'step-files');
  const runDownloadsDir = path.join(runRootDir, 'step-downloads');
  const tempExtractRootDir = path.join(runRootDir, '.tmp-extract');

  ensureDirectory(resultsDir);
  ensureCleanDirectory(runStepFilesDir);
  ensureCleanDirectory(runDownloadsDir);
  ensureCleanDirectory(tempExtractRootDir);

  return {
    runRootDir,
    runStepFilesDir,
    runDownloadsDir,
    tempExtractRootDir,
  };
}

export function collectStepZipDownloads(downloads: StepDownloadRef[]): StepDownloadRef[] {
  const seen = new Set<string>();
  const stepZips: StepDownloadRef[] = [];

  for (const download of downloads) {
    const url = (download.url || '').trim();
    const name = (download.name || '').trim();
    if (!url) {
      continue;
    }

    const normalized = url.toLowerCase();
    const isZip = /\.zip(\?|$)/i.test(normalized);
    const isStepZip = /step/i.test(normalized) || /step/i.test(name.toLowerCase());

    if (!isZip || !isStepZip) {
      continue;
    }

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    stepZips.push({
      name,
      url,
      sku: (download.sku || '').trim(),
      productUrl: (download.productUrl || '').trim(),
      productTitle: (download.productTitle || '').trim(),
    });
  }

  return stepZips;
}

export function processDownloadedStepZip(zipPath: string, runStepFilesDir: string, tempExtractRootDir: string): { flattenedWrapper: boolean } {
  ensureDirectory(runStepFilesDir);
  ensureDirectory(tempExtractRootDir);

  const extractDir = path.join(
    tempExtractRootDir,
    `${path.basename(zipPath, path.extname(zipPath))}_${Date.now()}`
  );
  ensureDirectory(extractDir);

  const archive = new AdmZip(zipPath);
  archive.extractAllTo(extractDir, true);

  const flattenedWrapper = flattenSingleWrapperDirectory(extractDir);
  moveDirectoryContents(extractDir, runStepFilesDir);

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });

  return { flattenedWrapper };
}

export function collectStepExtractionStats(runStepFilesDir: string): StepExtractionStats {
  const files = listFilesRecursively(runStepFilesDir);
  const totalExtractedBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const largestSingleExtractedFileBytes = files.reduce((largest, file) => Math.max(largest, file.bytes), 0);
  const filesOver100MB = files.filter((file) => file.bytes > STEP_SINGLE_FILE_LOCAL_ONLY_BYTES);

  return {
    totalExtractedBytes,
    largestSingleExtractedFileBytes,
    fileCount: files.length,
    filesOver100MB,
  };
}

export function applyGobildaStepRetentionPolicy(options: {
  runStepFilesDir: string;
  stats: StepExtractionStats;
}): StepRetentionDecision {
  const { stats } = options;
  const totalSizeOver2GB = stats.totalExtractedBytes > STEP_TOTAL_TRACKING_THRESHOLD_BYTES;
  const localOnlyStepOutputs = stats.filesOver100MB.length > 0;

  if (stats.fileCount === 0) {
    return {
      localOnlyStepOutputs,
      totalSizeOver2GB,
      reason: 'No extracted STEP files were produced in this run.',
    };
  }

  if (localOnlyStepOutputs) {
    return {
      localOnlyStepOutputs,
      totalSizeOver2GB,
      reason: 'At least one extracted STEP file is larger than 100MB; run is local-only.',
    };
  }

  return {
    localOnlyStepOutputs,
    totalSizeOver2GB,
    reason: totalSizeOver2GB
      ? 'Total extracted STEP size exceeds 2GB; this run exceeds the reporting threshold.'
      : 'STEP outputs were extracted and deduped into the run folder.',
  };
}

export async function runGobildaStepPipeline(options: {
  timestamp: string;
  resultsDir: string;
  downloads: StepDownloadRef[];
  logger?: (message: string) => void;
}): Promise<GobildaStepPipelineResult> {
  const log = options.logger ?? (() => undefined);
  const runDirs = createGobildaStepRunDirectories(options.resultsDir, options.timestamp);
  const stepZipCandidates = collectStepZipDownloads(options.downloads);
  const tempDownloadRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gobilda-step-downloads-'));

  const downloadedZipFiles: string[] = [];
  const extractionFailures: Array<{ zipUrl: string; error: string }> = [];
  let extractedZipCount = 0;

  for (let index = 0; index < stepZipCandidates.length; index += 1) {
    const candidate = stepZipCandidates[index];
    const zipName = inferZipFileName(candidate, index);
    const zipPath = ensureUniquePath(path.join(tempDownloadRootDir, zipName));
    const skuFolderName = sanitizePathSegment(candidate.sku, 'unknown-sku');
    const destinationDir = path.join(runDirs.runStepFilesDir, skuFolderName);

    try {
      await requestToFile(candidate.url, zipPath);
      downloadedZipFiles.push(zipPath);

      log(`STEP ZIP from SKU ${skuFolderName} (${candidate.productUrl})`);
      processDownloadedStepZip(zipPath, destinationDir, runDirs.tempExtractRootDir);
      extractedZipCount += 1;
    } catch (error) {
      extractionFailures.push({
        zipUrl: candidate.url,
        error: error instanceof Error ? error.message : String(error),
      });
      fs.rmSync(zipPath, { force: true });
      log(`STEP extraction failure for ${candidate.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const stats = collectStepExtractionStats(runDirs.runStepFilesDir);
  const retention = applyGobildaStepRetentionPolicy({
    runStepFilesDir: runDirs.runStepFilesDir,
    stats,
  });

  fs.rmSync(runDirs.tempExtractRootDir, { recursive: true, force: true });
  fs.rmSync(tempDownloadRootDir, { recursive: true, force: true });

  return {
    runDirs,
    stepZipCandidates,
    downloadedZipFiles,
    extractedZipCount,
    extractionFailures,
    stats,
    retention,
  };
}
