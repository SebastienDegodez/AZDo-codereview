/**
 * Integration tests for Azure DevOps client functions.
 *
 * Prerequisites:
 *   - Microcks must be running on http://localhost:8585
 *   - Start with: docker compose -f docker-compose.test.yml up -d
 *
 * Run: npm run test:integration
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import axios from "axios";

// ─── Configuration ────────────────────────────────────────────────────────────

const MICROCKS_BASE_URL = process.env.MICROCKS_BASE_URL ?? "http://localhost:8585";
const ORG = "MyOrg";
const PROJECT = "MyProject";
const REPO = "MyRepo";
const PR_ID = "42";
const BASE_URL = `${MICROCKS_BASE_URL}/${ORG}/${PROJECT}/_apis/git/repositories/${REPO}`;

// Override env vars to point the azure-client to Microcks
process.env.AZURE_DEVOPS_ORG = ORG;
process.env.AZURE_DEVOPS_PROJECT = PROJECT;
process.env.AZURE_DEVOPS_REPO = REPO;
process.env.AZURE_DEVOPS_PR_ID = PR_ID;
process.env.AZURE_DEVOPS_PAT = "test-pat";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Waits for Microcks to be ready by polling its health endpoint.
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} delayMs - Delay in milliseconds between retries
 */
async function waitForMicrocks(maxRetries = 15, delayMs = 2000) {
  const healthUrl = `${MICROCKS_BASE_URL}/api/health`;
  for (let i = 1; i <= maxRetries; i++) {
    try {
      const response = await axios.get(healthUrl, { timeout: 3000 });
      if (response.status === 200) {
        console.log(`✅ Microcks is ready (attempt ${i})`);
        return;
      }
    } catch {
      console.log(`⏳ Waiting for Microcks... (attempt ${i}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(
    `Microcks did not become ready after ${maxRetries} attempts. ` +
      `Make sure it is running at ${MICROCKS_BASE_URL}.\n` +
      `Start it with: docker compose -f docker-compose.test.yml up -d`
  );
}

// ─── Dynamically import azure-client after env vars are set ──────────────────

let getPRInfo, getLastIterationId, getPRChanges, getFileContent, postComment, postGeneralComment;

beforeAll(async () => {
  await waitForMicrocks();

  // Dynamic import so env vars are already set when the module initialises
  const client = await import("../../src/azure-client.js");
  getPRInfo = client.getPRInfo;
  getLastIterationId = client.getLastIterationId;
  getPRChanges = client.getPRChanges;
  getFileContent = client.getFileContent;
  postComment = client.postComment;
  postGeneralComment = client.postGeneralComment;
}, 60_000);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Azure DevOps Client — integration tests (Microcks)", () => {
  describe("getPRInfo()", () => {
    it("returns PR title and commit IDs", async () => {
      const prInfo = await getPRInfo(BASE_URL);

      expect(prInfo.title).toBe("feat: add new feature");
      expect(prInfo.sourceCommitId).toBe("abc123def456abc123def456abc123def456abc123");
      expect(prInfo.targetCommitId).toBe("789xyz012789xyz012789xyz012789xyz012789xyz");
    });
  });

  describe("getLastIterationId()", () => {
    it("returns the latest iteration id", async () => {
      const iterationId = await getLastIterationId(BASE_URL);

      expect(iterationId).toBe(1);
    });
  });

  describe("getPRChanges()", () => {
    it("returns the list of changed files", async () => {
      const changes = await getPRChanges(1, BASE_URL);

      expect(Array.isArray(changes)).toBe(true);
      expect(changes).toHaveLength(2);
      expect(changes[0].item.path).toBe("/src/app.js");
      expect(changes[1].item.path).toBe("/src/Service.cs");
    });
  });

  describe("getFileContent()", () => {
    it("returns JS file content", async () => {
      const content = await getFileContent(
        "/src/app.js",
        "abc123def456abc123def456abc123def456abc123",
        BASE_URL
      );

      expect(content).toBeTruthy();
      const parsed = JSON.parse(content);
      expect(parsed.path).toBe("/src/app.js");
      expect(parsed.content).toContain("Hello, World!");
    });

    it("returns C# file content", async () => {
      const content = await getFileContent(
        "/src/Service.cs",
        "abc123def456abc123def456abc123def456abc123",
        BASE_URL
      );

      expect(content).toBeTruthy();
      const parsed = JSON.parse(content);
      expect(parsed.path).toBe("/src/Service.cs");
      expect(parsed.content).toContain("namespace MyApp");
    });
  });

  describe("postComment()", () => {
    it("posts a file comment and returns 201", async () => {
      const response = await postComment(
        "/src/app.js",
        10,
        "## 🤖 Code Review IA\n\nThis variable name is not descriptive.",
        BASE_URL
      );

      expect(response.status).toBe(201);
      expect(response.data.id).toBeDefined();
    });
  });

  describe("postGeneralComment()", () => {
    it("posts a general comment and returns 201", async () => {
      const response = await postGeneralComment(
        "## 🤖 Résumé de la Code Review IA\n\n| Statut | Fichiers |\n|--------|----------|\n| ✅ OK | 2 |",
        BASE_URL
      );

      expect(response.status).toBe(201);
      expect(response.data.id).toBeDefined();
    });
  });
});
