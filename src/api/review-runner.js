import fs from "fs";
import path from "path";
import { OpenAI } from "openai";
import { createAzureClient } from "../infrastructure/azure-devops-client.js";
import { createGetReviewableFiles } from "../application/get-reviewable-files.js";

// ─── Configuration ────────────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AZURE_DEVOPS_ORG = process.env.AZURE_DEVOPS_ORG;
const AZURE_DEVOPS_PROJECT = process.env.AZURE_DEVOPS_PROJECT;
const AZURE_DEVOPS_REPO = process.env.AZURE_DEVOPS_REPO;
const AZURE_DEVOPS_PR_ID = process.env.AZURE_DEVOPS_PR_ID;
const AZURE_DEVOPS_PAT = process.env.AZURE_DEVOPS_PAT;

const SKILLS_DIR = path.resolve(".github/skills");
const INSTRUCTIONS_DIR = path.resolve(".github/instructions");
const COPILOT_INSTRUCTIONS_PATH = path.resolve(".github/copilot-instructions.md");

// ─── Skill Registry ───────────────────────────────────────────────────────────

function buildSkillRegistry(dirPath) {
  if (!fs.existsSync(dirPath)) {
    console.warn(`⚠️  Dossier introuvable : ${dirPath}`);
    return {};
  }
  return fs
    .readdirSync(dirPath)
    .filter((f) => fs.statSync(path.join(dirPath, f)).isFile())
    .reduce((acc, file) => {
      acc[file] = {
        loaded: false,
        content: null,
        filePath: path.join(dirPath, file),
      };
      return acc;
    }, {});
}

function loadSkill(registry, skillName) {
  const skill = registry[skillName];
  if (!skill) return null;
  if (!skill.loaded) {
    skill.content = fs.readFileSync(skill.filePath, "utf-8");
    skill.loaded = true;
    console.log(`   📖 Skill chargé à la demande : ${skillName}`);
  }
  return skill.content;
}

function readInstructions(dirPath, filePath = "") {
  if (!fs.existsSync(dirPath)) return {};

  return fs
    .readdirSync(dirPath)
    .filter((f) => fs.statSync(path.join(dirPath, f)).isFile())
    .reduce((acc, file) => {
      const raw = fs.readFileSync(path.join(dirPath, file), "utf-8");
      const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
      let applyTo = null;
      let content = raw;

      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const applyToMatch = frontmatter.match(/^applyTo:\s*["']?([^"'\r\n]+)["']?\s*$/m);
        if (applyToMatch) {
          applyTo = applyToMatch[1].trim();
        }
        content = raw.slice(frontmatterMatch[0].length);
      }

      const shouldApply =
        !applyTo ||
        applyTo === "**" ||
        matchGlob(applyTo, filePath);

      if (shouldApply) {
        acc[file] = content;
      }

      return acc;
    }, {});
}

function matchGlob(pattern, filePath) {
  if (!filePath) return true;
  const regexStr = pattern
    .replace(/\\/g, "\\\\")
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  const regex = new RegExp(`(^|/)${regexStr}$`, "i");
  return regex.test(filePath);
}

function readCopilotInstructions() {
  if (!fs.existsSync(COPILOT_INSTRUCTIONS_PATH)) return "";
  const content = fs.readFileSync(COPILOT_INSTRUCTIONS_PATH, "utf-8");
  console.log(`   📋 Copilot instructions chargées depuis ${COPILOT_INSTRUCTIONS_PATH}`);
  return content;
}

// ─── OpenAI Tools ─────────────────────────────────────────────────────────────

