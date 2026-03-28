import fs from "fs";
import path from "path";
import { OpenAI } from "openai";
import {
  getPRInfo,
  getLastIterationId,
  getPRChanges,
  getFileContent,
  postComment,
  postGeneralComment,
} from "./src/azure-client.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SKILLS_DIR = path.resolve(".github/skills");
const INSTRUCTIONS_DIR = path.resolve(".github/instruction");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Lit tous les fichiers texte d'un dossier (récursif niveau 1).
 * Retourne un tableau de { name, content } pour un chargement progressif.
 */
function readFilesFromDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    console.warn(`⚠️  Dossier introuvable : ${dirPath}`);
    return [];
  }
  return fs
    .readdirSync(dirPath)
    .filter((f) => fs.statSync(path.join(dirPath, f)).isFile())
    .map((file) => ({
      name: file,
      content: fs.readFileSync(path.join(dirPath, file), "utf-8"),
    }));
}

// ─── OpenAI function definitions for progressive skill loading ────────────────

/**
 * Builds the list of OpenAI tool definitions from available skills and instructions.
 * Each skill/instruction is exposed as a callable tool so the model can request
 * the ones it actually needs (progressive loading).
 */
function buildTools(skills, instructions) {
  const tools = [];

  for (const skill of skills) {
    tools.push({
      type: "function",
      function: {
        name: `get_skill_${skill.name.replace(/[^a-zA-Z0-9_]/g, "_")}`,
        description: `Load the skill/guideline file: ${skill.name}`,
        parameters: { type: "object", properties: {}, required: [] },
      },
    });
  }

  for (const instr of instructions) {
    tools.push({
      type: "function",
      function: {
        name: `get_instruction_${instr.name.replace(/[^a-zA-Z0-9_]/g, "_")}`,
        description: `Load the instruction file: ${instr.name}`,
        parameters: { type: "object", properties: {}, required: [] },
      },
    });
  }

  return tools;
}

/**
 * Resolves a tool call name back to its content.
 */
function resolveToolCall(toolName, skills, instructions) {
  for (const skill of skills) {
    if (toolName === `get_skill_${skill.name.replace(/[^a-zA-Z0-9_]/g, "_")}`) {
      return skill.content;
    }
  }
  for (const instr of instructions) {
    if (toolName === `get_instruction_${instr.name.replace(/[^a-zA-Z0-9_]/g, "_")}`) {
      return instr.content;
    }
  }
  return "Contenu non trouvé.";
}

// ─── OpenAI Review with progressive skill loading ─────────────────────────────

/**
 * Envoie le diff d'un fichier à OpenAI et retourne la review structurée.
 * Les skills/instructions sont chargés progressivement via function calling :
 * le modèle demande uniquement les fichiers dont il a besoin.
 */
