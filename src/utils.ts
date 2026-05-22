import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";

/**
 * Expand ~ in paths.
 */
export function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    // os.homedir() reads the HOME env var which may be overridden
    // (e.g. by Antigravity profile aliases). We try to read the real home
    // from passwd on Linux, but gracefully fall back to os.homedir().
    let realHome = os.homedir();
    try {
      if (process.platform === "linux") {
        realHome = execSync("getent passwd $(id -un) | cut -d: -f6").toString().trim();
      }
    } catch {
      // Fallback to os.homedir() on error
    }
    return path.join(realHome, p.slice(1));
  }
  return p;
}

/**
 * Find the active brain UUID directory.
 * Returns the most recently modified directory in the brain path.
 */
export function getActiveBrainUuid(brainPath: string): { uuid: string | null; fullPath: string } {
  let fullPath = expandHome(brainPath);

  try {
    if (!fs.existsSync(fullPath)) {
      if (fullPath.includes("/.gemini/antigravity/brain")) {
        const fallbackPath = fullPath.replace(
          "/.gemini/antigravity/brain",
          "/.gemini/antigravity-ide/brain",
        );
        if (fs.existsSync(fallbackPath)) {
          fullPath = fallbackPath;
        }
      } else if (fullPath.includes("/.gemini/antigravity-ide/brain")) {
        const fallbackPath = fullPath.replace(
          "/.gemini/antigravity-ide/brain",
          "/.gemini/antigravity/brain",
        );
        if (fs.existsSync(fallbackPath)) {
          fullPath = fallbackPath;
        }
      }
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    let latestUuid: string | null = null;
    let maxMtime = 0;

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = path.join(fullPath, entry.name);
        const stats = fs.statSync(dirPath);
        if (stats.mtimeMs > maxMtime) {
          maxMtime = stats.mtimeMs;
          latestUuid = entry.name;
        }
      }
    }
    return { uuid: latestUuid, fullPath };
  } catch {
    return { uuid: null, fullPath };
  }
}
