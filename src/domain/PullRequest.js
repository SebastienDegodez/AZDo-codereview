/**
 * Domain entity representing an Azure DevOps Pull Request.
 * Encapsulates the core business concept of a PR with its key properties.
 */
export class PullRequest {
  /**
   * @param {object} params
   * @param {number} params.pullRequestId
   * @param {string} params.title
   * @param {string} [params.description]
   * @param {string} params.sourceCommitId  - last merge source commit
   * @param {string} params.targetCommitId  - last merge target commit
   */
  constructor({ pullRequestId, title, description = "", sourceCommitId, targetCommitId }) {
    this.pullRequestId = pullRequestId;
    this.title = title;
    this.description = description;
    this.sourceCommitId = sourceCommitId;
    this.targetCommitId = targetCommitId;
  }

  /** Returns true when the PR has a non-empty title. */
  isValid() {
    return Boolean(this.title && this.sourceCommitId);
  }

  toString() {
    return `PR#${this.pullRequestId} — "${this.title}"`;
  }
}
