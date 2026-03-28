/**
 * Unit tests for Azure DevOps client functions.
 * Uses axios-mock-adapter to mock HTTP calls — no external services required.
 *
 * Run: npm run test:unit
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";

// ─── Setup ────────────────────────────────────────────────────────────────────

// Set env vars before importing the module
process.env.AZURE_DEVOPS_ORG = "TestOrg";
process.env.AZURE_DEVOPS_PROJECT = "TestProject";
process.env.AZURE_DEVOPS_REPO = "TestRepo";
process.env.AZURE_DEVOPS_PR_ID = "99";
process.env.AZURE_DEVOPS_PAT = "unit-test-pat";

const BASE_URL = "http://mock-azure/TestOrg/TestProject/_apis/git/repositories/TestRepo";

const {
  getPRInfo,
  getLastIterationId,
  getPRChanges,
  getFileContent,
  postComment,
  postGeneralComment,
} = await import("../../src/azure-client.js");

let mock;

beforeEach(() => {
  mock = new MockAdapter(axios);
});

afterEach(() => {
  mock.restore();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("getPRInfo()", () => {
  it("returns title and commit IDs from the PR response", async () => {
    mock.onGet(new RegExp("/pullRequests/99")).reply(200, {
      pullRequestId: 99,
      title: "My PR title",
      description: "My PR description",
      lastMergeSourceCommit: { commitId: "src123" },
      lastMergeTargetCommit: { commitId: "tgt456" },
    });

    const prInfo = await getPRInfo(BASE_URL);

    expect(prInfo.title).toBe("My PR title");
    expect(prInfo.sourceCommitId).toBe("src123");
    expect(prInfo.targetCommitId).toBe("tgt456");
  });
});

describe("getLastIterationId()", () => {
  it("returns the id of the last iteration", async () => {
    mock.onGet(new RegExp("/iterations")).reply(200, {
      value: [{ id: 1 }, { id: 2 }, { id: 3 }],
      count: 3,
    });

    const iterationId = await getLastIterationId(BASE_URL);

    expect(iterationId).toBe(3);
  });
});

describe("getPRChanges()", () => {
  it("returns the changeEntries array", async () => {
    mock.onGet(new RegExp("/iterations/1/changes")).reply(200, {
      changeEntries: [
        { changeId: 1, changeType: 1, item: { path: "/src/index.js" } },
        { changeId: 2, changeType: 1, item: { path: "/src/utils.ts" } },
      ],
    });

    const changes = await getPRChanges(1, BASE_URL);

    expect(changes).toHaveLength(2);
    expect(changes[0].item.path).toBe("/src/index.js");
  });

  it("returns empty array when changeEntries is missing", async () => {
    mock.onGet(new RegExp("/iterations/1/changes")).reply(200, {});

    const changes = await getPRChanges(1, BASE_URL);

    expect(changes).toEqual([]);
  });
});

describe("getFileContent()", () => {
  it("returns JSON-stringified content when response is an object", async () => {
    mock.onGet(new RegExp("/items")).reply(200, {
      content: "const x = 1;",
      path: "/src/index.js",
    });

    const content = await getFileContent("/src/index.js", "src123", BASE_URL);

    expect(content).toContain("const x = 1;");
  });

  it("returns the string directly when response is a string", async () => {
    mock.onGet(new RegExp("/items")).reply(200, "raw file content");

    const content = await getFileContent("/src/index.js", "src123", BASE_URL);

    expect(content).toBe("raw file content");
  });

  it("returns null on HTTP error", async () => {
    mock.onGet(new RegExp("/items")).reply(404);

    const content = await getFileContent("/src/missing.js", "src123", BASE_URL);

    expect(content).toBeNull();
  });
});

describe("postComment()", () => {
  it("posts a thread and returns the response", async () => {
    mock.onPost(new RegExp("/threads")).reply(201, { id: 5, status: 1 });

    const response = await postComment("/src/index.js", 10, "This is a problem.", BASE_URL);

    expect(response.status).toBe(201);
    expect(response.data.id).toBe(5);
  });
});

describe("postGeneralComment()", () => {
  it("posts a general thread and returns the response", async () => {
    mock.onPost(new RegExp("/threads")).reply(201, { id: 6, status: 1 });

    const response = await postGeneralComment("General summary comment.", BASE_URL);

    expect(response.status).toBe(201);
    expect(response.data.id).toBe(6);
  });
});
