import fs from "fs";
import path from "path";
import { OpenAI } from "openai";
import { createAzureClient } from "./src/azure-client.js";

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

/**
 * Construit le registre des skills disponibles depuis le dossier.
 * Chaque skill est connu par son nom de fichier, mais son contenu
 * n'est PAS encore chargé (lazy loading).
 * @returns {{ [name: string]: { loaded: boolean, content: string | null, filePath: string } }}
 */
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

/**
 * Charge le contenu d'un skill à la demande.
 */
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

/**
 * Charge les instructions depuis le dossier .github/instructions en respectant
 * le champ `applyTo` défini en frontmatter de chaque fichier.
 * Les instructions sans `applyTo` (ou avec `applyTo: "**"`) s'appliquent toujours.
 * @param {string} dirPath
 * @param {string} filePath - chemin du fichier en cours de review
 * @returns {{ [name: string]: string }}
 */
function readInstructions(dirPath, filePath = "") {
  if (!fs.existsSync(dirPath)) return {};

  return fs
    .readdirSync(dirPath)
    .filter((f) => fs.statSync(path.join(dirPath, f)).isFile())
    .reduce((acc, file) => {
      const raw = fs.readFileSync(path.join(dirPath, file), "utf-8");

      // Parse optional YAML frontmatter (---\n...\n---)
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

      // Apply glob-like matching: support ** (any) and specific extensions
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

/**
 * Minimal glob matching for applyTo patterns.
 * Supports: ** (match all), *.ext (extension match), specific path patterns.
 * @param {string} pattern
 * @param {string} filePath
 * @returns {boolean}
 */
function matchGlob(pattern, filePath) {
  if (!filePath) return true;
  // Convert glob to regex
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  const regex = new RegExp(`(^|/)${regexStr}$`, "i");
  return regex.test(filePath);
}

/**
 * Charge les Copilot instructions (.github/copilot-instructions.md).
 * Ces instructions sont toujours incluses quoi qu'il arrive.
 * @returns {string}
 */
function readCopilotInstructions() {
  if (!fs.existsSync(COPILOT_INSTRUCTIONS_PATH)) return "";
  const content = fs.readFileSync(COPILOT_INSTRUCTIONS_PATH, "utf-8");
  console.log(`   📋 Copilot instructions chargées depuis ${COPILOT_INSTRUCTIONS_PATH}`);
  return content;
}

// ─── OpenAI Tools (function calling) ─────────────────────────────────────────

/**
 * Retourne la liste des tools exposés à OpenAI :
 * - Un tool par skill disponible (non encore chargé = le modèle peut en demander)
 * - Un tool "get_instruction" pour les instructions
 * - Un tool "post_review_comment" pour publier un commentaire
 */
function buildTools(skillRegistry) {
  const skillNames = Object.keys(skillRegistry);

  const tools = [
    // Tool : charger un skill spécifique
    {
      type: "function",
      function: {
        name: "load_skill",
        description:
          "Charge le contenu d'un skill de coding disponible. Utilise ce tool quand tu as besoin de règles ou de conventions spécifiques pour analyser le code.",
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
    // Tool : lister les skills disponibles
    {
      type: "function",
      function: {
        name: "list_available_skills",
        description:
          "Liste tous les skills de coding disponibles dans le dépôt. Utilise ce tool en premier pour savoir quels skills tu peux charger.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    // Tool : publier un commentaire de review sur la PR
    {
      type: "function",
      function: {
        name: "post_review_comment",
        description:
          "Publie un commentaire de code review sur un fichier précis de la Pull Request Azure DevOps.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Chemin du fichier concerné (ex: src/app.js)",
            },
            line: {
              type: "integer",
              description: "Numéro de ligne concernée (1 si non précisé)",
            },
            severity: {
              type: "string",
              enum: ["critique", "majeur", "mineur", "suggestion"],
              description: "Sévérité du problème",
            },
            comment: {
              type: "string",
              description: "Commentaire détaillé décrivant le problème et la correction suggérée",
            },
          },
          required: ["file_path", "line", "severity", "comment"],
        },
      },
    },
    // Tool : publier un commentaire général (résumé)
    {
      type: "function",
      function: {
        name: "post_general_comment",
        description:
          "Publie un commentaire général (résumé) sur la Pull Request, sans cibler un fichier précis.",
        parameters: {
          type: "object",
          properties: {
            comment: {
              type: "string",
              description: "Contenu du commentaire général",
            },
          },
          required: ["comment"],
        },
      },
    },
  ];

  return tools;
}

// ─── Boucle agentic (function calling progressif) ─────────────────────────────

/**
 * Lance la review d'un fichier avec une boucle agentique :
 * OpenAI peut appeler les tools en autant de tours que nécessaire
 * (charger des skills, poster des commentaires) jusqu'à ce qu'il
 * décide de s'arrêter (finish_reason = "stop").
 */
async function reviewFileAgentLoop(openai, tools, skillRegistry, azureClient, copilotInstructions, filePath, fileContent) {
  console.log(`\n🔎 Review de : ${filePath}`);

  // Instructions filtrées selon applyTo + copilot instructions (toujours présentes)
  const instructions = readInstructions(INSTRUCTIONS_DIR, filePath);
  let instructionContext = "";
  for (const [name, content] of Object.entries(instructions)) {
    instructionContext += `### Instruction : ${name}\n${content}\n\n`;
  }

  // Copilot instructions are always appended
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
  const MAX_ITERATIONS = 20; // garde-fou

  // ── Boucle agentique ──
  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.1,
      parallel_tool_calls: false, // traitement séquentiel pour le logging
    });

    const choice = response.choices[0];
    messages.push(choice.message); // on ajoute la réponse du modèle à l'historique

    // Fin de la boucle : le modèle n'a plus rien à faire
    if (choice.finish_reason === "stop") {
      console.log(`   ✅ Analyse terminée (${iterations} tours, ${postedComments} commentaire(s) posté(s)).`);
      break;
    }

    // Traitement des tool calls
    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      const toolResults = [];

      for (const toolCall of choice.message.tool_calls) {
        const { name, arguments: argsJson } = toolCall.function;
        const args = JSON.parse(argsJson);
        let result;

        switch (name) {
          // ── Lister les skills disponibles ──
          case "list_available_skills": {
            const available = Object.keys(skillRegistry);
            result =
              available.length > 0
                ? `Skills disponibles : ${available.join(", ")}`
                : "Aucun skill disponible.";
            console.log(`   🗂️  list_available_skills → ${available.length} skill(s)`);
            break;
          }

          // ── Charger un skill à la demande ──
          case "load_skill": {
            const content = loadSkill(skillRegistry, args.skill_name);
            result = content
              ? `Contenu du skill "${args.skill_name}" :\n\n${content}`
              : `❌ Skill "${args.skill_name}" introuvable.`;
            break;
          }

          // ── Poster un commentaire sur un fichier ──
          case "post_review_comment": {
            const emoji = {
              critique: "🔴",
              majeur: "🟠",
              mineur: "🟡",
              suggestion: "🔵",
            }[args.severity] ?? "⚪";

            const formattedComment =
              `${emoji} **[${args.severity.toUpperCase()}]** — Code Review IA\n\n` +
              `${args.comment}`;

            await azureClient.postComment(args.file_path, args.line, formattedComment);
            postedComments++;
            result = `Commentaire posté sur ${args.file_path}:${args.line}`;
            break;
          }

          // ── Poster un commentaire général ──
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

      // Ajout des résultats des tools à l'historique
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
    console.error(`❌ Variables manquantes : ${missing.join(", ")}`);
    process.exit(1);
  }

  // 1. Registre des skills (noms connus, contenu NON chargé)
  const skillRegistry = buildSkillRegistry(SKILLS_DIR);
  console.log(`📂 ${Object.keys(skillRegistry).length} skill(s) référencé(s) (chargement à la demande).`);

  // 2. Copilot instructions (toujours chargées, quoi qu'il arrive)
  const copilotInstructions = readCopilotInstructions();

  // 3. Construction des tools OpenAI
  const tools = buildTools(skillRegistry);

  // 4. Initialisation OpenAI
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  // 5. Création du client Azure DevOps
  const azureClient = createAzureClient({
    pat: AZURE_DEVOPS_PAT,
    org: AZURE_DEVOPS_ORG,
    project: AZURE_DEVOPS_PROJECT,
    repo: AZURE_DEVOPS_REPO,
    prId: AZURE_DEVOPS_PR_ID,
  });

  // 6. Infos PR & changements
  console.log(`\n🔍 Récupération de la PR #${AZURE_DEVOPS_PR_ID}...`);
  const prInfo = await azureClient.getPRInfo();
  console.log(`   📋 ${prInfo.title}`);

  const iterationId = await azureClient.getLastIterationId();
  const changes = await azureClient.getPRChanges(iterationId);

  const codeExtensions = /\.(js|ts|jsx|tsx|py|cs|java|go|rb|php|cpp|c|h|sql|yaml|yml|json|xml|sh|ps1)$/i;
  const filesToReview = changes.filter(
    (c) => c.item?.path && codeExtensions.test(c.item.path) && c.changeType !== 32
  );

  console.log(`\n📝 ${filesToReview.length} fichier(s) à reviewer.\n`);
  if (filesToReview.length === 0) return;

  // 7. Review agentique fichier par fichier
  let totalComments = 0;

  for (const change of filesToReview) {
    const filePath = change.item.path.replace(/^\//, "");
    const content = await azureClient.getFileContent(filePath, prInfo.sourceCommitId);
    if (!content) {
      console.log(`⏭️  ${filePath} — contenu inaccessible, ignoré.`);
      continue;
    }
    const count = await reviewFileAgentLoop(openai, tools, skillRegistry, azureClient, copilotInstructions, filePath, content);
    totalComments += count;
  }

  // 8. Résumé final
  const loadedSkills = Object.entries(skillRegistry)
    .filter(([, s]) => s.loaded)
    .map(([name]) => name);

  await azureClient.postGeneralComment(
    `## 🤖 Code Review IA — Résumé final

| | |
|---|---|
| 📁 Fichiers analysés | ${filesToReview.length} |
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
