import axios from "axios";

/**
 * Factory function that creates an Azure DevOps API client.
 * @param {{ baseUrl?: string, pat: string, org: string, project: string, repo: string, prId: string }} options
 * @returns Azure DevOps client object with API methods
 */
export function createAzureClient({ baseUrl, pat, org, project, repo, prId }) {
  const root = baseUrl || "https://dev.azure.com";
  const base = `${root}/${org}/${project}/_apis/git/repositories/${repo}`;

  const headers = () => ({
    Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`,
    "Content-Type": "application/json",
  });

  async function getPRInfo() {
    const url = `${base}/pullRequests/${prId}?api-version=7.1`;
    const { data } = await axios.get(url, { headers: headers() });
    return {
      sourceCommitId: data.lastMergeSourceCommit?.commitId,
      targetCommitId: data.lastMergeTargetCommit?.commitId,
      title: data.title,
      description: data.description,
    };
  }

  async function getLastIterationId() {
    const url = `${base}/pullRequests/${prId}/iterations?api-version=7.1`;
    const { data } = await axios.get(url, { headers: headers() });
    return data.value.at(-1).id;
  }

  async function getPRChanges(iterationId) {
    const url = `${base}/pullRequests/${prId}/iterations/${iterationId}/changes?api-version=7.1`;
    const { data } = await axios.get(url, { headers: headers() });
    return data.changeEntries || [];
  }

  async function getFileContent(filePath, commitId) {
    try {
      const url = `${base}/items?path=${encodeURIComponent(filePath)}&versionDescriptor.version=${commitId}&versionDescriptor.versionType=commit&api-version=7.1`;
      const { data } = await axios.get(url, { headers: headers() });
      return typeof data === "string" ? data : JSON.stringify(data, null, 2);
    } catch {
      return null;
    }
  }

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
    return data;
  }

  async function postGeneralComment(comment) {
    const url = `${base}/pullRequests/${prId}/threads?api-version=7.1`;
    const body = {
      comments: [{ parentCommentId: 0, content: comment, commentType: 1 }],
      status: 1,
    };
    const { data } = await axios.post(url, body, { headers: headers() });
    return data;
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
