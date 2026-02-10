import * as path from "path";

// Compiled binary: import.meta.dir is /$bunfs/, so use the binary's location on disk.
// Dev mode: import.meta.dir is the real src/ directory.
const IS_COMPILED = import.meta.dir.startsWith("/$bunfs");
const CARLTON_DIR = IS_COMPILED
  ? path.dirname(process.execPath)
  : path.resolve(import.meta.dir, "..");

export function getProjectRoot(): string {
  return CARLTON_DIR;
}

export function getReportsDir(): string {
  return path.join(CARLTON_DIR, "reports");
}

