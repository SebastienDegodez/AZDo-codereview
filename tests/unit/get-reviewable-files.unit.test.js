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
  fileContents = {},
} = {}) {
  return {
    getPRInfo: async () => prInfo,
    getLastIterationId: async () => iterationId,
    getPRChanges: async () => changes,
    getFileContent: async (filePath) => fileContents[filePath] ?? null,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GetReviewableFiles use case", () => {
  it("returns PR info and reviewable code files with their content", async () => {
    const gateway = createFakeGateway({
      changes: [
        new FileChange({ path: "/src/app.js", changeType: 1, objectId: "a1" }),
        new FileChange({ path: "/src/service.cs", changeType: 1, objectId: "a2" }),
      ],
      fileContents: {
        "src/app.js": 'console.log("hello");',
        "src/service.cs": "public class Service {}",
      },
    });

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    const { pullRequest, files } = await useCase.execute();

    expect(pullRequest.title).toBe("feat: add review automation");
    expect(pullRequest.isValid()).toBe(true);
    expect(files).toHaveLength(2);
    expect(files[0].change.path).toBe("/src/app.js");
    expect(files[0].content).toBe('console.log("hello");');
    expect(files[1].change.path).toBe("/src/service.cs");
    expect(files[1].content).toBe("public class Service {}");
  });

  it("filters out deleted files", async () => {
    const gateway = createFakeGateway({
      changes: [
        new FileChange({ path: "/src/app.js", changeType: 1, objectId: "a1" }),
        new FileChange({ path: "/src/old.js", changeType: 32, objectId: "a2" }),
      ],
      fileContents: {
        "src/app.js": "const x = 1;",
      },
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
      fileContents: {
        "src/app.js": "const x = 1;",
      },
    });

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    const { files } = await useCase.execute();

    expect(files).toHaveLength(1);
    expect(files[0].change.path).toBe("/src/app.js");
  });

  it("skips files whose content is inaccessible (null)", async () => {
    const gateway = createFakeGateway({
      changes: [
        new FileChange({ path: "/src/app.js", changeType: 1, objectId: "a1" }),
        new FileChange({ path: "/src/secret.js", changeType: 1, objectId: "a2" }),
      ],
      fileContents: {
        "src/app.js": "const x = 1;",
        // src/secret.js not in fileContents → returns null
      },
    });

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    const { files } = await useCase.execute();

    expect(files).toHaveLength(1);
    expect(files[0].change.path).toBe("/src/app.js");
  });

  it("returns an empty file list when no changes exist", async () => {
    const gateway = createFakeGateway({ changes: [] });

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    const { pullRequest, files } = await useCase.execute();

    expect(pullRequest.title).toBe("feat: add review automation");
    expect(files).toHaveLength(0);
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
      getFileContent: async () => "content",
    };

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    await useCase.execute();

    expect(capturedIterationId).toBe(3);
  });

  it("uses the source commit ID to fetch file content", async () => {
    let capturedCommitId;
    const gateway = {
      getPRInfo: async () =>
        new PullRequest({
          pullRequestId: 42,
          title: "test",
          sourceCommitId: "source-sha-999",
          targetCommitId: "target-sha",
        }),
      getLastIterationId: async () => 1,
      getPRChanges: async () => [
        new FileChange({ path: "/src/app.py", changeType: 1, objectId: "x" }),
      ],
      getFileContent: async (_path, commitId) => {
        capturedCommitId = commitId;
        return "print('hello')";
      },
    };

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    await useCase.execute();

    expect(capturedCommitId).toBe("source-sha-999");
  });

  it("handles multiple code file extensions correctly", async () => {
    const codeFiles = [
      "/src/app.ts", "/src/component.tsx", "/src/service.java",
      "/scripts/deploy.sh", "/db/init.sql", "/config/app.yaml",
    ];
    const gateway = createFakeGateway({
      changes: codeFiles.map((p) => new FileChange({ path: p, changeType: 1 })),
      fileContents: Object.fromEntries(
        codeFiles.map((p) => [p.replace(/^\//, ""), "content"])
      ),
    });

    const useCase = createGetReviewableFiles({ pullRequestGateway: gateway });
    const { files } = await useCase.execute();

    expect(files).toHaveLength(codeFiles.length);
  });
});
