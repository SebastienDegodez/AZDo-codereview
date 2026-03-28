/**
 * Unit tests for the Azure DevOps client module.
 * Uses axios-mock-adapter to mock HTTP calls — no running server required.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";

// ─── Setup ────────────────────────────────────────────────────────────────────

const ORG = "TestOrg";
const PROJECT = "TestProject";
const REPO = "TestRepo";
const PR_ID = "99";
const BASE_URL = `https://dev.azure.com/${ORG}/${PROJECT}/_apis/git/repositories/${REPO}`;

// Set env vars before importing the module
process.env.AZURE_DEVOPS_ORG = ORG;
process.env.AZURE_DEVOPS_PROJECT = PROJECT;
process.env.AZURE_DEVOPS_REPO = REPO;
process.env.AZURE_DEVOPS_PR_ID = PR_ID;
process.env.AZURE_DEVOPS_PAT = "unit-test-pat";
// Use a controlled base URL (not Microcks)
delete process.env.AZURE_DEVOPS_BASE_URL;

const { getPRInfo, getLastIterationId, getPRChanges, getFileContent, postComment, postGeneralComment } =
  await import("../../src/azure-client.js");

let mock;

beforeEach(() => {
  mock = new MockAdapter(axios);
});

afterEach(() => {
  mock.restore();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("getPRInfo()", () => {
  it("returns title and commit IDs from the API response", async () => {
    mock
      .onGet(`${BASE_URL}/pullRequests/${PR_ID}`)
      .reply(200, {
        pullRequestId: 99,
        title: "My PR title",
        description: "Some description",
        lastMergeSourceCommit: { commitId: "source123" },
        lastMergeTargetCommit: { commitId: "target456" },
      });

    const info = await getPRInfo(BASE_URL);

    expect(info.title).toBe("My PR title");
    expect(info.sourceCommitId).toBe("source123");
    expect(info.targetCommitId).toBe("target456");
    expect(info.description).toBe("Some description");
  });

  it("handles missing commit fields gracefully (returns undefined)", async () => {
    mock
      .onGet(`${BASE_URL}/pullRequests/${PR_ID}`)
      .reply(200, { pullRequestId: 99, title: "Draft PR" });

    const info = await getPRInfo(BASE_URL);

    expect(info.title).toBe("Draft PR");
    expect(info.sourceCommitId).toBeUndefined();
    expect(info.targetCommitId).toBeUndefined();
  });
});

describe("getLastIterationId()", () => {
  it("returns the id of the last iteration", async () => {
    mock
      .onGet(`${BASE_URL}/pullRequests/${PR_ID}/iterations`)
      .reply(200, {
        count: 2,
        value: [{ id: 1 }, { id: 2 }],
      });

    const id = await getLastIterationId(BASE_URL);

    expect(id).toBe(2);
  });
});

describe("getPRChanges(iterationId)", () => {
  it("returns the changeEntries array", async () => {
    mock
      .onGet(`${BASE_URL}/pullRequests/${PR_ID}/iterations/1/changes`)
      .reply(200, {
        changeEntries: [
          { changeId: 1, changeType: 1, item: { path: "/src/index.js" } },
        ],
      });

    const changes = await getPRChanges(1, BASE_URL);

    expect(changes).toHaveLength(1);
    expect(changes[0].item.path).toBe("/src/index.js");
  });

  it("returns an empty array when changeEntries is absent", async () => {
    mock
      .onGet(`${BASE_URL}/pullRequests/${PR_ID}/iterations/1/changes`)
      .reply(200, {});

    const changes = await getPRChanges(1, BASE_URL);

    expect(changes).toEqual([]);
  });
});

describe("getFileContent(filePath, commitId)", () => {
  it("returns stringified JSON when API returns an object", async () => {
    mock
      .onGet(`${BASE_URL}/items`)
      .reply(200, { content: "const x = 1;\n", path: "/src/index.js" });

    const content = await getFileContent("/src/index.js", "abc123", BASE_URL);

    expect(content).toContain("const x = 1;");
  });

  it("returns null when the API call fails", async () => {
    mock.onGet(`${BASE_URL}/items`).reply(404);

    const content = await getFileContent("/missing.js", "abc123", BASE_URL);

    expect(content).toBeNull();
  });
});

describe("postComment(filePath, line, comment)", () => {
  it("posts a thread with threadContext and returns the response", async () => {
    mock
      .onPost(`${BASE_URL}/pullRequests/${PR_ID}/threads`)
      .reply(200, { id: 42, status: 1, comments: [] });

    const response = await postComment("/src/index.js", 5, "Fix this", BASE_URL);

    expect(response.status).toBe(200);
    expect(response.data.id).toBe(42);
  });
});

describe("postGeneralComment(comment)", () => {
  it("posts a general thread without threadContext and returns the response", async () => {
    mock
      .onPost(`${BASE_URL}/pullRequests/${PR_ID}/threads`)
      .reply(200, { id: 99, status: 1, comments: [] });

    const response = await postGeneralComment("Summary comment", BASE_URL);

    expect(response.status).toBe(200);
    expect(response.data.id).toBe(99);
  });
});
