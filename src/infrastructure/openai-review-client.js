import { OpenAI } from "openai";
import { ReviewComment } from "../domain/ReviewComment.js";
import { CodeRange } from "../domain/CodeRange.js";
import { logger } from "./logger.js";

/**
 * Infrastructure adapter — OpenAI chat completion client for code review.
 *
 * Wraps the OpenAI API behind a domain-friendly interface:
 *   - Builds tool definitions from available skills
 *   - Runs the agentic loop (tool_calls ↔ tool results) until the model stops
 *   - Returns structured ReviewComment[] for each reviewed file
 *
 * @param {object} deps
 * @param {string} deps.apiKey — OpenAI API key
 * @param {string} [deps.model] — model name (default "gpt-4o")
 * @param {string} [deps.baseURL] — override base URL (useful for Microcks mock)
 * @param {object} [deps.openaiInstance] — pre-built OpenAI instance (useful for testing)
 * @returns {{ reviewFile(params): Promise<ReviewComment[]> }}
 */
export function createOpenAIReviewClient({ apiKey, model = "gpt-4o", baseURL, openaiInstance } = {}) {
  const openai = openaiInstance ?? new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

  /**
   * Review a single file using an agentic loop.
   *
   * @param {object} params
   * @param {string} params.filePath
   * @param {(path: string) => Promise<string|null>} [params.loadFileContent] — reads full file content
   * @param {(path: string) => Promise<string|null>} [params.getFileDiff] — reads the PR diff for the file
   * @param {string[]} params.availableSkills
   * @param {(name: string) => string|null} params.loadSkill
   * @param {string} [params.instructionContext]
   * @param {string} [params.copilotInstructions]
   * @returns {Promise<ReviewComment[]>}
   */
  async function reviewFile({
    filePath,
    loadFileContent = async () => null,
    getFileDiff = async () => null,
    availableSkills,
    loadSkill,
    instructionContext = "",
    copilotInstructions = "",
  }) {
    const tools = buildTools(availableSkills);
    const messages = buildMessages({ filePath, instructionContext, copilotInstructions });

    const comments = [];
    let iterations = 0;
    const MAX_ITERATIONS = 20;

    logger.info(`Reviewing file: ${filePath}`);

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      logger.verbose(`OpenAI agentic loop iteration ${iterations} for ${filePath}`);

      const response = await callWithRateLimitRetry(
        () => openai.chat.completions.create({
          model,
          messages,
          tools,
          // Force tool usage on the first two iterations so the model cannot
          // respond with plain text (finish_reason "stop") before reviewing.
          tool_choice: iterations <= 2 ? "required" : "auto",
          temperature: 0.1,
          parallel_tool_calls: false,
        }),
        filePath,
      );

      const choice = response.choices[0];

      // ── Diagnostic logging ──
      logger.verbose(`Response finish_reason: ${choice.finish_reason}`);
      if (choice.message.content) {
        logger.verbose(`Model text response (first 500 chars): ${choice.message.content.substring(0, 500)}`);
      }
      if (choice.message.tool_calls) {
        logger.verbose(`Tool calls: ${JSON.stringify(choice.message.tool_calls.map(toolCall => ({
          name: toolCall.function.name,
          args: toolCall.function.arguments?.substring(0, 200)
        })))}`);
      }
      if (response.usage) {
        logger.verbose(`Token usage: prompt=${response.usage.prompt_tokens}, completion=${response.usage.completion_tokens}, total=${response.usage.total_tokens}`);
      }

      messages.push(choice.message);

      if (choice.finish_reason === "stop") {
        if (comments.length === 0) {
          logger.warn(`⚠️ Model stopped with 0 comments for ${filePath}. Text content: ${choice.message.content?.substring(0, 300) ?? "(empty)"}`);
        }
        logger.verbose(`Model finished for ${filePath} after ${iterations} iteration(s)`);
        break;
      } else if (choice.finish_reason === "tool_calls") {
        if (!choice.message.tool_calls?.length) {
          logger.warn(`Model returned finish_reason "tool_calls" but no tool_calls for ${filePath} — stopping`);
          break;
        }
        logger.verbose(`Tool calls requested: ${choice.message.tool_calls.map((toolCall) => toolCall.function.name).join(", ")}`);
        const toolResults = await processToolCalls(choice.message.tool_calls, {
          availableSkills,
          loadSkill,
          loadFileContent,
          getFileDiff,
          comments,
        });
        messages.push(...toolResults);
      } else {
        logger.warn(`Unexpected finish_reason "${choice.finish_reason}" for ${filePath} — stopping`);
        break;
      }
    }

    logger.info(`File reviewed: ${filePath} — ${comments.length} comment(s) generated`);
    return comments;
  }

  return { reviewFile };
}

