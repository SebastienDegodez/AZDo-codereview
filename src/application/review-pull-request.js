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

    for (const skipped of skippedFiles) {
      await pullRequestGateway.postComment(
        skipped.path,
        1,
        `🔴 [CRITIQUE] — Code Review IA\n\nLe contenu du fichier n'est pas inclus dans la Pull Request. Il est impossible d'analyser le code sans avoir accès à son contenu. Veuillez inclure le code source pour permettre une revue complète et précise.`
      );
    }

    if (files.length === 0) {
      return { filesReviewed: 0, commentsPosted: 0 };
    }

    const diffMap = buildDiffMap(files);
    let totalComments = 0;

    for (const { change } of files) {
      totalComments += await reviewAndPostComments(change, diffMap, pullRequest);
    }

    await postSummary(pullRequestGateway, files.length, totalComments, skippedFiles);

    return { filesReviewed: files.length, commentsPosted: totalComments };
  }

  async function reviewAndPostComments(change, diffMap, pullRequest) {
    const filePath = change.path.replace(/^\//, "");

    const loadFileContent = (filePath) =>
      pullRequestGateway.getFileContent(filePath, pullRequest.sourceCommitId);

    // diffMap keys come from FileChange.path which always has a leading slash
    const getFileDiff = (filePath) =>
      Promise.resolve(diffMap.get(filePath.startsWith("/") ? filePath : `/${filePath}`) ?? null);

    const comments = await reviewSingleFile(filePath, { loadFileContent, getFileDiff });
    await postFileComments(comments);
    return comments.length;
  }

  async function postFileComments(comments) {
    for (const comment of comments) {
      const options = {};
      if (comment.endLine) options.endLine = comment.endLine;
      if (comment.codeRange) {
        options.startColumn = comment.codeRange.start;
        options.endColumn = comment.codeRange.end;
      }
      await pullRequestGateway.postComment(comment.filePath, comment.line, comment.formatted(), options);
    }
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

function buildDiffMap(files) {
  return new Map(files.map(({ change, diff }) => [change.path, diff]));
}

function formatInstructions(instructions) {
  return Object.entries(instructions)
    .map(([name, content]) => `### Instruction : ${name}\n${content}`)
    .join("\n\n");
}

async function postSummary(gateway, filesCount, commentsCount, skippedFiles = []) {
  let skippedSection = "";
  if (skippedFiles.length > 0) {
    const rows = skippedFiles
      .map((skippedFile) => `| ${skippedFile.path} | ${skippedFile.reason} |`)
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
