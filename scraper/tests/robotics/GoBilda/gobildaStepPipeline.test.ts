import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import {
  applyGobildaStepRetentionPolicy,
  collectStepExtractionStats,
  createGobildaStepRunDirectories,
  processDownloadedStepZip,
} from '../../../src/gobildaStepPipeline';

describe('GoBILDA STEP pipeline helpers', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gobilda-step-pipeline-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('dedupes identical same-named STEP files during extraction', () => {
    const resultsDir = path.join(tempRoot, 'Results', 'robotics', 'GoBilda');
    const dirs = createGobildaStepRunDirectories(resultsDir, '2099-01-01_00-00-00');

    expect(fs.existsSync(dirs.runRootDir)).toBe(true);
    expect(fs.existsSync(dirs.runStepFilesDir)).toBe(true);
    expect(fs.existsSync(dirs.runDownloadsDir)).toBe(true);

    const firstZipPath = path.join(dirs.runDownloadsDir, 'sample_step_a.zip');
    const secondZipPath = path.join(dirs.runDownloadsDir, 'sample_step_b.zip');

    const firstZip = new AdmZip();
    firstZip.addFile('wrapper/main.step', Buffer.from('solid-data'));
    firstZip.writeZip(firstZipPath);

    const secondZip = new AdmZip();
    secondZip.addFile('wrapper/main.step', Buffer.from('solid-data'));
    secondZip.writeZip(secondZipPath);

    const firstExtraction = processDownloadedStepZip(firstZipPath, dirs.runStepFilesDir, dirs.tempExtractRootDir);
    const secondExtraction = processDownloadedStepZip(secondZipPath, dirs.runStepFilesDir, dirs.tempExtractRootDir);

    expect(firstExtraction.flattenedWrapper).toBe(true);
    expect(secondExtraction.flattenedWrapper).toBe(true);
    expect(fs.existsSync(firstZipPath)).toBe(false);
    expect(fs.existsSync(secondZipPath)).toBe(false);
    expect(fs.existsSync(path.join(dirs.runStepFilesDir, 'main.step'))).toBe(true);
    expect(fs.readdirSync(dirs.runStepFilesDir).filter((name) => name === 'main.step')).toHaveLength(1);
  });

  it('marks runs local-only when an extracted STEP file exceeds 100MB', () => {
    const runStepDir = path.join(tempRoot, 'run-step-files');

    fs.mkdirSync(runStepDir, { recursive: true });

    const bigFilePath = path.join(runStepDir, 'oversized.step');
    const fd = fs.openSync(bigFilePath, 'w');
    fs.writeSync(fd, Buffer.from([0]), 0, 1, 100 * 1024 * 1024 + 1);
    fs.closeSync(fd);

    const stats = collectStepExtractionStats(runStepDir);
    const decision = applyGobildaStepRetentionPolicy({
      runStepFilesDir: runStepDir,
      stats,
    });

    expect(stats.fileCount).toBe(1);
    expect(stats.filesOver100MB.length).toBe(1);
    expect(decision.localOnlyStepOutputs).toBe(true);
    expect(decision.totalSizeOver2GB).toBe(false);
  });
});
