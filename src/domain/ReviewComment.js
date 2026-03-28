/**
 * Domain value object — a review comment to post on a file.
 */
export class ReviewComment {
  /**
   * @param {object} params
   * @param {string} params.filePath
   * @param {number} params.line
   * @param {string} params.severity — "critique" | "majeur" | "mineur" | "suggestion"
   * @param {string} params.comment
   */
  constructor({ filePath, line, severity, comment }) {
    this.filePath = filePath;
    this.line = line;
    this.severity = severity;
    this.comment = comment;
  }

  /** Emoji prefix for formatted output. */
  emoji() {
    const map = { critique: "🔴", majeur: "🟠", mineur: "🟡", suggestion: "🔵" };
    return map[this.severity] ?? "⚪";
  }

  /** Formatted markdown string ready to post. */
  formatted() {
    return `${this.emoji()} **[${this.severity.toUpperCase()}]** — Code Review IA\n\n${this.comment}`;
  }

  toString() {
    return `ReviewComment(${this.filePath}:${this.line} [${this.severity}])`;
  }
}
