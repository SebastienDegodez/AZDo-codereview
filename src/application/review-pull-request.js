/**
 * Application use case — Review all files in a Pull Request.
 *
 * Orchestrates:
 *  1. Get reviewable files (delegates to getReviewableFiles use case)
 *  2. For each file, ask the AI reviewer to produce ReviewComment[]
 *  3. Post each comment on the PR via the gateway
 *  4. Post a summary comment
 *
 * @param {object} deps — injected ports
 * @param {object} deps.getReviewableFiles   — use case from get-reviewable-files.js
 * @param {object} deps.reviewClient         — infrastructure port for AI review (openai-review-client)
 * @param {object} deps.pullRequestGateway   — infrastructure port for posting comments (azure-devops-client)
 * @param {object} deps.skillReader          — infrastructure port for reading skills
 * @param {object} deps.instructionReader    — infrastructure port for reading instructions
 * @param {string} [deps.copilotInstructions] — global copilot instructions content
 * @returns {{ execute(): Promise<{ filesReviewed: number, commentsPosted: number }> }}
 */
export function createReviewPullRequest({
  getReviewableFiles,
  reviewClient,
  pullRequestGateway,
  skillReader,
  instructionReader,
  copilotInstructions = "",
}) {
  async function execute() {
    const { pullRequest, files } = await getReviewableFiles.execute();

    if (files.length === 0) {
      return { filesReviewed: 0, commentsPosted: 0 };
    }

    let totalComments = 0;

    for (const { change, content } of files) {
      const filePath = change.path.replace(/^\//, "");
      const comments = await reviewSingleFile(filePath, content);

      for (const comment of comments) {
        await pullRequestGateway.postComment(
          comment.filePath,
          comment.line,
          comment.formatted()
        );
      }

      totalComments += comments.length;
    }

    await postSummary(pullRequestGateway, files.length, totalComments);

    return { filesReviewed: files.length, commentsPosted: totalComments };
  }

  async function reviewSingleFile(filePath, fileContent) {
    const instructions = instructionReader.read(filePath);
    const instructionContext = formatInstructions(instructions);
    const availableSkills = skillReader.list();

    return reviewClient.reviewFile({
      filePath,
      fileContent,
      availableSkills,
      loadSkill: (name) => skillReader.load(name),
      instructionContext,
      copilotInstructions,
    });
  }

  return { execute };
}

// ── internal helpers ──

function formatInstructions(instructions) {
  return Object.entries(instructions)
    .map(([name, content]) => `### Instruction : ${name}\n${content}`)
    .join("\n\n");
}

async function postSummary(gateway, filesCount, commentsCount) {
  await gateway.postGeneralComment(
    `## 🤖 Code Review IA — Résumé final

| | |
|---|---|
| 📁 Fichiers analysés | ${filesCount} |
| 💬 Commentaires postés | ${commentsCount} |

> Analyse effectuée par **OpenAI gpt-4o**.`
  );
}
