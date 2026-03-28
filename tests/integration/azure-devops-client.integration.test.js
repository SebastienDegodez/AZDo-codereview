/**
 * Integration tests for the Azure DevOps client module.
 *
 * Prerequisites:
 *   - Microcks running on http://localhost:8585
 *   - Start with: docker compose -f docker-compose.test.yml up -d
 *
 * Run:
 *   npm run test:integration
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import axios from "axios";

// ─── Configuration ────────────────────────────────────────────────────────────

// Point the azure client at Microcks instead of real Azure DevOps
const MICROCKS_BASE = "http://localhost:8585";
const ORG = "MyOrg";
const PROJECT = "MyProject";
const REPO = "MyRepo";
const PR_ID = "42";

const BASE_URL = `${MICROCKS_BASE}/${ORG}/${PROJECT}/_apis/git/repositories/${REPO}`;

// Set env vars so the azure-client module resolves correctly
process.env.AZURE_DEVOPS_ORG = ORG;
process.env.AZURE_DEVOPS_PROJECT = PROJECT;
process.env.AZURE_DEVOPS_REPO = REPO;
process.env.AZURE_DEVOPS_PR_ID = PR_ID;
process.env.AZURE_DEVOPS_PAT = "test-pat";
process.env.AZURE_DEVOPS_BASE_URL = BASE_URL;

// Import azure client functions AFTER setting env vars
const { getPRInfo, getLastIterationId, getPRChanges, getFileContent, postComment, postGeneralComment } =
  await import("../../src/azure-client.js");

// ─── Health check helper ──────────────────────────────────────────────────────

/**
 * Waits for Microcks to be ready by polling its health endpoint.
 * Retries up to maxRetries times with delayMs between attempts.
 */
async function waitForMicrocks(maxRetries = 20, delayMs = 3000) {
  const healthUrl = `${MICROCKS_BASE}/api/health`;
  for (let i = 1; i <= maxRetries; i++) {
    try {
      const response = await axios.get(healthUrl, { timeout: 2000 });
      if (response.status === 200) {
        console.log(`✅ Microcks is ready (attempt ${i})`);
        return;
      }
    } catch {
      // not ready yet
    }
    console.log(`⏳ Waiting for Microcks... (attempt ${i}/${maxRetries})`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Microcks did not become ready at ${healthUrl} after ${maxRetries} attempts`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Azure DevOps Client — Integration (Microcks)", () => {
  beforeAll(async () => {
    await waitForMicrocks();
  }, 90_000);

  describe("getPRInfo()", () => {
    it("returns the PR title and commit IDs from the PR_OPEN example", async () => {
      const info = await getPRInfo(BASE_URL);

      expect(info.title).toBe("feat: add awesome feature");
      expect(info.sourceCommitId).toBe("abc123def456abc123def456abc123def456abc1");
      expect(info.targetCommitId).toBe("def456abc123def456abc123def456abc123def4");
    });
  });

  describe("getLastIterationId()", () => {
    it("returns 1 from the ITERATIONS_LIST example", async () => {
      const iterationId = await getLastIterationId(BASE_URL);

      expect(iterationId).toBe(1);
    });
  });

  describe("getPRChanges(iterationId)", () => {
    it("returns two changed files from the CHANGES_LIST example", async () => {
      const changes = await getPRChanges(1, BASE_URL);

      expect(changes).toHaveLength(2);
      expect(changes[0].item.path).toBe("/src/app.js");
      expect(changes[1].item.path).toBe("/src/Service.cs");
    });
  });

  describe("getFileContent(filePath, commitId)", () => {
    it("returns content for app.js (FILE_JS_CONTENT example)", async () => {
      const content = await getFileContent(
        "/src/app.js",
        "abc123def456abc123def456abc123def456abc1",
        BASE_URL
      );

      expect(content).toBeTruthy();
      const parsed = JSON.parse(content);
      expect(parsed.path).toBe("/src/app.js");
    });

    it("returns content for Service.cs (FILE_CS_CONTENT example)", async () => {
      const content = await getFileContent(
        "/src/Service.cs",
        "abc123def456abc123def456abc123def456abc1",
        BASE_URL
      );

      expect(content).toBeTruthy();
      const parsed = JSON.parse(content);
      expect(parsed.path).toBe("/src/Service.cs");
    });
  });

  describe("postComment(filePath, line, comment)", () => {
    it("posts a file comment and receives a thread response (THREAD_CREATED example)", async () => {
      const response = await postComment("/src/app.js", 1, "Code review comment", BASE_URL);

      expect(response.status).toBe(200);
      expect(response.data.id).toBe(1001);
      expect(response.data.comments).toHaveLength(1);
    });
  });

  describe("postGeneralComment(comment)", () => {
    it("posts a general comment and receives a thread response (THREAD_CREATED example)", async () => {
      const response = await postGeneralComment("General review summary", BASE_URL);

      expect(response.status).toBe(200);
      expect(response.data.id).toBe(1001);
    });
  });
});
