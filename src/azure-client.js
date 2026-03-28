import axios from "axios";

// ─── Configuration ────────────────────────────────────────────────────────────

const AZURE_DEVOPS_ORG = process.env.AZURE_DEVOPS_ORG;
const AZURE_DEVOPS_PROJECT = process.env.AZURE_DEVOPS_PROJECT;
const AZURE_DEVOPS_REPO = process.env.AZURE_DEVOPS_REPO;
const AZURE_DEVOPS_PR_ID = process.env.AZURE_DEVOPS_PR_ID;
const AZURE_DEVOPS_PAT = process.env.AZURE_DEVOPS_PAT;

export const azureHeaders = {
  Authorization: `Basic ${Buffer.from(`:${AZURE_DEVOPS_PAT}`).toString("base64")}`,
  "Content-Type": "application/json",
};

export const defaultBaseUrl = `https://dev.azure.com/${AZURE_DEVOPS_ORG}/${AZURE_DEVOPS_PROJECT}/_apis/git/repositories/${AZURE_DEVOPS_REPO}`;

// ─── Azure DevOps Client ──────────────────────────────────────────────────────

/**
 * Récupère les infos (sourceCommit, targetCommit, title) de la PR.
 * @param {string} [baseUrl] - Base URL override (useful for testing with Microcks)
 */
export async function getPRInfo(baseUrl = defaultBaseUrl) {
  const url = `${baseUrl}/pullRequests/${AZURE_DEVOPS_PR_ID}?api-version=7.1`;
  const { data } = await axios.get(url, { headers: azureHeaders });
  return {
    sourceCommitId: data.lastMergeSourceCommit?.commitId,
    targetCommitId: data.lastMergeTargetCommit?.commitId,
    title: data.title,
    description: data.description,
  };
}

/**
 * Récupère les itérations de la PR pour obtenir la dernière.
 * @param {string} [baseUrl] - Base URL override
 */
export async function getLastIterationId(baseUrl = defaultBaseUrl) {
  const url = `${baseUrl}/pullRequests/${AZURE_DEVOPS_PR_ID}/iterations?api-version=7.1`;
  const { data } = await axios.get(url, { headers: azureHeaders });
  const iterations = data.value;
  return iterations[iterations.length - 1].id;
}

/**
 * Récupère les changements (diff) d'une itération donnée.
 * @param {number} iterationId
 * @param {string} [baseUrl] - Base URL override
 */
export async function getPRChanges(iterationId, baseUrl = defaultBaseUrl) {
  const url = `${baseUrl}/pullRequests/${AZURE_DEVOPS_PR_ID}/iterations/${iterationId}/changes?api-version=7.1`;
  const { data } = await axios.get(url, { headers: azureHeaders });
  return data.changeEntries || [];
}

/**
 * Récupère le contenu d'un fichier à un commit donné.
 * @param {string} filePath
 * @param {string} commitId
 * @param {string} [baseUrl] - Base URL override
 */
export async function getFileContent(filePath, commitId, baseUrl = defaultBaseUrl) {
  try {
    const url = `${baseUrl}/items?path=${encodeURIComponent(filePath)}&versionDescriptor.version=${commitId}&versionDescriptor.versionType=commit&api-version=7.1`;
    const { data } = await axios.get(url, { headers: azureHeaders });
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
 * @param {string} [baseUrl] - Base URL override
 */
export async function postComment(filePath, line, comment, baseUrl = defaultBaseUrl) {
  const url = `${baseUrl}/pullRequests/${AZURE_DEVOPS_PR_ID}/threads?api-version=7.1`;

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

  const response = await axios.post(url, body, { headers: azureHeaders });
  console.log(`💬 Commentaire posté sur ${filePath}:${line}`);
  return response;
}

/**
 * Poste un commentaire général sur la PR (résumé).
 * @param {string} comment
 * @param {string} [baseUrl] - Base URL override
 */
export async function postGeneralComment(comment, baseUrl = defaultBaseUrl) {
  const url = `${baseUrl}/pullRequests/${AZURE_DEVOPS_PR_ID}/threads?api-version=7.1`;
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
  const response = await axios.post(url, body, { headers: azureHeaders });
  console.log(`💬 Commentaire général posté.`);
  return response;
}
