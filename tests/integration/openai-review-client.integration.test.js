import { MicrocksContainer } from "@microcks/microcks-testcontainers";
import * as path from "path";
import { fileURLToPath } from "url";
import { createOpenAIReviewClient } from "../../src/infrastructure/openai-review-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mocksDir = path.resolve(__dirname, "../mocks");

let container;
let mockBaseUrl;

beforeAll(async () => {
  container = await new MicrocksContainer()
    .withMainArtifacts([
      path.resolve(mocksDir, "openai-chat-completions.openapi.yaml"),
    ])
    .withSecondaryArtifacts([
      path.resolve(mocksDir, "openai-chat-completions.apiexamples.yaml"),
      path.resolve(mocksDir, "openai-chat-completions.apimetadata.yaml"),
    ])
    .start();

  mockBaseUrl = container.getRestMockEndpoint(
    "OpenAI Chat Completions API",
    "1.0"
  );
}, 120_000);

afterAll(async () => {
  await container?.stop();
});

describe("OpenAI Review Client — Microcks integration tests", () => {
  it("reviewFile() returns an array of ReviewComment objects", async () => {
    const client = createOpenAIReviewClient({
      apiKey: "fake-key-for-tests",
      baseURL: mockBaseUrl,
    });

    const comments = await client.reviewFile({
      filePath: "src/app.js",
      fileContent: 'console.log("hello");',
      availableSkills: [],
      loadSkill: () => null,
    });

    // Microcks returns a "stop" response with no tool_calls
    // so the loop should end with 0 comments
    expect(Array.isArray(comments)).toBe(true);
    expect(comments).toHaveLength(0);
  });

  it("reviewFile() accepts instruction and copilot parameters", async () => {
    const client = createOpenAIReviewClient({
      apiKey: "fake-key-for-tests",
      baseURL: mockBaseUrl,
    });

    const comments = await client.reviewFile({
      filePath: "src/service.cs",
      fileContent: "public class Service {}",
      availableSkills: ["clean-code.md"],
      loadSkill: (name) => (name === "clean-code.md" ? "Use SOLID principles." : null),
      instructionContext: "### Instruction : dotnet\nUse .NET 8.",
      copilotInstructions: "Always review in French.",
    });

    expect(Array.isArray(comments)).toBe(true);
  });
});