// ── internal helpers ──

function buildTools(availableSkills) {
  const tools = [];

  if (availableSkills.length > 0) {
    tools.push({
      type: "function",
      function: {
        name: "load_skill",
        description: "Charge le contenu d'un skill de coding disponible.",
        parameters: {
          type: "object",
          properties: {
            skill_name: {
              type: "string",
              enum: availableSkills,
              description: "Nom exact du fichier skill à charger.",
            },
          },
          required: ["skill_name"],
        },
      },
    });
  }

  tools.push(
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Lit le contenu complet d'un fichier à l'état courant (commit source de la PR).",
        parameters: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Chemin du fichier à lire (ex: /src/app.js)" },
          },
          required: ["file_path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_commit_diff",
        description: "Retourne le diff d'un fichier entre la branche cible et la branche source de la PR.",
        parameters: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Chemin du fichier (ex: /src/app.js)" },
          },
          required: ["file_path"],
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
        description: "Publie un commentaire de code review sur un fichier. Utilise end_line pour cibler un bloc de lignes. Utilise start_column et end_column pour mettre en évidence précisément la portion de code problématique. Utilise suggestion pour proposer du code de remplacement.",
        parameters: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Chemin du fichier" },
            line: { type: "integer", description: "Numéro de la première ligne concernée" },
            end_line: { type: "integer", description: "Numéro de la dernière ligne concernée (optionnel, si le commentaire porte sur plusieurs lignes)" },
            start_column: { type: "integer", description: "Colonne de début dans la première ligne (optionnel, 1-indexé). Permet de cibler précisément la portion de code problématique." },
            end_column: { type: "integer", description: "Colonne de fin dans la dernière ligne (optionnel, 1-indexé). Permet de cibler précisément la fin de la portion de code problématique." },
            severity: {
              type: "string",
              enum: ["critique", "majeur", "mineur", "suggestion"],
            },
            comment: { type: "string", description: "Commentaire détaillé" },
            suggestion: { type: "string", description: "Code de remplacement proposé (optionnel). Ce code remplacera les lignes sélectionnées (de line à end_line)." },
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
  );

  return tools;
}

function buildMessages({ filePath, instructionContext, copilotInstructions }) {
  const copilotBlock = copilotInstructions
    ? `### Copilot Instructions\n${copilotInstructions}\n\n`
    : "";

  const systemPrompt = `Tu es un expert en code review. Tu analyses des Pull Requests et fournis des commentaires précis, constructifs et en français.

Tu as accès à des tools pour lire le code à analyser :
- "read_file" : pour lire le contenu complet du fichier modifié (état du commit source de la PR)
- "get_commit_diff" : pour obtenir le diff du fichier (changements apportés par la PR)

Tu DOIS commencer par appeler "read_file" ou "get_commit_diff" pour obtenir le code à analyser avant de publier des commentaires.

IMPORTANT sur les numéros de ligne : le contenu retourné par "read_file" affiche chaque ligne précédée de son numéro exact (format : " N | code"). Tu DOIS utiliser ces numéros directement dans "line" et "end_line" sans les recalculer ni les déduire.

Tu as accès à des skills de coding optionnels via le tool "load_skill".
Tu PEUX appeler "list_available_skills" pour découvrir si des skills sont disponibles. Si oui, charge ceux qui sont pertinents. Si aucun skill n'est disponible, effectue la review avec ton expertise propre.

Tu DOIS OBLIGATOIREMENT analyser le code en profondeur et publier tes commentaires via "post_review_comment" (un appel par problème trouvé).
Cherche des problèmes de : sécurité, performance, maintenabilité, lisibilité, gestion d'erreurs, conventions de nommage, bonnes pratiques du langage.

Si le code te semble correct, cherche quand même des améliorations possibles (suggestions de refactoring, documentation manquante, typage, etc.) et publie-les avec la sévérité "suggestion".

Tu DOIS TOUJOURS utiliser "post_review_comment" au moins une fois avant d'appeler "post_general_comment".
Tu ne dois JAMAIS répondre par du texte libre. Tu dois UNIQUEMENT communiquer via les tools disponibles.

Une fois TOUS tes commentaires publiés, termine par un résumé avec "post_general_comment".

IMPORTANT : Ne passe JAMAIS directement à "post_general_comment" sans avoir d'abord analysé le code et publié des commentaires via "post_review_comment".

${copilotBlock}${instructionContext}

Format de chaque commentaire :
- Sévérité indiquée
- Description claire du problème
- Suggestion de correction concrète
- Utilise "end_line" quand le commentaire concerne un bloc de plusieurs lignes (ex: une fonction entière, un bloc if/else, etc.)
- Utilise "start_column" et "end_column" pour mettre en évidence précisément la portion de code problématique dans la ligne (ex: le nom d'une variable, un opérateur, une valeur littérale)
- Utilise "suggestion" pour proposer du code de remplacement concret qui remplacera les lignes sélectionnées (de line à end_line)`;

  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Analyse ce fichier de la Pull Request et publie tes commentaires via les tools disponibles.\n\n**Fichier :** \`${filePath}\`\n\nCommence par appeler \`read_file\` ou \`get_commit_diff\` pour obtenir le code à analyser.`,
    },
  ];
}

