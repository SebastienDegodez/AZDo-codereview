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
  commitDiffEntries = [],
  fileContents = {},
} = {}) {
  const postedComments = [];
  const postedGeneralComments = [];

  return {
    getPRInfo: async () => prInfo,
    getLastIterationId: async () => iterationId,
    getPRChanges: async () => changes,
    getCommitDiff: async () => commitDiffEntries,
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
      commitDiffEntries: [{ path: "/src/app.js", diff: "const x = 1;" }],
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
      commitDiffEntries: [
        { path: "/src/a.js", diff: "code a" },
        { path: "/src/b.ts", diff: "code b" },
      ],
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
      commitDiffEntries: [{ path: "/src/app.js", diff: "code" }],
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
      commitDiffEntries: [{ path: "/src/app.js", diff: "code" }],
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

  it("loadFileContent passes the file path with leading slash to the gateway", async () => {
    const capturedPaths = [];
    const gateway = createFakeGateway({
      changes: [new FileChange({ path: "/src/app.js", changeType: 1 })],
      commitDiffEntries: [{ path: "/src/app.js", diff: "code" }],
      fileContents: { "/src/app.js": "const x = 1;" },
    });

    const originalGetFileContent = gateway.getFileContent;
    gateway.getFileContent = async (filePath, commitId) => {
      capturedPaths.push(filePath);
      return originalGetFileContent(filePath, commitId);
    };

    const reviewClient = {
      reviewFile: async ({ loadFileContent }) => {
        await loadFileContent("/src/app.js");
        return [];
      },
    };

    const getReviewableFiles = createGetReviewableFiles({ pullRequestGateway: gateway });
    const useCase = createReviewPullRequest({
      getReviewableFiles,
      reviewClient,
      pullRequestGateway: gateway,
      skillReader: createFakeSkillReader(),
      instructionReader: createFakeInstructionReader(),
    });

    await useCase.execute();

    expect(capturedPaths[0]).toBe("/src/app.js");
  });

  it("includes skippedFiles in the final summary comment", async () => {
    const gateway = createFakeGateway({
      changes: [
        new FileChange({ path: "/src/app.js", changeType: 1 }),
        new FileChange({ path: "/src/legacy.js", changeType: 1 }),
      ],
      commitDiffEntries: [
        // /src/legacy.js has no diff → goes to skippedFiles
        { path: "/src/app.js", diff: "code" },
      ],
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

    // One critique comment is posted on the skipped file, plus one review comment on app.js
    expect(gateway.postedComments).toHaveLength(2);
    const summary = gateway.postedGeneralComments[0];
    expect(summary).toContain("Fichiers non analysés");
    expect(summary).toContain("/src/legacy.js");
    expect(summary).toContain("diff_not_found");
  });

  it("posts a critique comment on skipped files (no diff)", async () => {
    const gateway = createFakeGateway({
      changes: [
        new FileChange({ path: "/src/app.js", changeType: 1 }),
        new FileChange({ path: "/src/legacy.js", changeType: 1 }),
      ],
      commitDiffEntries: [
        { path: "/src/app.js", diff: "code" },
      ],
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

    const critiqueComment = gateway.postedComments.find((comment) => comment.filePath === "/src/legacy.js");
    expect(critiqueComment).toBeDefined();
    expect(critiqueComment.line).toBe(1);
    expect(critiqueComment.comment).toContain("🔴 [CRITIQUE]");
    expect(critiqueComment.comment).toContain("Le contenu du fichier n'est pas inclus dans la Pull Request");
  });

  it("posts critique comments on all skipped files", async () => {
    const gateway = createFakeGateway({
      changes: [
        new FileChange({ path: "/src/a.js", changeType: 1 }),
        new FileChange({ path: "/src/b.js", changeType: 1 }),
        new FileChange({ path: "/src/c.js", changeType: 1 }),
      ],
      commitDiffEntries: [
        { path: "/src/c.js", diff: "code" },
      ],
    });
    const reviewClient = createFakeReviewClient([
      [new ReviewComment({ filePath: "src/c.js", line: 1, severity: "mineur", comment: "Style" })],
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

    const critiqueComments = gateway.postedComments.filter((comment) => comment.comment.includes("🔴 [CRITIQUE]"));
    expect(critiqueComments).toHaveLength(2);
  });

  it("posts skipped file comments even when all files are skipped", async () => {
    const gateway = createFakeGateway({
      changes: [
        new FileChange({ path: "/src/legacy.js", changeType: 1 }),
      ],
      commitDiffEntries: [],
    });
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

    expect(gateway.postedComments).toHaveLength(1);
    expect(gateway.postedComments[0].filePath).toBe("/src/legacy.js");
    expect(gateway.postedComments[0].comment).toContain("🔴 [CRITIQUE]");
    expect(result).toEqual({ filesReviewed: 0, commentsPosted: 0 });
  });
});
