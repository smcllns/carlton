import * as fs from "fs";
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

const CONFIG_FILE = path.join(CARLTON_DIR, "src", "config.json");

export interface CarltonAccount {
  email: string;
  label?: string; // e.g. "work", "personal"
}

export interface CarltonConfig {
  accounts: CarltonAccount[];
}

const DEFAULT_CONFIG: CarltonConfig = {
  accounts: [],
};

export function loadConfig(): CarltonConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    return DEFAULT_CONFIG;
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
}

export function saveConfig(config: CarltonConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getReportsDir(): string {
  return path.join(CARLTON_DIR, "reports");
}

export function getMemoryFile(): string {
  return path.join(CARLTON_DIR, "reports", "memory.txt");
}
