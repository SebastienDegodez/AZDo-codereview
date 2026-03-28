import fs from "fs";
import path from "path";

/**
 * Infrastructure adapter — reads coding instructions from the filesystem.
 *
 * Each instruction file may contain YAML frontmatter with an `applyTo` glob.
 * Only instructions whose glob matches the target file path are returned.
 *
 * @param {string} dirPath — directory containing instruction files
 * @returns {{ read(filePath?: string): Record<string, string> }}
 */
export function createInstructionReader(dirPath) {
  /**
   * @param {string} [filePath] — file being reviewed (used for applyTo filtering)
   * @returns {Record<string, string>} map of instruction name → content
   */
  function read(filePath = "") {
    if (!fs.existsSync(dirPath)) return {};

    return fs
      .readdirSync(dirPath)
      .filter((f) => fs.statSync(path.join(dirPath, f)).isFile())
      .reduce((acc, file) => {
        const raw = fs.readFileSync(path.join(dirPath, file), "utf-8");
        const { applyTo, content } = parseFrontmatter(raw);

        if (shouldApply(applyTo, filePath)) {
          acc[file] = content;
        }
        return acc;
      }, {});
  }

  return { read };
}

/**
 * Reads a single markdown file and returns its content.
 * @param {string} filePath — absolute path to the file
 * @returns {string} file content, or empty string if missing
 */
export function readFileOrEmpty(filePath) {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf-8");
}

// ── internal ──

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return { applyTo: null, content: raw };

  const frontmatter = match[1];
  const applyToMatch = frontmatter.match(/^applyTo:\s*["']?([^"'\r\n]+)["']?\s*$/m);
  return {
    applyTo: applyToMatch ? applyToMatch[1].trim() : null,
    content: raw.slice(match[0].length),
  };
}

function shouldApply(applyTo, filePath) {
  if (!applyTo || applyTo === "**") return true;
  return matchGlob(applyTo, filePath);
}

function matchGlob(pattern, filePath) {
  if (!filePath) return true;
  const regexStr = pattern
    .replace(/\\/g, "\\\\")
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`(^|/)${regexStr}$`, "i").test(filePath);
}