function buildTools(skillRegistry) {
  const skillNames = Object.keys(skillRegistry);

  return [
    {
      type: "function",
      function: {
        name: "load_skill",
        description:
          "Charge le contenu d'un skill de coding disponible.",
        parameters: {
          type: "object",
          properties: {
            skill_name: {
              type: "string",
              enum: skillNames,
              description: "Nom exact du fichier skill à charger.",
            },
          },
          required: ["skill_name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_available_skills",
        description: "Liste tous les skills de coding disponibles.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "post_review_comment",
        description: "Publie un commentaire de code review sur un fichier.",
        parameters: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Chemin du fichier" },
            line: { type: "integer", description: "Numéro de ligne" },
            severity: {
              type: "string",
              enum: ["critique", "majeur", "mineur", "suggestion"],
            },
            comment: { type: "string", description: "Commentaire détaillé" },
          },
          required: ["file_path", "line", "severity", "comment"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "post_general_comment",
        description: "Publie un commentaire général sur la Pull Request.",
        parameters: {
          type: "object",
          properties: {
            comment: { type: "string", description: "Contenu du commentaire" },
          },
          required: ["comment"],
        },
      },
    },
  ];
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

async function reviewFileAgentLoop(openai, tools, skillRegistry, azureClient, copilotInstructions, filePath, fileContent) {
  console.log(`\n🔎 Review de : ${filePath}`);

  const instructions = readInstructions(INSTRUCTIONS_DIR, filePath);
  let instructionContext = "";
  for (const [name, content] of Object.entries(instructions)) {
    instructionContext += `### Instruction : ${name}\n${content}\n\n`;
  }

  const copilotContext = copilotInstructions
    ? `### Copilot Instructions\n${copilotInstructions}\n\n`
    : "";

  const systemPrompt = `Tu es un expert en code review. Tu analyses des Pull Requests et fournis des commentaires précis, constructifs et en français.

Tu as accès à des skills de coding via le tool "load_skill". 
Commence par appeler "list_available_skills" pour découvrir les skills disponibles, puis charge ceux qui sont pertinents pour le fichier analysé.
Une fois ton analyse terminée, publie tes commentaires via "post_review_comment" (un appel par problème) et termine par un résumé avec "post_general_comment".

${copilotContext}${instructionContext}

Format de chaque commentaire :
- Sévérité indiquée
- Description claire du problème
- Suggestion de correction concrète`;

  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Analyse ce fichier de la Pull Request et publie tes commentaires via les tools disponibles.

**Fichier :** \`${filePath}\`

\`\`\`
${fileContent.slice(0, 12000)}${fileContent.length > 12000 ? "\n... [tronqué]" : ""}
\`\`\``,
    },
  ];

  let postedComments = 0;
  let iterations = 0;
  const MAX_ITERATIONS = 20;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.1,
      parallel_tool_calls: false,
    });

    const choice = response.choices[0];
    messages.push(choice.message);

    if (choice.finish_reason === "stop") {
      console.log(`   ✅ Analyse terminée (${iterations} tours, ${postedComments} commentaire(s) posté(s)).`);
      break;
    }

    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      const toolResults = [];

      for (const toolCall of choice.message.tool_calls) {
        const { name, arguments: argsJson } = toolCall.function;
        const args = JSON.parse(argsJson);
        let result;

        switch (name) {
          case "list_available_skills": {
            const available = Object.keys(skillRegistry);
            result = available.length > 0
              ? `Skills disponibles : ${available.join(", ")}`
              : "Aucun skill disponible.";
            break;
          }
          case "load_skill": {
            const content = loadSkill(skillRegistry, args.skill_name);
            result = content
              ? `Contenu du skill "${args.skill_name}" :\n\n${content}`
              : `❌ Skill "${args.skill_name}" introuvable.`;
            break;
          }
          case "post_review_comment": {
            const emoji = {
              critique: "🔴", majeur: "🟠", mineur: "🟡", suggestion: "🔵",
            }[args.severity] ?? "⚪";
            const formattedComment =
              `${emoji} **[${args.severity.toUpperCase()}]** — Code Review IA\n\n${args.comment}`;
            await azureClient.postComment(args.file_path, args.line, formattedComment);
            postedComments++;
            result = `Commentaire posté sur ${args.file_path}:${args.line}`;
            break;
          }
          case "post_general_comment": {
            await azureClient.postGeneralComment(args.comment);
            result = "Commentaire général posté.";
            break;
          }
          default:
            result = `Tool inconnu : ${name}`;
        }

        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      messages.push(...toolResults);
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    console.warn(`   ⚠️  Limite d'itérations atteinte pour ${filePath}`);
  }

  return postedComments;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Démarrage de la code review OpenAI (chargement progressif des skills)...\n");

  const requiredEnvVars = [
    "OPENAI_API_KEY", "AZURE_DEVOPS_ORG", "AZURE_DEVOPS_PROJECT",
    "AZURE_DEVOPS_REPO", "AZURE_DEVOPS_PR_ID", "AZURE_DEVOPS_PAT",
  ];
  const missing = requiredEnvVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(`❌ Variables manquantes : ${missing.join(", ")}`);
    process.exit(1);
  }

  const skillRegistry = buildSkillRegistry(SKILLS_DIR);
  console.log(`📂 ${Object.keys(skillRegistry).length} skill(s) référencé(s).`);

  const copilotInstructions = readCopilotInstructions();
  const tools = buildTools(skillRegistry);
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  // Infrastructure
  const azureClient = createAzureClient({
    pat: AZURE_DEVOPS_PAT,
    org: AZURE_DEVOPS_ORG,
    project: AZURE_DEVOPS_PROJECT,
    repo: AZURE_DEVOPS_REPO,
    prId: AZURE_DEVOPS_PR_ID,
  });

  // Application use case
  const getReviewableFiles = createGetReviewableFiles({
    pullRequestGateway: azureClient,
  });

  console.log(`\n🔍 Récupération de la PR #${AZURE_DEVOPS_PR_ID}...`);
  const { pullRequest, files } = await getReviewableFiles.execute();
  console.log(`   📋 ${pullRequest.title}`);
  console.log(`\n📝 ${files.length} fichier(s) à reviewer.\n`);

  if (files.length === 0) return;

  let totalComments = 0;

  for (const { change, content } of files) {
    const filePath = change.path.replace(/^\//, "");
    const count = await reviewFileAgentLoop(openai, tools, skillRegistry, azureClient, copilotInstructions, filePath, content);
    totalComments += count;
  }

  const loadedSkills = Object.entries(skillRegistry)
    .filter(([, s]) => s.loaded)
    .map(([name]) => name);

  await azureClient.postGeneralComment(
    `## 🤖 Code Review IA — Résumé final

| | |
|---|---|
| 📁 Fichiers analysés | ${files.length} |
| 💬 Commentaires postés | ${totalComments} |
| 📖 Skills utilisés | ${loadedSkills.length > 0 ? loadedSkills.join(", ") : "aucun"} |

> Analyse effectuée par **OpenAI gpt-4o** avec chargement progressif des skills.`
  );

  console.log(`\n✅ Review terminée — ${totalComments} commentaire(s) posté(s).`);
  console.log(`📖 Skills effectivement utilisés : ${loadedSkills.join(", ") || "aucun"}`);
}

main().catch((err) => {
  console.error("❌ Erreur fatale :", err.message);
  process.exit(1);
});
