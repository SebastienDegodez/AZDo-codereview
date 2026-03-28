/**
 * Unit tests for the Azure DevOps client module.
 * Uses axios-mock-adapter to mock HTTP calls — no running server required.
 *
 * The client is created via the createAzureClient factory, and all responses
 * are mapped to domain entities (PullRequest, FileChange, ReviewThread).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { createAzureClient } from "../../src/azure-client.js";
import { PullRequest } from "../../src/domain/PullRequest.js";
import { FileChange } from "../../src/domain/FileChange.js";
import { ReviewThread } from "../../src/domain/ReviewThread.js";

// ─── Setup ────────────────────────────────────────────────────────────────────

const ORG = "TestOrg";
const PROJECT = "TestProject";
const REPO = "TestRepo";
const PR_ID = "99";
const BASE_URL = `https://dev.azure.com/${ORG}/${PROJECT}/_apis/git/repositories/${REPO}`;

let mock;
let client;

beforeEach(() => {
  mock = new MockAdapter(axios);
  client = createAzureClient({
    baseUrl: "https://dev.azure.com",
    pat: "unit-test-pat",
    org: ORG,
    project: PROJECT,
    repo: REPO,
    prId: PR_ID,
  });
});

afterEach(() => {
  mock.restore();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("getPRInfo()", () => {
  it("returns a PullRequest domain entity with title and commit IDs", async () => {
    mock
      .onGet(`${BASE_URL}/pullRequests/${PR_ID}`)
      .reply(200, {
        pullRequestId: 99,
        title: "My PR title",
        description: "Some description",
        lastMergeSourceCommit: { commitId: "source123" },
        lastMergeTargetCommit: { commitId: "target456" },
      });

    const pr = await client.getPRInfo();

    expect(pr).toBeInstanceOf(PullRequest);
    expect(pr.title).toBe("My PR title");
    expect(pr.sourceCommitId).toBe("source123");
    expect(pr.targetCommitId).toBe("target456");
    expect(pr.description).toBe("Some description");
    expect(pr.isValid()).toBe(true);
  });

  it("handles missing commit fields gracefully (isValid returns false)", async () => {
    mock
      .onGet(`${BASE_URL}/pullRequests/${PR_ID}`)
      .reply(200, { pullRequestId: 99, title: "Draft PR" });

    const pr = await client.getPRInfo();

    expect(pr).toBeInstanceOf(PullRequest);
    expect(pr.title).toBe("Draft PR");
    expect(pr.sourceCommitId).toBeUndefined();
    expect(pr.isValid()).toBe(false);
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

    const id = await client.getLastIterationId();

    expect(id).toBe(2);
  });
});

describe("getPRChanges(iterationId)", () => {
  it("returns FileChange domain entities", async () => {
    mock
      .onGet(`${BASE_URL}/pullRequests/${PR_ID}/iterations/1/changes`)
      .reply(200, {
        changeEntries: [
          { changeId: 1, changeType: 1, item: { path: "/src/index.js", objectId: "abc" } },
        ],
      });

    const changes = await client.getPRChanges(1);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeInstanceOf(FileChange);
    expect(changes[0].path).toBe("/src/index.js");
    expect(changes[0].changeType).toBe(1);
    expect(changes[0].isDeleted()).toBe(false);
  });

  it("returns an empty array when changeEntries is absent", async () => {
    mock
      .onGet(`${BASE_URL}/pullRequests/${PR_ID}/iterations/1/changes`)
      .reply(200, {});

    const changes = await client.getPRChanges(1);

    expect(changes).toEqual([]);
  });

  it("marks deleted files correctly (changeType 32)", async () => {
    mock
      .onGet(`${BASE_URL}/pullRequests/${PR_ID}/iterations/1/changes`)
      .reply(200, {
        changeEntries: [
          { changeId: 1, changeType: 32, item: { path: "/src/old.js" } },
        ],
      });

    const changes = await client.getPRChanges(1);

    expect(changes[0].isDeleted()).toBe(true);
  });
});

describe("getFileContent(filePath, commitId)", () => {
  it("returns stringified JSON when API returns an object", async () => {
    mock
      .onGet(`${BASE_URL}/items`)
      .reply(200, { content: "const x = 1;\n", path: "/src/index.js" });

    const content = await client.getFileContent("/src/index.js", "abc123");

    expect(content).toContain("const x = 1;");
  });

  it("returns null when the API call fails", async () => {
    mock.onGet(`${BASE_URL}/items`).reply(404);

    const content = await client.getFileContent("/missing.js", "abc123");

    expect(content).toBeNull();
  });
});

describe("postComment(filePath, line, comment)", () => {
  it("returns a ReviewThread domain entity after posting a file comment", async () => {
    mock
      .onPost(`${BASE_URL}/pullRequests/${PR_ID}/threads`)
      .reply(200, { id: 42, status: "active" });

    const thread = await client.postComment("/src/index.js", 5, "Fix this");

    expect(thread).toBeInstanceOf(ReviewThread);
    expect(thread.id).toBe(42);
    expect(thread.status).toBe("active");
    expect(thread.isActive()).toBe(true);
    expect(thread.isValid()).toBe(true);
  });
});

describe("postGeneralComment(comment)", () => {
  it("returns a ReviewThread domain entity after posting a general comment", async () => {
    mock
      .onPost(`${BASE_URL}/pullRequests/${PR_ID}/threads`)
      .reply(200, { id: 99, status: "active" });

    const thread = await client.postGeneralComment("Summary comment");

    expect(thread).toBeInstanceOf(ReviewThread);
    expect(thread.id).toBe(99);
    expect(thread.isActive()).toBe(true);
  });
});
