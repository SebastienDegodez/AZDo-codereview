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
 * Retourne un tableau de { name: string, content: string }
 */
function readFilesFromDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    console.warn(`⚠️  Dossier introuvable : ${dirPath}`);
    return [];
  }
  const files = fs.readdirSync(dirPath).filter((f) => {
    const fullPath = path.join(dirPath, f);
    return fs.statSync(fullPath).isFile();
  });

  return files.map((file) => ({
    name: file,
    content: fs.readFileSync(path.join(dirPath, file), "utf-8"),
  }));
}

/**
 * Construit les outils (function calling) pour le chargement progressif des skills.
 * Chaque skill est exposé comme un outil que le modèle peut appeler pour en obtenir le contenu.
 */
function buildSkillTools(skills) {
  return skills.map((skill) => ({
    type: "function",
    function: {
      name: `load_skill_${skill.name.replace(/[^a-zA-Z0-9_]/g, "_")}`,
      description: `Charge le contenu du skill "${skill.name}" pour l'utiliser dans la review.`,
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  }));
}

/**
 * Construit le contexte système de base avec les instructions.
 */
function buildSystemPrompt(instructions) {
  let system = `Tu es un expert en code review. Tu analyses des Pull Requests et fournis des commentaires précis, constructifs et en français.\n\n`;

  if (instructions.length > 0) {
    system += `## Instructions supplémentaires\n`;
    for (const { name, content } of instructions) {
      system += `### ${name}\n${content}\n\n`;
    }
  }

  system += `\nDes skills spécialisés sont disponibles via les outils fournis. Appelle-les si tu as besoin de règles spécifiques pour analyser le code.\n`;
  system += `\nPour chaque problème identifié, indique :
- **Fichier** et **ligne(s)** concerné(s)
- **Sévérité** : critique | majeur | mineur | suggestion
- **Description** du problème
- **Suggestion** de correction si possible`;

  return system;
}

// ─── OpenAI Review avec chargement progressif des skills ─────────────────────

/**
 * Envoie le diff d'un fichier à OpenAI avec function calling pour les skills.
 * Le modèle charge les skills progressivement selon ses besoins.
 */
async function reviewFileWithOpenAI(openai, systemPrompt, filePath, diffContent, skills) {
  const tools = buildSkillTools(skills);

  const skillMap = Object.fromEntries(
    skills.map((s) => [`load_skill_${s.name.replace(/[^a-zA-Z0-9_]/g, "_")}`, s.content])
  );

  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Voici le contenu du fichier modifié dans la Pull Request :

**Fichier :** \`${filePath}\`

\`\`\`
${diffContent}
\`\`\`

Analyse ce code et liste tous les problèmes que tu détectes. Si nécessaire, utilise les outils disponibles pour charger les skills pertinents.
Si le code est correct, réponds uniquement : "✅ Aucun problème détecté."`,
    },
  ];

  // Boucle d'agentic : le modèle peut appeler des tools pour charger des skills
  let response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? "auto" : undefined,
    temperature: 0.2,
  });

  while (response.choices[0].finish_reason === "tool_calls") {
    const assistantMessage = response.choices[0].message;
    messages.push(assistantMessage);

    // Résoudre chaque tool call
    const toolResults = assistantMessage.tool_calls.map((call) => {
      const skillContent = skillMap[call.function.name];
      console.log(`   📦 Chargement du skill : ${call.function.name}`);
      return {
        role: "tool",
        tool_call_id: call.id,
        content: skillContent ?? `Skill "${call.function.name}" introuvable.`,
      };
    });

    messages.push(...toolResults);

    // Relancer le modèle avec les skills chargés
    response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined,
      temperature: 0.2,
    });
  }

  return response.choices[0].message.content;
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

  // 1. Lecture des fichiers de contexte
  console.log("📂 Lecture des skills et instructions...");
  const skills = readFilesFromDir(SKILLS_DIR);
  const instructions = readFilesFromDir(INSTRUCTIONS_DIR);
  console.log(
    `   ✅ ${skills.length} skill(s), ${instructions.length} instruction(s) chargé(s).`
  );

  // 2. Construction du prompt système (instructions uniquement)
  const systemPrompt = buildSystemPrompt(instructions);

  // 3. Initialisation OpenAI
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  // 4. Récupération des infos PR
  console.log(`\n🔍 Récupération de la PR #${process.env.AZURE_DEVOPS_PR_ID}...`);
  const prInfo = await getPRInfo();
  console.log(`   📋 Titre : ${prInfo.title}`);

  // 5. Récupération des changements
  const iterationId = await getLastIterationId();
  const changes = await getPRChanges(iterationId);
  const codeExtensions = /\.(js|ts|jsx|tsx|py|cs|java|go|rb|php|cpp|c|h|sql|yaml|yml|json|xml|sh|ps1)$/i;
  const filesToReview = changes.filter(
    (c) => c.item?.path && codeExtensions.test(c.item.path) && c.changeType !== 32
  );

  console.log(`\n📝 ${filesToReview.length} fichier(s) à reviewer.\n`);

  if (filesToReview.length === 0) {
    console.log("ℹ️  Aucun fichier de code à analyser.");
    return;
  }

  // 6. Review de chaque fichier avec chargement progressif des skills
  const allReviews = [];

  for (const change of filesToReview) {
    const filePath = change.item.path.replace(/^\//, "");
    console.log(`🔎 Analyse de : ${filePath}`);

    const content = await getFileContent(filePath, prInfo.sourceCommitId);
    if (!content) {
      console.log(`   ⏭️  Impossible de récupérer le contenu, fichier ignoré.`);
      continue;
    }

    const reviewText = await reviewFileWithOpenAI(openai, systemPrompt, filePath, content, skills);

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

  // 7. Résumé global
  const issueCount = allReviews.filter((r) => r.status === "issues").length;
  const okCount = allReviews.filter((r) => r.status === "ok").length;

  const summary = `## 🤖 Résumé de la Code Review IA

| Statut | Fichiers |
|--------|----------|
| ✅ OK | ${okCount} |
| ⚠️ Problèmes | ${issueCount} |
| 📋 Total | ${allReviews.length} |

> Analyse effectuée par OpenAI (gpt-4o) avec les instructions du dossier \`.github/skills\` et \`.github/instruction\`.`;

  await postGeneralComment(summary);
  console.log("\n✅ Code review terminée !");
}

main().catch((err) => {
  console.error("❌ Erreur fatale :", err.message);
  process.exit(1);
});
