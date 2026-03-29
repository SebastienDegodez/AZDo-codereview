/**
 * Outside-in unit tests for the GetReviewableFiles application use case.
 *
 * Tests the Application layer with:
 * - Real domain objects (PullRequest, FileChange) — never mocked
 * - Mocked infrastructure boundaries (pullRequestGateway)
 *
 * Following outside-in TDD: test observable behavior from the use case entry point,
 * let domain design emerge from test requirements.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { createGetReviewableFiles } from "../../src/application/get-reviewable-files.js";
import { PullRequest } from "../../src/domain/PullRequest.js";
import { FileChange } from "../../src/domain/FileChange.js";

// ─── Fake gateway (mocked infrastructure boundary) ────────────────────────────

function createFakeGateway({
  prInfo = new PullRequest({
    pullRequestId: 42,
    title: "feat: add review automation",
    description: "Automated code review",
    sourceCommitId: "abc123",
    targetCommitId: "def456",
  }),
  iterationId = 1,
  changes = [],
  commitDiffEntries = [],
} = {}) {
  return {
    getPRInfo: async () => prInfo,
    getLastIterationId: async () => iterationId,
    getPRChanges: async () => changes,
    getCommitDiff: async () => commitDiffEntries,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GetReviewableFiles use case", () => {
  it("returns PR info and reviewable code files with their diff", async () => {
    const gateway = createFakeGateway({
      changes: [
        new FileChange({ path: "/src/app.js", changeType: 1, objectId: "a1" }),
        new FileChange({ path: "/src/service.cs", changeType: 1, objectId: "a2" }),
      ],
      commitDiffEntries: [
        { path: "/src/app.js", diff: '{"changeType":1,"item":{"path":"/src/app.js"}}' },
        { path: "/src/service.cs", diff: '{"changeType":2,"item":{"path":"/src/service.cs"}}' },
      ],
    });

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    const { pullRequest, files } = await useCase.execute();

    expect(pullRequest.title).toBe("feat: add review automation");
    expect(pullRequest.isValid()).toBe(true);
    expect(files).toHaveLength(2);
    expect(files[0].change.path).toBe("/src/app.js");
    expect(files[0].diff).toContain("/src/app.js");
    expect(files[1].change.path).toBe("/src/service.cs");
    expect(files[1].diff).toContain("/src/service.cs");
  });

  it("filters out deleted files", async () => {
    const gateway = createFakeGateway({
      changes: [
        new FileChange({ path: "/src/app.js", changeType: 1, objectId: "a1" }),
        new FileChange({ path: "/src/old.js", changeType: 32, objectId: "a2" }),
      ],
      commitDiffEntries: [
        { path: "/src/app.js", diff: '{"changeType":1}' },
      ],
    });

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    const { files } = await useCase.execute();

    expect(files).toHaveLength(1);
    expect(files[0].change.path).toBe("/src/app.js");
  });

  it("filters out non-code files (e.g. images, binaries)", async () => {
    const gateway = createFakeGateway({
      changes: [
        new FileChange({ path: "/src/app.js", changeType: 1, objectId: "a1" }),
        new FileChange({ path: "/docs/logo.png", changeType: 1, objectId: "a2" }),
        new FileChange({ path: "/README.md", changeType: 1, objectId: "a3" }),
      ],
      commitDiffEntries: [
        { path: "/src/app.js", diff: '{"changeType":1}' },
        { path: "/docs/logo.png", diff: '{"changeType":1}' },
        { path: "/README.md", diff: '{"changeType":1}' },
      ],
    });

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    const { files } = await useCase.execute();

    expect(files).toHaveLength(1);
    expect(files[0].change.path).toBe("/src/app.js");
  });

  it("skips files not found in the diff result (puts them in skippedFiles)", async () => {
    const gateway = createFakeGateway({
      changes: [
        new FileChange({ path: "/src/app.js", changeType: 1, objectId: "a1" }),
        new FileChange({ path: "/src/secret.js", changeType: 1, objectId: "a2" }),
      ],
      commitDiffEntries: [
        { path: "/src/app.js", diff: '{"changeType":1}' },
        // /src/secret.js not in diff entries
      ],
    });

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    const { files, skippedFiles } = await useCase.execute();

    expect(files).toHaveLength(1);
    expect(files[0].change.path).toBe("/src/app.js");
    expect(skippedFiles).toHaveLength(1);
    expect(skippedFiles[0].path).toBe("/src/secret.js");
    expect(skippedFiles[0].reason).toBe("diff_not_found");
  });

  it("returns an empty file list when no changes exist", async () => {
    const gateway = createFakeGateway({ changes: [] });

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    const { pullRequest, files, skippedFiles } = await useCase.execute();

    expect(pullRequest.title).toBe("feat: add review automation");
    expect(files).toHaveLength(0);
    expect(skippedFiles).toHaveLength(0);
  });

  it("uses the latest iteration to fetch changes", async () => {
    let capturedIterationId;
    const gateway = {
      getPRInfo: async () =>
        new PullRequest({
          pullRequestId: 42,
          title: "test",
          sourceCommitId: "abc",
          targetCommitId: "def",
        }),
      getLastIterationId: async () => 3,
      getPRChanges: async (iterationId) => {
        capturedIterationId = iterationId;
        return [
          new FileChange({ path: "/src/index.ts", changeType: 1, objectId: "x" }),
        ];
      },
      getCommitDiff: async () => [{ path: "/src/index.ts", diff: '{"changeType":1}' }],
    };

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    await useCase.execute();

    expect(capturedIterationId).toBe(3);
  });

  it("calls getCommitDiff with targetCommitId as base and sourceCommitId as target", async () => {
    let capturedBase;
    let capturedTarget;
    const gateway = {
      getPRInfo: async () =>
        new PullRequest({
          pullRequestId: 42,
          title: "test",
          sourceCommitId: "source-sha-999",
          targetCommitId: "target-sha-111",
        }),
      getLastIterationId: async () => 1,
      getPRChanges: async () => [
        new FileChange({ path: "/src/app.py", changeType: 1, objectId: "x" }),
      ],
      getCommitDiff: async (base, target) => {
        capturedBase = base;
        capturedTarget = target;
        return [{ path: "/src/app.py", diff: '{"changeType":1}' }];
      },
    };

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    await useCase.execute();

    expect(capturedBase).toBe("target-sha-111");
    expect(capturedTarget).toBe("source-sha-999");
  });

  it("does NOT call getFileContent in the diff-first flow", async () => {
    let getFileContentCalled = false;
    const gateway = {
      getPRInfo: async () =>
        new PullRequest({
          pullRequestId: 42,
          title: "test",
          sourceCommitId: "src",
          targetCommitId: "tgt",
        }),
      getLastIterationId: async () => 1,
      getPRChanges: async () => [
        new FileChange({ path: "/src/app.js", changeType: 1, objectId: "x" }),
      ],
      getCommitDiff: async () => [{ path: "/src/app.js", diff: '{"changeType":1}' }],
      getFileContent: async () => {
        getFileContentCalled = true;
        return "some content";
      },
    };

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    await useCase.execute();

    expect(getFileContentCalled).toBe(false);
  });

  it("handles multiple code file extensions correctly", async () => {
    const codeFiles = [
      "/src/app.ts", "/src/component.tsx", "/src/service.java",
      "/scripts/deploy.sh", "/db/init.sql", "/config/app.yaml",
    ];
    const gateway = createFakeGateway({
      changes: codeFiles.map((p) => new FileChange({ path: p, changeType: 1 })),
      commitDiffEntries: codeFiles.map((p) => ({ path: p, diff: '{"changeType":1}' })),
    });

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    const { files } = await useCase.execute();

    expect(files).toHaveLength(codeFiles.length);
  });
});