async function reviewFileWithOpenAI(openai, skills, instructions, filePath, diffContent) {
  const tools = buildTools(skills, instructions);

  const systemMessage = {
    role: "system",
    content: `Tu es un expert en code review. Tu analyses des Pull Requests et fournis des commentaires précis, constructifs et en français.

Tu as accès à des skills et des instructions supplémentaires via des outils. Charge-les si tu en as besoin pour effectuer une review de qualité.

Pour chaque problème identifié, indique :
- **Fichier** et **ligne(s)** concerné(s)
- **Sévérité** : critique | majeur | mineur | suggestion
- **Description** du problème
- **Suggestion** de correction si possible`,
  };

  const userMessage = {
    role: "user",
    content: `Voici le contenu du fichier modifié dans la Pull Request :

**Fichier :** \`${filePath}\`

\`\`\`
${diffContent}
\`\`\`

Analyse ce code et liste tous les problèmes que tu détectes.
Si le code est correct, réponds uniquement : "✅ Aucun problème détecté."`,
  };

  const messages = [systemMessage, userMessage];

  // Agentic loop: the model may call tools to load skills/instructions progressively
  while (true) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined,
      temperature: 0.2,
    });

    const choice = response.choices[0];

    if (choice.finish_reason === "tool_calls") {
      // Model requested one or more skills/instructions — fulfill them all
      const assistantMessage = choice.message;
      messages.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        const content = resolveToolCall(toolCall.function.name, skills, instructions);
        console.log(`   📖 Chargement du skill/instruction : ${toolCall.function.name}`);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content,
        });
      }
      // Continue the loop so the model can finish with the loaded context
      continue;
    }

    // finish_reason === "stop" — we have the final answer
    return choice.message.content;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Démarrage de la code review OpenAI pour Azure DevOps...\n");

  // Validation des variables d'environnement
  const requiredEnvVars = [
    "OPENAI_API_KEY",
    "AZURE_DEVOPS_ORG",
    "AZURE_DEVOPS_PROJECT",
    "AZURE_DEVOPS_REPO",
    "AZURE_DEVOPS_PR_ID",
    "AZURE_DEVOPS_PAT",
  ];
  const missing = requiredEnvVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(`❌ Variables d'environnement manquantes : ${missing.join(", ")}`);
    process.exit(1);
  }

  // 1. Lecture des fichiers de contexte (pour chargement progressif)
  console.log("📂 Lecture des skills et instructions...");
  const skills = readFilesFromDir(SKILLS_DIR);
  const instructions = readFilesFromDir(INSTRUCTIONS_DIR);
  console.log(
    `   ✅ ${skills.length} skill(s), ${instructions.length} instruction(s) disponible(s) pour chargement progressif.`
  );

  // 2. Initialisation OpenAI
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  // 3. Récupération des infos PR
  console.log(`\n🔍 Récupération de la PR #${process.env.AZURE_DEVOPS_PR_ID}...`);
  const prInfo = await getPRInfo();
  console.log(`   📋 Titre : ${prInfo.title}`);

  // 4. Récupération des changements
  const iterationId = await getLastIterationId();
  const changes = await getPRChanges(iterationId);
  const codeExtensions =
    /\.(js|ts|jsx|tsx|py|cs|java|go|rb|php|cpp|c|h|sql|yaml|yml|json|xml|sh|ps1)$/i;
  const filesToReview = changes.filter(
    (c) => c.item?.path && codeExtensions.test(c.item.path) && c.changeType !== 32 // 32 = delete
  );

  console.log(`\n📝 ${filesToReview.length} fichier(s) à reviewer.\n`);

  if (filesToReview.length === 0) {
    console.log("ℹ️  Aucun fichier de code à analyser.");
    return;
  }

  // 5. Review de chaque fichier
  const allReviews = [];

  for (const change of filesToReview) {
    const filePath = change.item.path.replace(/^\//, "");
    console.log(`🔎 Analyse de : ${filePath}`);

    const content = await getFileContent(filePath, prInfo.sourceCommitId);
    if (!content) {
      console.log(`   ⏭️  Impossible de récupérer le contenu, fichier ignoré.`);
      continue;
    }

    const reviewText = await reviewFileWithOpenAI(openai, skills, instructions, filePath, content);

    if (reviewText.includes("✅ Aucun problème détecté")) {
      console.log(`   ✅ Aucun problème détecté.`);
      allReviews.push({ filePath, status: "ok", reviewText });
      continue;
    }

    console.log(`   ⚠️  Problèmes détectés, publication des commentaires...`);
    allReviews.push({ filePath, status: "issues", reviewText });

    const formattedComment = `## 🤖 Code Review IA — \`${filePath}\`\n\n${reviewText}`;
    await postComment(filePath, 1, formattedComment);
  }

  // 6. Résumé global
  const issueCount = allReviews.filter((r) => r.status === "issues").length;
  const okCount = allReviews.filter((r) => r.status === "ok").length;

  const summary = `## 🤖 Résumé de la Code Review IA

| Statut | Fichiers |
|--------|----------|
| ✅ OK | ${okCount} |
| ⚠️ Problèmes | ${issueCount} |
| 📋 Total | ${allReviews.length} |

> Analyse effectuée par OpenAI (gpt-4o) avec chargement progressif des skills depuis \`.github/skills\` et \`.github/instruction\`.`;

  await postGeneralComment(summary);
  console.log("\n✅ Code review terminée !");
}

main().catch((err) => {
  console.error("❌ Erreur fatale :", err.message);
  process.exit(1);
});
