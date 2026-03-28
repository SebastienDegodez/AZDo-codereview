import { MicrocksContainer } from "@microcks/microcks-testcontainers";
import * as path from "path";
import { fileURLToPath } from "url";
import { createAzureClient } from "../../src/azure-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mocksDir = path.resolve(__dirname, "../mocks");

let container;
let client;

beforeAll(async () => {
  container = await new MicrocksContainer()
    .withMainArtifacts([
      path.resolve(mocksDir, "azure-devops-pr-api.openapi.yaml")
    ])
    .withSecondaryArtifacts([
      path.resolve(mocksDir, "azure-devops-pr-api.apiexamples.yaml"),
      path.resolve(mocksDir, "azure-devops-pr-api.apimetadata.yaml")
    ])
    .start();

  const mockBaseUrl = container.getRestMockEndpoint("Azure DevOps PR API", "7.1");

  client = createAzureClient({
    baseUrl: mockBaseUrl,
    pat: "fake-pat-for-tests",
    org: "myorg",
    project: "myproject",
    repo: "myrepo",
    prId: "42"
  });
}, 120_000);

afterAll(async () => {
  await container?.stop();
});

describe("Azure DevOps Client — Microcks integration tests", () => {
  it("getPRInfo() returns PR title and commit IDs", async () => {
    const info = await client.getPRInfo();
    expect(info.title).toBe("feat: add review automation");
    expect(info.sourceCommitId).toBe("abc123def456");
  });

  it("getLastIterationId() returns the latest iteration id", async () => {
    const iterationId = await client.getLastIterationId();
    expect(iterationId).toBe(1);
  });

  it("getPRChanges() returns list of changed files", async () => {
    const changes = await client.getPRChanges(1);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0].item.path).toBeDefined();
  });

  it("getFileContent() returns file content for a JS file", async () => {
    const content = await client.getFileContent("/src/app.js", "abc123def456");
    expect(content).toBeTruthy();
  });

  it("getFileContent() returns file content for a CS file", async () => {
    const content = await client.getFileContent("/src/Service.cs", "abc123def456");
    expect(content).toBeTruthy();
  });

  it("postComment() posts a comment successfully", async () => {
    const result = await client.postComment("/src/app.js", 10, "🔴 **[CRITIQUE]** — Test comment");
    expect(result).toBeDefined();
    expect(result.id).toBe(1001);
    expect(result.status).toBe("active");
  });

  it("postGeneralComment() posts a general comment successfully", async () => {
    const result = await client.postGeneralComment("## 🤖 Review summary");
    expect(result).toBeDefined();
    expect(result.id).toBe(1001);
    expect(result.status).toBe("active");
  });
});
