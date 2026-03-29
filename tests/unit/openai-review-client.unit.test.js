/**
 * Unit tests for the OpenAI review client — rate-limit retry behavior.
 *
 * The OpenAI API call is replaced by a controllable fake so that:
 *   - we can simulate 429 responses without a real network call
 *   - sleep() is replaced by a no-op to keep the tests fast
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
