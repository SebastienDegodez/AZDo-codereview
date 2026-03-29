import { OpenAI } from "openai";
import { ReviewComment } from "../domain/ReviewComment.js";
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
 * @returns {{ reviewFile(params): Promise<ReviewComment[]> }}
 */
export function createOpenAIReviewClient({ apiKey, model = "gpt-4o", baseURL } = {}) {
  const openai = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

  /**
   * Review a single file using an agentic loop.
   *
   * @param {object} params
   * @param {string} params.filePath
   * @param {string} params.fileContent
   * @param {string[]} params.availableSkills
   * @param {(name: string) => string|null} params.loadSkill
   * @param {string} [params.instructionContext]
   * @param {string} [params.copilotInstructions]
   * @returns {Promise<ReviewComment[]>}
   */
  async function reviewFile({
    filePath,
    fileContent,
    availableSkills,
    loadSkill,
    instructionContext = "",
    copilotInstructions = "",
  }) {
    const tools = buildTools(availableSkills);
    const messages = buildMessages({ filePath, fileContent, instructionContext, copilotInstructions });

    const comments = [];
    let iterations = 0;
    const MAX_ITERATIONS = 20;

    logger.info(`Reviewing file: ${filePath}`);

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      logger.verbose(`OpenAI agentic loop iteration ${iterations} for ${filePath}`);

      let response;
      try {
        response = await openai.chat.completions.create({
          model,
          messages,
          tools,
          // Force tool usage on the first two iterations so the model cannot
          // respond with plain text (finish_reason "stop") before reviewing.
          tool_choice: iterations <= 2 ? "required" : "auto",
          temperature: 0.1,
          parallel_tool_calls: false,
        });
      } catch (err) {
        if (err.status !== undefined) {
          logger.error(`OpenAI API error [${err.status}] while reviewing ${filePath} — ${err.message}`);
        } else {
          logger.error(`OpenAI API error while reviewing ${filePath} — ${err.message}`);
        }
        throw err;
      }

      const choice = response.choices[0];

      // ── Diagnostic logging ──
      logger.verbose(`Response finish_reason: ${choice.finish_reason}`);
      if (choice.message.content) {
        logger.verbose(`Model text response (first 500 chars): ${choice.message.content.substring(0, 500)}`);
      }
      if (choice.message.tool_calls) {
        logger.verbose(`Tool calls: ${JSON.stringify(choice.message.tool_calls.map(t => ({
          name: t.function.name,
          args: t.function.arguments?.substring(0, 200)
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
      }

      if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
        logger.verbose(`Tool calls requested: ${choice.message.tool_calls.map((t) => t.function.name).join(", ")}`);
        const toolResults = processToolCalls(choice.message.tool_calls, {
          availableSkills,
          loadSkill,
          comments,
        });
        messages.push(...toolResults);
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
  );

  return tools;
}

function buildMessages({ filePath, fileContent, instructionContext, copilotInstructions }) {
  const copilotBlock = copilotInstructions
    ? `### Copilot Instructions\n${copilotInstructions}\n\n`
    : "";

  const systemPrompt = `Tu es un expert en code review. Tu analyses des Pull Requests et fournis des commentaires précis, constructifs et en français.

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
- Suggestion de correction concrète`;

  const truncated = fileContent.length > 12000
    ? fileContent.slice(0, 12000) + "\n... [tronqué]"
    : fileContent;

  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Analyse ce fichier de la Pull Request et publie tes commentaires via les tools disponibles.\n\n**Fichier :** \`${filePath}\`\n\n\`\`\`\n${truncated}\n\`\`\``,
    },
  ];
}

function processToolCalls(toolCalls, { availableSkills, loadSkill, comments }) {
  return toolCalls.map((toolCall) => {
    const { name, arguments: argsJson } = toolCall.function;
    const args = JSON.parse(argsJson);
    let result;

    switch (name) {
      case "list_available_skills":
        result = availableSkills.length > 0
          ? `Skills disponibles : ${availableSkills.join(", ")}`
          : "Aucun skill disponible.";
        break;

      case "load_skill": {
        const skillContent = loadSkill(args.skill_name);
        result = skillContent
          ? `Contenu du skill "${args.skill_name}" :\n\n${skillContent}`
          : `❌ Skill "${args.skill_name}" introuvable.`;
        break;
      }

      case "post_review_comment":
        comments.push(
          new ReviewComment({
            filePath: args.file_path,
            line: args.line,
            severity: args.severity,
            comment: args.comment,
          })
        );
        result = `Commentaire posté sur ${args.file_path}:${args.line}`;
        break;

      case "post_general_comment":
        result = "Commentaire général noté.";
        break;

      default:
        result = `Tool inconnu : ${name}`;
    }

    return { role: "tool", tool_call_id: toolCall.id, content: result };
  });
}