async function processToolCalls(toolCalls, context) {
  const results = [];
  for (const toolCall of toolCalls) {
    results.push(await toToolResult(toolCall, context));
  }
  return results;
}

async function toToolResult(toolCall, context) {
  const args = JSON.parse(toolCall.function.arguments);
  const content = await callTool(toolCall.function.name, args, context);
  return { role: "tool", tool_call_id: toolCall.id, content };
}

async function callTool(name, args, context) {
  if (name === "read_file") return readFileTool(args.file_path, context.loadFileContent);
  if (name === "get_commit_diff") return getCommitDiffTool(args.file_path, context.getFileDiff);
  if (name === "list_available_skills") return listAvailableSkillsTool(context.availableSkills);
  if (name === "load_skill") return loadSkillTool(args.skill_name, context.loadSkill);
  if (name === "post_review_comment") return postReviewCommentTool(args, context.comments);
  if (name === "post_general_comment") return "Commentaire général noté.";
  return `Tool inconnu : ${name}`;
}

async function readFileTool(filePath, loadFileContent) {
  const content = await loadFileContent(filePath);
  if (!content) return `❌ Fichier "${filePath}" inaccessible.`;
  const truncated = content.length > 12000 ? content.slice(0, 12000) + "\n... [tronqué]" : content;
  const numbered = addLineNumbers(truncated);
  return `Contenu du fichier "${filePath}" :\n\n${numbered}`;
}

function addLineNumbers(content) {
  const lines = content.split("\n");
  const width = String(lines.length).length;
  return lines
    .map((line, index) => `${String(index + 1).padStart(width)} | ${line}`)
    .join("\n");
}

async function getCommitDiffTool(filePath, getFileDiff) {
  const diff = await getFileDiff(filePath);
  return diff
    ? `Diff du fichier "${filePath}" :\n\n${diff}`
    : `❌ Diff non disponible pour "${filePath}".`;
}

function listAvailableSkillsTool(availableSkills) {
  return availableSkills.length > 0
    ? `Skills disponibles : ${availableSkills.join(", ")}`
    : "Aucun skill disponible.";
}

function loadSkillTool(skillName, loadSkill) {
  const skillContent = loadSkill(skillName);
  return skillContent
    ? `Contenu du skill "${skillName}" :\n\n${skillContent}`
    : `❌ Skill "${skillName}" introuvable.`;
}

// ── Rate-limit retry helpers ──

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeRetryDelay(err, attemptIndex) {
  const retryAfterHeader = err.headers?.["retry-after"];
  const retryAfterSeconds = parseInt(retryAfterHeader ?? "", 10);
  if (!isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  return 5_000 * Math.pow(2, attemptIndex);
}

function logApiError(err, filePath) {
  if (err.status !== undefined) {
    logger.error(`OpenAI API error [${err.status}] while reviewing ${filePath} — ${err.message}`);
  } else {
    logger.error(`OpenAI API error while reviewing ${filePath} — ${err.message}`);
  }
}

async function callWithRateLimitRetry(apiCall, filePath, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (err) {
      if (err.status !== 429 || attempt >= maxRetries) {
        logApiError(err, filePath);
        throw err;
      }
      const delayMs = computeRetryDelay(err, attempt);
      logger.warn(`OpenAI rate limit [429] for ${filePath} — retry ${attempt + 1}/${maxRetries} in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
}

function postReviewCommentTool(args, comments) {
  const hasColumns = args.start_column != null && args.end_column != null;
  const codeRange = hasColumns ? new CodeRange({ start: args.start_column, end: args.end_column }) : null;
  comments.push(new ReviewComment({
    filePath: args.file_path,
    line: args.line,
    endLine: args.end_line,
    codeRange,
    severity: args.severity,
    comment: args.comment,
    suggestion: args.suggestion,
  }));
  const lineRange = args.end_line ? `${args.line}-${args.end_line}` : `${args.line}`;
  return `Commentaire posté sur ${args.file_path}:${lineRange}`;
}
