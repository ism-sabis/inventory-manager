import fs from 'fs';
import path from 'path';

// src is directly under repo root, so one level up is the project root.
export const REPO_ROOT = path.resolve(__dirname, '..');

export function resolveInRepo(...segments: string[]): string {
  const resolved = path.resolve(REPO_ROOT, ...segments);
  const relative = path.relative(REPO_ROOT, resolved);
  const escapesRepo = relative === '' ? false : relative.startsWith('..') || path.isAbsolute(relative);

  if (escapesRepo) {
    throw new Error(`Resolved path escapes repository root: ${resolved}`);
  }

  return resolved;
}

export function ensureDirInRepo(...segments: string[]): string {
  const dir = resolveInRepo(...segments);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
