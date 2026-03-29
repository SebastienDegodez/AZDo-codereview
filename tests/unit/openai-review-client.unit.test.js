/**
 * Unit tests for the OpenAI review client — rate-limit retry behavior and read_file line numbering.
 *
 * The OpenAI API call is replaced by a controllable fake so that:
 *   - we can simulate 429 responses without a real network call
 *   - sleep() is replaced by a no-op to keep the tests fast
 *   - we can inspect messages sent to the model
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { createOpenAIReviewClient } from "../../src/infrastructure/openai-review-client.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function createRateLimitError() {
  const error = new Error("Rate limit of 10 per 60s exceeded");
  error.status = 429;
  return error;
}

function createStopResponse() {
  return {
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: "LGTM", tool_calls: null },
      },
    ],
    usage: null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createOpenAIReviewClient — rate-limit retry", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("retries after a 429 and succeeds on the next attempt", async () => {
    let callCount = 0;
    const fakeOpenAI = {
      chat: {
        completions: {
          create: jest.fn(async () => {
            callCount++;
            if (callCount === 1) throw createRateLimitError();
            return createStopResponse();
          }),
        },
      },
    };

    const client = createOpenAIReviewClient({
      openaiInstance: fakeOpenAI,
    });

    const reviewPromise = client.reviewFile({
      filePath: "src/demo/program.cs",
      availableSkills: [],
      loadSkill: () => null,
    });

    // Advance timers to skip the retry delay
    await jest.runAllTimersAsync();
    const comments = await reviewPromise;

    expect(callCount).toBe(2);
    expect(Array.isArray(comments)).toBe(true);
  });

  it("throws after exhausting all retries", async () => {
    const rateLimitError = createRateLimitError();
    const fakeOpenAI = {
      chat: {
        completions: {
          create: jest.fn(async () => {
            throw rateLimitError;
          }),
        },
      },
    };

    const client = createOpenAIReviewClient({
      openaiInstance: fakeOpenAI,
    });

    // Attach the rejection handler before advancing timers to avoid an
    // unhandled-rejection warning while the retries are in progress.
    const expectedRejection = expect(
      client.reviewFile({
        filePath: "src/demo/program.cs",
        availableSkills: [],
        loadSkill: () => null,
      })
    ).rejects.toBe(rateLimitError);

    await jest.runAllTimersAsync();
    await expectedRejection;

    // 1 initial attempt + 3 retries = 4 total calls
    expect(fakeOpenAI.chat.completions.create).toHaveBeenCalledTimes(4);
  });

  it("does not retry for non-429 errors", async () => {
    const serverError = new Error("Internal Server Error");
    serverError.status = 500;
    const fakeOpenAI = {
      chat: {
        completions: {
          create: jest.fn(async () => {
            throw serverError;
          }),
        },
      },
    };

    const client = createOpenAIReviewClient({
      openaiInstance: fakeOpenAI,
    });

    await expect(
      client.reviewFile({
        filePath: "src/demo/program.cs",
        availableSkills: [],
        loadSkill: () => null,
      })
    ).rejects.toBe(serverError);

    expect(fakeOpenAI.chat.completions.create).toHaveBeenCalledTimes(1);
  });
});

describe("createOpenAIReviewClient — proactive call delay", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("applies a delay before each API call after the first iteration", async () => {
    let callCount = 0;
    const fakeOpenAI = {
      chat: {
        completions: {
          create: jest.fn(async () => {
            callCount++;
            if (callCount === 1) {
              return {
                choices: [
                  {
                    finish_reason: "tool_calls",
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "call_list",
                          type: "function",
                          function: { name: "list_available_skills", arguments: "{}" },
                        },
                      ],
                    },
                  },
                ],
                usage: null,
              };
            }
            return createStopResponse();
          }),
        },
      },
    };

    const callDelayMs = 2000;
    const client = createOpenAIReviewClient({
      openaiInstance: fakeOpenAI,
      callDelayMs,
    });

    const reviewPromise = client.reviewFile({
      filePath: "src/demo/program.cs",
      availableSkills: [],
      loadSkill: () => null,
    });

    // First call should fire immediately (no initial delay)
    await Promise.resolve();
    expect(callCount).toBe(1);

    // Advance timers by the configured delay to trigger the second call
    await jest.advanceTimersByTimeAsync(callDelayMs);
    await reviewPromise;

    expect(callCount).toBe(2);
  });
});

describe("createOpenAIReviewClient — read_file line numbering", () => {
  it("prefixes each line with its 1-indexed line number in the read_file tool result", async () => {
    const fileContent = "line one\nline two\nline three";
    let capturedMessages = [];
    let callCount = 0;

    const fakeOpenAI = {
      chat: {
        completions: {
          create: jest.fn(async ({ messages }) => {
            capturedMessages = [...messages];
            callCount++;

            if (callCount === 1) {
              return {
                choices: [
                  {
                    finish_reason: "tool_calls",
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "call_read",
                          type: "function",
                          function: {
                            name: "read_file",
                            arguments: JSON.stringify({ file_path: "src/app.cs" }),
                          },
                        },
                      ],
                    },
                  },
                ],
                usage: null,
              };
            }

            return createStopResponse();
          }),
        },
      },
    };

    const client = createOpenAIReviewClient({ openaiInstance: fakeOpenAI });
    await client.reviewFile({
      filePath: "src/app.cs",
      loadFileContent: async () => fileContent,
      availableSkills: [],
      loadSkill: () => null,
    });

    const toolResult = capturedMessages.find(
      (message) => message.role === "tool" && message.tool_call_id === "call_read"
    );

    expect(toolResult).toBeDefined();
    expect(toolResult.content).toContain("1 | line one");
    expect(toolResult.content).toContain("2 | line two");
    expect(toolResult.content).toContain("3 | line three");
  });
});
