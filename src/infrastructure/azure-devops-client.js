import axios from "axios";
import { PullRequest } from "../domain/PullRequest.js";
import { FileChange } from "../domain/FileChange.js";
import { ReviewThread } from "../domain/ReviewThread.js";
import { logger } from "./logger.js";

/** Azure DevOps REST API version used for all requests. */
const API_VERSION = "7.1";

/**
 * Infrastructure adapter — Azure DevOps REST API client.
 *
 * Factory that returns an object whose methods map HTTP responses to
 * domain entities ({@link PullRequest}, {@link FileChange}, {@link ReviewThread}).
 *
 * @param {{ baseUrl?: string, pat: string, org: string, project: string, repo: string, prId: string }} options
 * @returns {{ getPRInfo, getLastIterationId, getPRChanges, getFileContent, postComment, postGeneralComment }}
 */
export function createAzureClient({ baseUrl, pat, org, project, repo, prId }) {
  const root = baseUrl || "https://dev.azure.com";
  const base = `${root}/${org}/${project}/_apis/git/repositories/${repo}`;

  const headers = () => ({
    Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`,
    "Content-Type": "application/json",
  });

  const apiParams = { "api-version": API_VERSION };

  /** @returns {Promise<PullRequest>} */
  async function getPRInfo() {
    const url = `${base}/pullRequests/${prId}`;
    logger.verbose(`GET ${url}`);
    const { data } = await axios.get(url, { headers: headers(), params: apiParams });
    logger.verbose(`PR #${data.pullRequestId} retrieved: "${data.title}"`);
    return new PullRequest({
      pullRequestId: data.pullRequestId,
      title: data.title,
      description: data.description,
      sourceCommitId: data.lastMergeSourceCommit?.commitId,
      targetCommitId: data.lastMergeTargetCommit?.commitId,
    });
  }

  /** @returns {Promise<number>} latest iteration id */
  async function getLastIterationId() {
    const url = `${base}/pullRequests/${prId}/iterations`;
    logger.verbose(`GET ${url}`);
    const { data } = await axios.get(url, { headers: headers(), params: apiParams });
    const id = data.value.at(-1).id;
    logger.verbose(`Last iteration id: ${id}`);
    return id;
  }

  /** @returns {Promise<FileChange[]>} */
  async function getPRChanges(iterationId) {
    const url = `${base}/pullRequests/${prId}/iterations/${iterationId}/changes`;
    logger.verbose(`GET ${url}`);
    const { data } = await axios.get(url, { headers: headers(), params: apiParams });
    const changes = (data.changeEntries || []).map(
      (entry) =>
        new FileChange({
          path: entry.item?.path ?? "",
          changeType: entry.changeType,
          objectId: entry.item?.objectId ?? "",
        })
    );
    logger.verbose(`${changes.length} change(s) found in iteration ${iterationId}`);
    return changes;
  }

  /** @returns {Promise<string|null>} raw file content, or null if inaccessible */
  async function getFileContent(filePath, commitId) {
    try {
      const url = `${base}/items`;
      logger.verbose(`GET file content: ${filePath} @ ${commitId}`);
      const { data } = await axios.get(url, {
        headers: headers(),
        params: {
          path: filePath,
          "versionDescriptor.version": commitId,
          "versionDescriptor.versionType": "commit",
          "api-version": API_VERSION,
        },
      });
      return typeof data === "string" ? data : JSON.stringify(data, null, 2);
    } catch {
      logger.warn(`Could not retrieve file content: ${filePath}`);
      return null;
    }
  }

  /** @returns {Promise<ReviewThread>} */
  async function postComment(filePath, line, comment) {
    const url = `${base}/pullRequests/${prId}/threads`;
    logger.verbose(`POST review comment on ${filePath}:${line}`);
    const body = {
      comments: [{ parentCommentId: 0, content: comment, commentType: 1 }],
      status: 1,
      threadContext: filePath
        ? {
            filePath: filePath.startsWith("/") ? filePath : `/${filePath}`,
            rightFileStart: { line, offset: 1 },
            rightFileEnd: { line, offset: 1 },
          }
        : undefined,
    };
    const { data } = await axios.post(url, body, { headers: headers(), params: apiParams });
    logger.verbose(`Review thread created: id=${data.id}`);
    return new ReviewThread({ id: data.id, status: data.status });
  }

  /** @returns {Promise<ReviewThread>} */
  async function postGeneralComment(comment) {
    const url = `${base}/pullRequests/${prId}/threads`;
    logger.verbose(`POST general comment on PR #${prId}`);
    const body = {
      comments: [{ parentCommentId: 0, content: comment, commentType: 1 }],
      status: 1,
    };
    const { data } = await axios.post(url, body, { headers: headers(), params: apiParams });
    logger.verbose(`General comment thread created: id=${data.id}`);
    return new ReviewThread({ id: data.id, status: data.status });
  }

  return {
    getPRInfo,
    getLastIterationId,
    getPRChanges,
    getFileContent,
    postComment,
    postGeneralComment,
  };
}
