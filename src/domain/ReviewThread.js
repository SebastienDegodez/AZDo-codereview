/**
 * Domain entity representing an Azure DevOps PR review thread (a posted comment).
 */
export class ReviewThread {
  /**
   * @param {object} params
   * @param {number} params.id
   * @param {string} params.status - e.g. "active", "closed", "byDesign"
   */
  constructor({ id, status }) {
    this.id = id;
    this.status = status;
  }

  /** Returns true when the thread is in an "active" state. */
  isActive() {
    return this.status === "active";
  }

  /** Returns true when the thread has a valid numeric id. */
  isValid() {
    return typeof this.id === "number" && this.id > 0;
  }

  toString() {
    return `ReviewThread#${this.id} [${this.status}]`;
  }
}
