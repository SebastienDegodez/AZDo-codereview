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
    const { pullRequest, files, skippedFiles } = await getReviewableFiles.execute();

    if (files.length === 0) {
      return { filesReviewed: 0, commentsPosted: 0 };
    }

    // Build a diff lookup map from pre-fetched diffs (path → diff string)
    const diffMap = new Map(files.map(({ change, diff }) => [change.path, diff]));

    let totalComments = 0;

    for (const { change } of files) {
      const filePath = change.path.replace(/^\//, "");

      // getFileContent API expects path without leading slash
      const loadFileContent = (p) => {
        const normalized = p.startsWith("/") ? p.substring(1) : p;
        return pullRequestGateway.getFileContent(normalized, pullRequest.sourceCommitId);
      };

      // diffMap keys come from FileChange.path which always has a leading slash
      const getFileDiff = (p) => {
        const normalized = p.startsWith("/") ? p : `/${p}`;
        return Promise.resolve(diffMap.get(normalized) ?? null);
      };

      const comments = await reviewSingleFile(filePath, { loadFileContent, getFileDiff });

      for (const comment of comments) {
        await pullRequestGateway.postComment(
          comment.filePath,
          comment.line,
          comment.formatted()
        );
      }

      totalComments += comments.length;
    }

    await postSummary(pullRequestGateway, files.length, totalComments, skippedFiles);

    return { filesReviewed: files.length, commentsPosted: totalComments };
  }

  async function reviewSingleFile(filePath, { loadFileContent, getFileDiff }) {
    const instructions = instructionReader.read(filePath);
    const instructionContext = formatInstructions(instructions);
    const availableSkills = skillReader.list();

    return reviewClient.reviewFile({
      filePath,
      loadFileContent,
      getFileDiff,
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

async function postSummary(gateway, filesCount, commentsCount, skippedFiles = []) {
  let skippedSection = "";
  if (skippedFiles.length > 0) {
    const rows = skippedFiles
      .map((f) => `| ${f.path} | ${f.reason} |`)
      .join("\n");
    skippedSection = `\n\n⚠️ Fichiers non analysés\n| Fichier | Raison |\n|---------|--------|\n${rows}`;
  }

  await gateway.postGeneralComment(
    `## 🤖 Code Review IA — Résumé final

| | |
|---|---|
| 📁 Fichiers analysés | ${filesCount} |
| 💬 Commentaires postés | ${commentsCount} |

> Analyse effectuée par **OpenAI gpt-4o**.${skippedSection}`
  );
}
