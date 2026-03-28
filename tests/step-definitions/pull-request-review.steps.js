/**
 * BDD step definitions — Pull Request Review feature
 *
 * Uses Microcks Testcontainers to provide a real HTTP mock of the Azure DevOps
 * REST API so that every scenario exercises actual HTTP calls without depending
 * on a live Azure DevOps tenant.
 *
 * Separation of concerns:
 *   - Feature file  → business language (what the system should do)
 *   - Steps         → technical bridge (how we verify it in this environment)
 *   - azure-client  → infrastructure adapter (domain ↔ HTTP)
 *   - domain/*      → business entities (PullRequest, FileChange, ReviewThread)
 */

import {
  BeforeAll,
  AfterAll,
  Before,
  Given,
  When,
  Then,
  setWorldConstructor,
  setDefaultTimeout,
} from "@cucumber/cucumber";
import assert from "assert";
import * as path from "path";
import { fileURLToPath } from "url";
import { MicrocksContainer } from "@microcks/microcks-testcontainers";
import { createAzureClient } from "../../src/azure-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mocksDir = path.resolve(__dirname, "../mocks");

// Allow each step up to 30 s (container start is handled in BeforeAll)
setDefaultTimeout(30_000);

// ─── Shared Microcks container (started once for the whole test run) ──────────

/** @type {import("@microcks/microcks-testcontainers").StartedMicrocksContainer} */
let microcksContainer;

/** @type {ReturnType<typeof createAzureClient>} */
let sharedClient;

BeforeAll({ timeout: 120_000 }, async function () {
  microcksContainer = await new MicrocksContainer()
    .withMainArtifacts([
      path.resolve(mocksDir, "azure-devops-pr-api.openapi.yaml"),
    ])
    .withSecondaryArtifacts([
      path.resolve(mocksDir, "azure-devops-pr-api.apiexamples.yaml"),
      path.resolve(mocksDir, "azure-devops-pr-api.apimetadata.yaml"),
    ])
    .start();

  const mockBaseUrl = microcksContainer.getRestMockEndpoint(
    "Azure DevOps PR API",
    "7.1"
  );

  sharedClient = createAzureClient({
    baseUrl: mockBaseUrl,
    pat: "fake-pat-for-bdd",
    org: "myorg",
    project: "myproject",
    repo: "myrepo",
    prId: "42",
  });
});

AfterAll(async function () {
  await microcksContainer?.stop();
});

// ─── Cucumber World ───────────────────────────────────────────────────────────

/**
 * Each scenario gets a fresh World instance that holds the outcome of
 * the "When" steps so "Then" steps can assert on it.
 */
class PullRequestReviewWorld {
  constructor() {
    /** @type {ReturnType<typeof createAzureClient>} */
    this.client = null;
    /** @type {import("../../src/domain/PullRequest.js").PullRequest | null} */
    this.pullRequest = null;
    /** @type {import("../../src/domain/FileChange.js").FileChange[]} */
    this.changedFiles = [];
    /** @type {number | null} */
    this.iterationId = null;
    /** @type {string | null} */
    this.fileContent = null;
    /** @type {import("../../src/domain/ReviewThread.js").ReviewThread | null} */
    this.reviewThread = null;
  }
}

setWorldConstructor(PullRequestReviewWorld);

// Inject the shared client into each scenario's World
Before(function () {
  this.client = sharedClient;
});

// ─── Step definitions — Given ─────────────────────────────────────────────────

Given(
  "the Azure DevOps mock API is available for pull request {string}",
  function (prId) {
    // The container was started in BeforeAll; we just assert the client is ready.
    assert.ok(
      this.client,
      `Azure DevOps client must be initialised for PR ${prId}`
    );
  }
);

// ─── Step definitions — When ──────────────────────────────────────────────────

When("I request the pull request information", async function () {
  this.pullRequest = await this.client.getPRInfo();
});

When("I request the list of changed files", async function () {
  const iterationId = await this.client.getLastIterationId();
  this.changedFiles = await this.client.getPRChanges(iterationId);
});

When("I request the last iteration id", async function () {
  this.iterationId = await this.client.getLastIterationId();
});

When(
  "I request the content of file {string} at commit {string}",
  async function (filePath, commitId) {
    this.fileContent = await this.client.getFileContent(filePath, commitId);
  }
);

When(
  "I post a review comment on file {string} at line {int} with message {string}",
  async function (filePath, line, message) {
    this.reviewThread = await this.client.postComment(filePath, line, message);
  }
);

When(
  "I post a general comment with message {string}",
  async function (message) {
    this.reviewThread = await this.client.postGeneralComment(message);
  }
);

// ─── Step definitions — Then ──────────────────────────────────────────────────

Then("the pull request title should be {string}", function (expectedTitle) {
  assert.strictEqual(
    this.pullRequest.title,
    expectedTitle,
    `Expected PR title "${expectedTitle}" but got "${this.pullRequest.title}"`
  );
});

Then("the source commit id should be {string}", function (expectedCommitId) {
  assert.strictEqual(
    this.pullRequest.sourceCommitId,
    expectedCommitId,
    `Expected source commit "${expectedCommitId}" but got "${this.pullRequest.sourceCommitId}"`
  );
});

Then("I should receive at least one changed file", function () {
  assert.ok(
    this.changedFiles.length > 0,
    "Expected at least one changed file but received none"
  );
});

Then(
  "the list of changed files should include {string}",
  function (expectedPath) {
    const paths = this.changedFiles.map((f) => f.path);
    assert.ok(
      paths.includes(expectedPath),
      `Expected changed files to include "${expectedPath}" but got: ${paths.join(", ")}`
    );
  }
);

Then("the iteration id should be {int}", function (expectedId) {
  assert.strictEqual(
    this.iterationId,
    expectedId,
    `Expected iteration id ${expectedId} but got ${this.iterationId}`
  );
});

Then("the file content should not be empty", function () {
  assert.ok(
    this.fileContent && this.fileContent.trim().length > 0,
    "Expected non-empty file content but received null or empty string"
  );
});

Then("the review thread should be created successfully", function () {
  assert.ok(
    this.reviewThread && this.reviewThread.isValid(),
    `Expected a valid review thread but got: ${JSON.stringify(this.reviewThread)}`
  );
});

Then("the thread id should be {int}", function (expectedId) {
  assert.strictEqual(
    this.reviewThread.id,
    expectedId,
    `Expected thread id ${expectedId} but got ${this.reviewThread.id}`
  );
});

Then("the thread status should be {string}", function (expectedStatus) {
  assert.strictEqual(
    this.reviewThread.status,
    expectedStatus,
    `Expected thread status "${expectedStatus}" but got "${this.reviewThread.status}"`
  );
});
