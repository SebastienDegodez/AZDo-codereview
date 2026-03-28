/**
 * Outside-in unit tests for the ReviewPullRequest application use case.
 *
 * Tests the Application layer with:
 * - Real domain objects (ReviewComment, PullRequest, FileChange) — never mocked
 * - Mocked infrastructure boundaries (reviewClient, pullRequestGateway, skillReader, instructionReader)
 *
 * Following outside-in TDD: test observable behavior from the use case entry point.
 */

import { describe, it, expect } from "@jest/globals";
import { createReviewPullRequest } from "../../src/application/review-pull-request.js";
import { createGetReviewableFiles } from "../../src/application/get-reviewable-files.js";
import { PullRequest } from "../../src/domain/PullRequest.js";
import { FileChange } from "../../src/domain/FileChange.js";
import { ReviewComment } from "../../src/domain/ReviewComment.js";

// ─── Fake infrastructure ports ────────────────────────────────────────────────

function createFakeGateway({
  prInfo = new PullRequest({
    pullRequestId: 42,
    title: "feat: add feature",
    sourceCommitId: "abc",
    targetCommitId: "def",
  }),
  iterationId = 1,
  changes = [],
  fileContents = {},
} = {}) {
  const postedComments = [];
  const postedGeneralComments = [];

  return {
    getPRInfo: async () => prInfo,
    getLastIterationId: async () => iterationId,
    getPRChanges: async () => changes,
    getFileContent: async (filePath) => fileContents[filePath] ?? null,
    postComment: async (filePath, line, comment) => {
      postedComments.push({ filePath, line, comment });
      return { id: postedComments.length, status: "active" };
    },
    postGeneralComment: async (comment) => {
      postedGeneralComments.push(comment);
      return { id: 1, status: "active" };
    },
    postedComments,
    postedGeneralComments,
  };
}

function createFakeReviewClient(commentsPerFile = []) {
  let callIndex = 0;
  return {
    reviewFile: async () => {
      const comments = commentsPerFile[callIndex] ?? [];
      callIndex++;
      return comments;
    },
  };
}

function createFakeSkillReader(skills = []) {
  return {
    list: () => skills,
    load: (name) => (skills.includes(name) ? `Content of ${name}` : null),
  };
}

function createFakeInstructionReader() {
  return {
    read: () => ({}),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReviewPullRequest use case", () => {
  it("reviews files and posts comments via the gateway", async () => {
    const gateway = createFakeGateway({
      changes: [
        new FileChange({ path: "/src/app.js", changeType: 1 }),
      ],
      fileContents: { "src/app.js": "const x = 1;" },
    });
    const reviewClient = createFakeReviewClient([
      [
        new ReviewComment({ filePath: "src/app.js", line: 1, severity: "mineur", comment: "Use const instead of let" }),
      ],
    ]);

    const getReviewableFiles = createGetReviewableFiles({ pullRequestGateway: gateway });
    const useCase = createReviewPullRequest({
      getReviewableFiles,
      reviewClient,
      pullRequestGateway: gateway,
      skillReader: createFakeSkillReader(),
      instructionReader: createFakeInstructionReader(),
    });

    const result = await useCase.execute();

    expect(result.filesReviewed).toBe(1);
    expect(result.commentsPosted).toBe(1);
    expect(gateway.postedComments).toHaveLength(1);
    expect(gateway.postedComments[0].filePath).toBe("src/app.js");
    expect(gateway.postedGeneralComments).toHaveLength(1);
  });

  it("returns zero counts when no files to review", async () => {
    const gateway = createFakeGateway({ changes: [] });
    const reviewClient = createFakeReviewClient();

    const getReviewableFiles = createGetReviewableFiles({ pullRequestGateway: gateway });
    const useCase = createReviewPullRequest({
      getReviewableFiles,
      reviewClient,
      pullRequestGateway: gateway,
      skillReader: createFakeSkillReader(),
      instructionReader: createFakeInstructionReader(),
    });

    const result = await useCase.execute();

    expect(result.filesReviewed).toBe(0);
    expect(result.commentsPosted).toBe(0);
    expect(gateway.postedGeneralComments).toHaveLength(0);
  });

  it("posts multiple comments across multiple files", async () => {
    const gateway = createFakeGateway({
      changes: [
        new FileChange({ path: "/src/a.js", changeType: 1 }),
        new FileChange({ path: "/src/b.ts", changeType: 1 }),
      ],
      fileContents: { "src/a.js": "code a", "src/b.ts": "code b" },
    });
    const reviewClient = createFakeReviewClient([
      [
        new ReviewComment({ filePath: "src/a.js", line: 1, severity: "critique", comment: "Bug" }),
        new ReviewComment({ filePath: "src/a.js", line: 5, severity: "suggestion", comment: "Simplify" }),
      ],
      [
        new ReviewComment({ filePath: "src/b.ts", line: 10, severity: "majeur", comment: "Missing null check" }),
      ],
    ]);

    const getReviewableFiles = createGetReviewableFiles({ pullRequestGateway: gateway });
    const useCase = createReviewPullRequest({
      getReviewableFiles,
      reviewClient,
      pullRequestGateway: gateway,
      skillReader: createFakeSkillReader(),
      instructionReader: createFakeInstructionReader(),
    });

    const result = await useCase.execute();

    expect(result.filesReviewed).toBe(2);
    expect(result.commentsPosted).toBe(3);
    expect(gateway.postedComments).toHaveLength(3);
  });

  it("formats review comments with severity emoji before posting", async () => {
    const gateway = createFakeGateway({
      changes: [new FileChange({ path: "/src/app.js", changeType: 1 })],
      fileContents: { "src/app.js": "code" },
    });
    const reviewClient = createFakeReviewClient([
      [new ReviewComment({ filePath: "src/app.js", line: 1, severity: "critique", comment: "Critical issue" })],
    ]);

    const getReviewableFiles = createGetReviewableFiles({ pullRequestGateway: gateway });
    const useCase = createReviewPullRequest({
      getReviewableFiles,
      reviewClient,
      pullRequestGateway: gateway,
      skillReader: createFakeSkillReader(),
      instructionReader: createFakeInstructionReader(),
    });

    await useCase.execute();

    expect(gateway.postedComments[0].comment).toContain("🔴");
    expect(gateway.postedComments[0].comment).toContain("[CRITIQUE]");
  });

  it("posts a summary with file and comment counts", async () => {
    const gateway = createFakeGateway({
      changes: [new FileChange({ path: "/src/app.js", changeType: 1 })],
      fileContents: { "src/app.js": "code" },
    });
    const reviewClient = createFakeReviewClient([
      [new ReviewComment({ filePath: "src/app.js", line: 1, severity: "mineur", comment: "Style" })],
    ]);

    const getReviewableFiles = createGetReviewableFiles({ pullRequestGateway: gateway });
    const useCase = createReviewPullRequest({
      getReviewableFiles,
      reviewClient,
      pullRequestGateway: gateway,
      skillReader: createFakeSkillReader(),
      instructionReader: createFakeInstructionReader(),
    });

    await useCase.execute();

    const summary = gateway.postedGeneralComments[0];
    expect(summary).toContain("1");
    expect(summary).toContain("Résumé final");
  });
});
