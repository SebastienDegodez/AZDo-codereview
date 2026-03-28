import axios from "axios";

// ─── Configuration ───────────────────────────────────────────────────────────

const AZURE_DEVOPS_ORG = process.env.AZURE_DEVOPS_ORG;
const AZURE_DEVOPS_PROJECT = process.env.AZURE_DEVOPS_PROJECT;
const AZURE_DEVOPS_REPO = process.env.AZURE_DEVOPS_REPO;
const AZURE_DEVOPS_PR_ID = process.env.AZURE_DEVOPS_PR_ID;
const AZURE_DEVOPS_PAT = process.env.AZURE_DEVOPS_PAT;

/**
 * Builds the base URL for Azure DevOps Git API.
 * Allows overriding via AZURE_DEVOPS_BASE_URL env var (useful for tests pointing to Microcks).
 */
function getBaseUrl() {
  if (process.env.AZURE_DEVOPS_BASE_URL) {
    return process.env.AZURE_DEVOPS_BASE_URL;
  }
  return `https://dev.azure.com/${AZURE_DEVOPS_ORG}/${AZURE_DEVOPS_PROJECT}/_apis/git/repositories/${AZURE_DEVOPS_REPO}`;
}

/**
 * Returns the Authorization headers for Azure DevOps API calls.
 * When AZURE_DEVOPS_PAT is not set (e.g. in tests), returns empty auth.
 */
function getHeaders() {
  const pat = AZURE_DEVOPS_PAT || "";
  return {
    Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

// ─── Azure DevOps API functions ───────────────────────────────────────────────

/**
 * Récupère les infos (sourceCommit, targetCommit, title, description) de la PR.
 * @param {string} [baseUrl] - Optional base URL override (defaults to env-based URL)
 */
export async function getPRInfo(baseUrl) {
  const base = baseUrl || getBaseUrl();
  const prId = AZURE_DEVOPS_PR_ID;
  const url = `${base}/pullRequests/${prId}`;
  const { data } = await axios.get(url, { headers: getHeaders(), params: { "api-version": "7.1" } });
  return {
    sourceCommitId: data.lastMergeSourceCommit?.commitId,
    targetCommitId: data.lastMergeTargetCommit?.commitId,
    title: data.title,
    description: data.description,
  };
}

/**
 * Récupère les itérations de la PR pour obtenir la dernière.
 * @param {string} [baseUrl] - Optional base URL override
 */
export async function getLastIterationId(baseUrl) {
  const base = baseUrl || getBaseUrl();
  const prId = AZURE_DEVOPS_PR_ID;
  const url = `${base}/pullRequests/${prId}/iterations`;
  const { data } = await axios.get(url, { headers: getHeaders(), params: { "api-version": "7.1" } });
  const iterations = data.value;
  return iterations[iterations.length - 1].id;
}

/**
 * Récupère les changements (diff) d'une itération donnée.
 * @param {number} iterationId
 * @param {string} [baseUrl] - Optional base URL override
 */
export async function getPRChanges(iterationId, baseUrl) {
  const base = baseUrl || getBaseUrl();
  const prId = AZURE_DEVOPS_PR_ID;
  const url = `${base}/pullRequests/${prId}/iterations/${iterationId}/changes`;
  const { data } = await axios.get(url, { headers: getHeaders(), params: { "api-version": "7.1" } });
  return data.changeEntries || [];
}

/**
 * Récupère le contenu d'un fichier à un commit donné.
 * @param {string} filePath
 * @param {string} commitId
 * @param {string} [baseUrl] - Optional base URL override
 */
export async function getFileContent(filePath, commitId, baseUrl) {
  try {
    const base = baseUrl || getBaseUrl();
    const url = `${base}/items`;
    const { data } = await axios.get(url, {
      headers: getHeaders(),
      params: {
        path: filePath,
        "versionDescriptor.version": commitId,
        "versionDescriptor.versionType": "commit",
        "api-version": "7.1",
      },
    });
    return typeof data === "string" ? data : JSON.stringify(data, null, 2);
  } catch {
    return null;
  }
}

/**
 * Poste un thread de commentaire sur un fichier de la PR.
 * @param {string} filePath
 * @param {number} line
 * @param {string} comment
 * @param {string} [baseUrl] - Optional base URL override
 */
export async function postComment(filePath, line, comment, baseUrl) {
  const base = baseUrl || getBaseUrl();
  const prId = AZURE_DEVOPS_PR_ID;
  const url = `${base}/pullRequests/${prId}/threads`;

  const body = {
    comments: [
      {
        parentCommentId: 0,
        content: comment,
        commentType: 1,
      },
    ],
    status: 1,
    threadContext: filePath
      ? {
          filePath: `/${filePath}`,
          rightFileStart: { line, offset: 1 },
          rightFileEnd: { line, offset: 1 },
        }
      : undefined,
  };

  const response = await axios.post(url, body, {
    headers: getHeaders(),
    params: { "api-version": "7.1" },
  });
  console.log(`💬 Commentaire posté sur ${filePath}:${line}`);
  return response;
}

/**
 * Poste un commentaire général (sans contexte de fichier) sur la PR.
 * @param {string} comment
 * @param {string} [baseUrl] - Optional base URL override
 */
export async function postGeneralComment(comment, baseUrl) {
  const base = baseUrl || getBaseUrl();
  const prId = AZURE_DEVOPS_PR_ID;
  const url = `${base}/pullRequests/${prId}/threads`;
  const body = {
    comments: [
      {
        parentCommentId: 0,
        content: comment,
        commentType: 1,
      },
    ],
    status: 1,
  };
  const response = await axios.post(url, body, {
    headers: getHeaders(),
    params: { "api-version": "7.1" },
  });
  console.log(`💬 Commentaire général posté.`);
  return response;
}
