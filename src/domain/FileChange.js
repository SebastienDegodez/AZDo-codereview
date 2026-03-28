/**
 * Domain entity representing a file change inside a Pull Request iteration.
 */
export class FileChange {
  /** Azure DevOps changeType constant for a deleted item. */
  static CHANGE_TYPE_DELETE = 32;

  /**
   * @param {object} params
   * @param {string} params.path       - e.g. "/src/app.js"
   * @param {number} params.changeType - Azure DevOps changeType integer
   * @param {string} [params.objectId] - git object id (blob sha)
   */
  constructor({ path, changeType, objectId = "" }) {
    this.path = path;
    this.changeType = changeType;
    this.objectId = objectId;
  }

  /** Returns true when the file was deleted in this iteration. */
  isDeleted() {
    return this.changeType === FileChange.CHANGE_TYPE_DELETE;
  }

  /** Returns the file extension (lowercase), e.g. ".js". */
  extension() {
    const dot = this.path.lastIndexOf(".");
    return dot !== -1 ? this.path.slice(dot).toLowerCase() : "";
  }

  toString() {
    return `FileChange(${this.path}, type=${this.changeType})`;
  }
}
