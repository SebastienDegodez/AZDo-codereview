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
 *  5. Fetch commit diff between target and source branch commits
 *  6. Enrich each reviewable change with its diff (skipping files without a diff)
 *
 * @param {object} deps — injected infrastructure ports
 * @param {object} deps.pullRequestGateway — port to access PR data
 * @returns {{ execute(): Promise<{ pullRequest, files: Array<{ change: FileChange, diff: string }>, skippedFiles: Array<{ path: string, reason: string }> }> }}
 */
export function createGetReviewableFiles({ pullRequestGateway }) {
  /**
   * @returns {Promise<{ pullRequest: import("../domain/PullRequest.js").PullRequest, files: Array<{ change: FileChange, diff: string }>, skippedFiles: Array<{ path: string, reason: string }> }>}
   */
  async function execute() {
    const pullRequest = await pullRequestGateway.getPRInfo();
    const iterationId = await pullRequestGateway.getLastIterationId();
    const changes = await pullRequestGateway.getPRChanges(iterationId);

    const reviewableChanges = changes.filter(
      (c) => c.path && CODE_FILE_EXTENSIONS.test(c.path) && !c.isDeleted()
    );

    // Get the diff between target branch and source branch (what the PR will change)
    const diffEntries = await pullRequestGateway.getCommitDiff(
      pullRequest.targetCommitId,
      pullRequest.sourceCommitId
    );

    // Build a map of path → diff for quick lookup
    const diffMap = new Map();
    for (const entry of diffEntries) {
      diffMap.set(entry.path, entry.diff);
    }

    const files = [];
    const skippedFiles = [];

    for (const change of reviewableChanges) {
      const diff = diffMap.get(change.path);
      if (diff) {
        files.push({ change, diff });
      } else {
        skippedFiles.push({ path: change.path, reason: "diff_not_found" });
      }
    }

    return { pullRequest, files, skippedFiles };
  }

  return { execute };
}
