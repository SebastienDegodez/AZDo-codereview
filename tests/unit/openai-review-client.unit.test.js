/**
 * Unit tests for the OpenAI Review Client infrastructure adapter.
 *
 * Specifically covers the `buildTools()` behaviour that was causing HTTP 400
 * errors when `availableSkills` was empty: an empty `enum: []` violates the
 * JSON Schema spec and OpenAI rejects it immediately.
 *
 * The OpenAI SDK is mocked so no network is needed.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mock the openai package BEFORE importing the module under test ──────────

const mockCreate = jest.fn();

await jest.unstable_mockModule("openai", () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

const { createOpenAIReviewClient } = await import(
  "../../src/infrastructure/openai-review-client.js"
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal OpenAI "stop" response — no tool calls, loop ends immediately. */
function makeStopResponse() {
  return {
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: "Aucun commentaire." },
      },
    ],
  };
}

/** Extract the `tools` array that was passed to the last `create()` call. */
function capturedTools() {
  const lastCall = mockCreate.mock.calls[mockCreate.mock.calls.length - 1];
  return lastCall[0].tools;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("OpenAI Review Client — buildTools", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(makeStopResponse());
  });

  it("n'inclut PAS load_skill quand availableSkills est vide — évite l'erreur HTTP 400", async () => {
    // Avant le correctif, buildTools() produisait `enum: []` pour load_skill,
    // ce qui est invalide selon la spec JSON Schema et causait un rejet HTTP 400
    // de la part de l'API OpenAI.
    const client = createOpenAIReviewClient({ apiKey: "fake-key" });

    await client.reviewFile({
      filePath: "src/app.js",
      fileContent: "const x = 1;",
      availableSkills: [], // ← le cas qui causait l'erreur 400
      loadSkill: () => null,
    });

    const tools = capturedTools();
    const hasLoadSkill = tools.some((t) => t.function.name === "load_skill");

    expect(hasLoadSkill).toBe(false);
  });

  it("n'inclut aucun outil avec enum vide dans la requête envoyée à OpenAI", async () => {
    const client = createOpenAIReviewClient({ apiKey: "fake-key" });

    await client.reviewFile({
      filePath: "src/app.js",
      fileContent: "const x = 1;",
      availableSkills: [],
      loadSkill: () => null,
    });

    const tools = capturedTools();

    tools.forEach((tool) => {
      const props = tool.function?.parameters?.properties ?? {};
      Object.values(props).forEach((prop) => {
        if (prop.enum !== undefined) {
          expect(prop.enum.length).toBeGreaterThan(0);
        }
      });
    });
  });

  it("inclut load_skill avec enum correct quand des skills sont disponibles", async () => {
    const client = createOpenAIReviewClient({ apiKey: "fake-key" });

    await client.reviewFile({
      filePath: "src/service.cs",
      fileContent: "public class Service {}",
      availableSkills: ["clean-code.md", "dotnet.md"],
      loadSkill: () => null,
    });

    const tools = capturedTools();
    const loadSkillTool = tools.find((t) => t.function.name === "load_skill");

    expect(loadSkillTool).toBeDefined();
    expect(loadSkillTool.function.parameters.properties.skill_name.enum).toEqual([
      "clean-code.md",
      "dotnet.md",
    ]);
  });

  it("inclut toujours list_available_skills, post_review_comment et post_general_comment", async () => {
    const client = createOpenAIReviewClient({ apiKey: "fake-key" });

    await client.reviewFile({
      filePath: "src/app.js",
      fileContent: "const x = 1;",
      availableSkills: [],
      loadSkill: () => null,
    });

    const toolNames = capturedTools().map((t) => t.function.name);

    expect(toolNames).toContain("list_available_skills");
    expect(toolNames).toContain("post_review_comment");
    expect(toolNames).toContain("post_general_comment");
  });
});
