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

describe("createOpenAIReviewClient — retry delay", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("uses the retry-after header value when present in a 429 response", async () => {
    const retryAfterSeconds = 3;
    const rateLimitErrorWithHeader = new Error("Rate limit exceeded");
    rateLimitErrorWithHeader.status = 429;
    rateLimitErrorWithHeader.headers = { "retry-after": String(retryAfterSeconds) };

    let callCount = 0;
    const fakeOpenAI = {
      chat: {
        completions: {
          create: jest.fn(async () => {
            callCount++;
            if (callCount === 1) throw rateLimitErrorWithHeader;
            return createStopResponse();
          }),
        },
      },
    };

    const client = createOpenAIReviewClient({ openaiInstance: fakeOpenAI });
    const reviewPromise = client.reviewFile({
      filePath: "src/demo/program.cs",
      availableSkills: [],
      loadSkill: () => null,
    });

    // After less than the retry-after duration, the retry has not yet fired
    await jest.advanceTimersByTimeAsync(retryAfterSeconds * 1000 - 1);
    expect(callCount).toBe(1);

    // After the full retry-after duration, the retry fires
    await jest.advanceTimersByTimeAsync(1);
    await reviewPromise;
    expect(callCount).toBe(2);
  });

  it("uses a short exponential fallback (5s base) when no retry-after header is present", async () => {
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

    const client = createOpenAIReviewClient({ openaiInstance: fakeOpenAI });
    const reviewPromise = client.reviewFile({
      filePath: "src/demo/program.cs",
      availableSkills: [],
      loadSkill: () => null,
    });

    // After less than 5s (first fallback delay), the retry has not yet fired
    await jest.advanceTimersByTimeAsync(4_999);
    expect(callCount).toBe(1);

    // After 5s, the retry fires
    await jest.advanceTimersByTimeAsync(1);
    await reviewPromise;
    expect(callCount).toBe(2);
  });
});

describe("createOpenAIReviewClient — agentic loop multi-turn", () => {
  it("processes a full multi-turn cycle: read_file → post_review_comment → stop", async () => {
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

            if (callCount === 2) {
              return {
                choices: [
                  {
                    finish_reason: "tool_calls",
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "call_comment",
                          type: "function",
                          function: {
                            name: "post_review_comment",
                            arguments: JSON.stringify({
                              file_path: "src/app.cs",
                              line: 1,
                              severity: "suggestion",
                              comment: "Use a logger instead of console.log.",
                            }),
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
    const comments = await client.reviewFile({
      filePath: "src/app.cs",
      loadFileContent: async () => 'console.log("hello");',
      availableSkills: [],
      loadSkill: () => null,
    });

    expect(callCount).toBe(3);
    expect(Array.isArray(comments)).toBe(true);
    expect(comments).toHaveLength(1);
    expect(comments[0].comment).toBe("Use a logger instead of console.log.");
  });

  it("stops cleanly when finish_reason is 'tool_calls' but tool_calls is null", async () => {
    const fakeOpenAI = {
      chat: {
        completions: {
          create: jest.fn(async () => ({
            choices: [
              {
                finish_reason: "tool_calls",
                message: { role: "assistant", content: null, tool_calls: null },
              },
            ],
            usage: null,
          })),
        },
      },
    };

    const client = createOpenAIReviewClient({ openaiInstance: fakeOpenAI });
    const comments = await client.reviewFile({
      filePath: "src/app.cs",
      availableSkills: [],
      loadSkill: () => null,
    });

    expect(fakeOpenAI.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(Array.isArray(comments)).toBe(true);
  });

  it("stops cleanly when finish_reason is 'tool_calls' but tool_calls is an empty array", async () => {
    const fakeOpenAI = {
      chat: {
        completions: {
          create: jest.fn(async () => ({
            choices: [
              {
                finish_reason: "tool_calls",
                message: { role: "assistant", content: null, tool_calls: [] },
              },
            ],
            usage: null,
          })),
        },
      },
    };

    const client = createOpenAIReviewClient({ openaiInstance: fakeOpenAI });
    const comments = await client.reviewFile({
      filePath: "src/app.cs",
      availableSkills: [],
      loadSkill: () => null,
    });

    expect(fakeOpenAI.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(Array.isArray(comments)).toBe(true);
  });

  it("stops cleanly when finish_reason is an unexpected value (e.g., 'length')", async () => {
    const fakeOpenAI = {
      chat: {
        completions: {
          create: jest.fn(async () => ({
            choices: [
              {
                finish_reason: "length",
                message: { role: "assistant", content: "Truncated…", tool_calls: null },
              },
            ],
            usage: null,
          })),
        },
      },
    };

    const client = createOpenAIReviewClient({ openaiInstance: fakeOpenAI });
    const comments = await client.reviewFile({
      filePath: "src/app.cs",
      availableSkills: [],
      loadSkill: () => null,
    });

    expect(fakeOpenAI.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(Array.isArray(comments)).toBe(true);
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
