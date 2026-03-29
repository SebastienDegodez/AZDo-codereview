/**
 * Domain value object — a character-level selection within a line range.
 *
 * Groups the column boundaries that identify the exact portion of code
 * that is problematic in a review comment (Object Calisthenics: no primitive obsession).
 */
export class CodeRange {
  /**
   * @param {object} params
   * @param {number} params.start — 1-indexed column where the highlighted portion begins
   * @param {number} params.end   — 1-indexed column where the highlighted portion ends
   */
  constructor({ start, end }) {
    this.start = start;
    this.end = end;
  }

  toString() {
    return `col:${this.start}-${this.end}`;
  }
}
