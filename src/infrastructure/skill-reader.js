import fs from "fs";
import path from "path";
import { logger } from "./logger.js";

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
    const skills = Object.keys(registry);
    logger.verbose(`Available skills: ${skills.length > 0 ? skills.join(", ") : "none"}`);
    return skills;
  }

  /**
   * Loads and caches a skill's content by name.
   * @param {string} skillName
   * @returns {string|null} content, or null if not found
   */
  function load(skillName) {
    const skill = registry[skillName];
    if (!skill) {
      logger.warn(`Skill not found: ${skillName}`);
      return null;
    }
    if (!skill.loaded) {
      logger.verbose(`Loading skill from disk: ${skillName}`);
      skill.content = fs.readFileSync(skill.filePath, "utf-8");
      skill.loaded = true;
    }
    return skill.content;
  }

  return { list, load };
}

// ── internal ──

function buildRegistry(dirPath) {
  if (!fs.existsSync(dirPath)) {
    logger.verbose(`Skills directory not found: ${dirPath}`);
    return {};
  }
  const files = fs
    .readdirSync(dirPath)
    .filter((f) => fs.statSync(path.join(dirPath, f)).isFile());
  logger.verbose(`Skills registry built: ${files.length} skill(s) found in ${dirPath}`);
  return files.reduce((acc, file) => {
    acc[file] = { loaded: false, content: null, filePath: path.join(dirPath, file) };
    return acc;
  }, {});
}
