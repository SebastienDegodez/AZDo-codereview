import path from "path";
import { createAzureClient } from "../infrastructure/azure-devops-client.js";
import { createOpenAIReviewClient } from "../infrastructure/openai-review-client.js";
import { createSkillReader } from "../infrastructure/skill-reader.js";
import { createInstructionReader, readFileOrEmpty } from "../infrastructure/instruction-reader.js";
import { createGetReviewableFiles } from "../application/get-reviewable-files.js";
import { createReviewPullRequest } from "../application/review-pull-request.js";
import { logger } from "../infrastructure/logger.js";

// ─── Configuration ────────────────────────────────────────────────────────────

const SKILLS_DIR = path.resolve(".github/skills");
const INSTRUCTIONS_DIR = path.resolve(".github/instructions");
const COPILOT_INSTRUCTIONS_PATH = path.resolve(".github/copilot-instructions.md");

const REQUIRED_ENV_VARS = [
  "OPENAI_API_KEY", "AZURE_DEVOPS_ORG", "AZURE_DEVOPS_PROJECT",
  "AZURE_DEVOPS_REPO", "AZURE_DEVOPS_PR_ID", "AZURE_DEVOPS_PAT",
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  logger.info("🚀 Démarrage de la code review OpenAI…");

  validateEnv(REQUIRED_ENV_VARS);

  // Infrastructure
  logger.verbose("Initializing Azure DevOps client");
  const azureClient = createAzureClient({
    pat: process.env.AZURE_DEVOPS_PAT,
    org: process.env.AZURE_DEVOPS_ORG,
    project: process.env.AZURE_DEVOPS_PROJECT,
    repo: process.env.AZURE_DEVOPS_REPO,
    prId: process.env.AZURE_DEVOPS_PR_ID,
  });
  logger.verbose("Initializing OpenAI review client");
  const reviewClient = createOpenAIReviewClient({
    apiKey: process.env.OPENAI_API_KEY,
    ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
    ...(process.env.OPENAI_MODEL ? { model: process.env.OPENAI_MODEL } : {}),
  });
  const skillReader = createSkillReader(SKILLS_DIR);
  const instructionReader = createInstructionReader(INSTRUCTIONS_DIR);
  const copilotInstructions = readFileOrEmpty(COPILOT_INSTRUCTIONS_PATH);

  // Application use cases
  const getReviewableFiles = createGetReviewableFiles({ pullRequestGateway: azureClient });
  const reviewPullRequest = createReviewPullRequest({
    getReviewableFiles,
    reviewClient,
    pullRequestGateway: azureClient,
    skillReader,
    instructionReader,
    copilotInstructions,
  });

  // Execute
  logger.info("Starting pull request review…");
  const { filesReviewed, commentsPosted } = await reviewPullRequest.execute();

  logger.info(`✅ Review terminée — ${filesReviewed} fichier(s), ${commentsPosted} commentaire(s).`);
}

function validateEnv(required) {
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    logger.error(`❌ Variables manquantes : ${missing.join(", ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error("❌ Erreur fatale :", err.message);
  process.exit(1);
});
