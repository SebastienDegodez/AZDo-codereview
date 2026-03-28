import fs from "fs";
import path from "path";

/**
 * Infrastructure adapter — reads coding skills from the filesystem.
 *
 * Skills are discovered lazily: the registry knows file names on construction,
 * but contents are loaded only when requested (lazy loading).
 *
 * @param {string} dirPath — directory containing skill files
 * @returns {{ list(): string[], load(name: string): string|null }}
 */
export function createSkillReader(dirPath) {
  const registry = buildRegistry(dirPath);

  /** @returns {string[]} available skill file names */
  function list() {
    return Object.keys(registry);
  }

  /**
   * Loads and caches a skill's content by name.
   * @param {string} skillName
   * @returns {string|null} content, or null if not found
   */
  function load(skillName) {
    const skill = registry[skillName];
    if (!skill) return null;
    if (!skill.loaded) {
      skill.content = fs.readFileSync(skill.filePath, "utf-8");
      skill.loaded = true;
    }
    return skill.content;
  }

  return { list, load };
}

// ── internal ──

function buildRegistry(dirPath) {
  if (!fs.existsSync(dirPath)) return {};
  return fs
    .readdirSync(dirPath)
    .filter((f) => fs.statSync(path.join(dirPath, f)).isFile())
    .reduce((acc, file) => {
      acc[file] = { loaded: false, content: null, filePath: path.join(dirPath, file) };
      return acc;
    }, {});
}
