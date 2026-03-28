import { FileChange } from "../domain/FileChange.js";

/** File extensions that should be sent to code review. */
const CODE_FILE_EXTENSIONS = /\.(js|ts|jsx|tsx|py|cs|java|go|rb|php|cpp|c|h|sql|yaml|yml|json|xml|sh|ps1)$/i;

/**
 * Application use case — Get reviewable files from a Pull Request.
 *
 * Orchestrates:
 *  1. Fetch PR metadata
 *  2. Fetch the latest iteration
 *  3. Fetch file changes for that iteration
 *  4. Filter to reviewable code files (non-deleted, matching code extensions)
 *  5. Fetch file contents
 *
 * @param {object} deps — injected infrastructure ports
 * @param {object} deps.pullRequestGateway — port to access PR data
 * @returns {{ execute(): Promise<{ pullRequest, files: Array<{ change: FileChange, content: string }> }> }}
 */
export function createGetReviewableFiles({ pullRequestGateway }) {
  /**
   * @returns {Promise<{ pullRequest: import("../domain/PullRequest.js").PullRequest, files: Array<{ change: FileChange, content: string }> }>}
   */
  async function execute() {
    const pullRequest = await pullRequestGateway.getPRInfo();
    const iterationId = await pullRequestGateway.getLastIterationId();
    const changes = await pullRequestGateway.getPRChanges(iterationId);

    const reviewableChanges = changes.filter(
      (c) => c.path && CODE_FILE_EXTENSIONS.test(c.path) && !c.isDeleted()
    );

    const files = [];
    for (const change of reviewableChanges) {
      const filePath = change.path.replace(/^\//, "");
      const content = await pullRequestGateway.getFileContent(
        filePath,
        pullRequest.sourceCommitId
      );
      if (content) {
        files.push({ change, content });
      }
    }

    return { pullRequest, files };
  }

  return { execute };
}
