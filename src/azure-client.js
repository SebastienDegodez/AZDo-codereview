import axios from "axios";
import { PullRequest } from "./domain/PullRequest.js";
import { FileChange } from "./domain/FileChange.js";
import { ReviewThread } from "./domain/ReviewThread.js";

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

  /** @returns {Promise<PullRequest>} */
  async function getPRInfo() {
    const url = `${base}/pullRequests/${prId}?api-version=7.1`;
    const { data } = await axios.get(url, { headers: headers() });
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
    const url = `${base}/pullRequests/${prId}/iterations?api-version=7.1`;
    const { data } = await axios.get(url, { headers: headers() });
    return data.value.at(-1).id;
  }

  /** @returns {Promise<FileChange[]>} */
  async function getPRChanges(iterationId) {
    const url = `${base}/pullRequests/${prId}/iterations/${iterationId}/changes?api-version=7.1`;
    const { data } = await axios.get(url, { headers: headers() });
    return (data.changeEntries || []).map(
      (entry) =>
        new FileChange({
          path: entry.item?.path ?? "",
          changeType: entry.changeType,
          objectId: entry.item?.objectId ?? "",
        })
    );
  }

  /** @returns {Promise<string|null>} raw file content, or null if inaccessible */
  async function getFileContent(filePath, commitId) {
    try {
      const url = `${base}/items?path=${encodeURIComponent(filePath)}&versionDescriptor.version=${commitId}&versionDescriptor.versionType=commit&api-version=7.1`;
      const { data } = await axios.get(url, { headers: headers() });
      return typeof data === "string" ? data : JSON.stringify(data, null, 2);
    } catch {
      return null;
    }
  }

  /** @returns {Promise<ReviewThread>} */
  async function postComment(filePath, line, comment) {
    const url = `${base}/pullRequests/${prId}/threads?api-version=7.1`;
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
    const { data } = await axios.post(url, body, { headers: headers() });
    return new ReviewThread({ id: data.id, status: data.status });
  }

  /** @returns {Promise<ReviewThread>} */
  async function postGeneralComment(comment) {
    const url = `${base}/pullRequests/${prId}/threads?api-version=7.1`;
    const body = {
      comments: [{ parentCommentId: 0, content: comment, commentType: 1 }],
      status: 1,
    };
    const { data } = await axios.post(url, body, { headers: headers() });
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
