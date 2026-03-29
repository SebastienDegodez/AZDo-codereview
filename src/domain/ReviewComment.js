/**
 * Domain value object — a review comment to post on a file.
 */
export class ReviewComment {
  /**
   * @param {object} params
   * @param {string} params.filePath
   * @param {number} params.line
   * @param {number} [params.endLine] — optional end line for multi-line comments
   * @param {string} params.severity — "critique" | "majeur" | "mineur" | "suggestion"
   * @param {string} params.comment
   * @param {string} [params.suggestion] — optional code suggestion to replace the selected lines
   */
  constructor({ filePath, line, endLine, severity, comment, suggestion }) {
    this.filePath = filePath;
    this.line = line;
    this.endLine = endLine ?? null;
    this.severity = severity;
    this.comment = comment;
    this.suggestion = suggestion ?? null;
  }

  /** Emoji prefix for formatted output. */
  emoji() {
    const map = { critique: "🔴", majeur: "🟠", mineur: "🟡", suggestion: "🔵" };
    return map[this.severity] ?? "⚪";
  }

  /** Formatted markdown string ready to post. */
  formatted() {
    const header = `${this.emoji()} **[${this.severity.toUpperCase()}]** — Code Review IA\n\n${this.comment}`;
    if (!this.suggestion) return header;
    return `${header}\n\n\`\`\`suggestion\n${this.suggestion}\n\`\`\``;
  }

  toString() {
    const lineRange = this.endLine ? `${this.line}-${this.endLine}` : `${this.line}`;
    return `ReviewComment(${this.filePath}:${lineRange} [${this.severity}])`;
  }
}
