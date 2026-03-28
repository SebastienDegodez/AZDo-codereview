import { OpenAI } from "openai";
import { ReviewComment } from "../domain/ReviewComment.js";

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

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await openai.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.1,
        parallel_tool_calls: false,
      });

      const choice = response.choices[0];
      messages.push(choice.message);

      if (choice.finish_reason === "stop") break;

      if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
        const toolResults = processToolCalls(choice.message.tool_calls, {
          availableSkills,
          loadSkill,
          comments,
        });
        messages.push(...toolResults);
      }
    }

    return comments;
  }

  return { reviewFile };
}

// ── internal helpers ──

function buildTools(availableSkills) {
  return [
    {
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

function buildMessages({ filePath, fileContent, instructionContext, copilotInstructions }) {
  const copilotBlock = copilotInstructions
    ? `### Copilot Instructions\n${copilotInstructions}\n\n`
    : "";

  const systemPrompt = `Tu es un expert en code review. Tu analyses des Pull Requests et fournis des commentaires précis, constructifs et en français.

Tu as accès à des skills de coding via le tool "load_skill". 
Commence par appeler "list_available_skills" pour découvrir les skills disponibles, puis charge ceux qui sont pertinents pour le fichier analysé.
Une fois ton analyse terminée, publie tes commentaires via "post_review_comment" (un appel par problème) et termine par un résumé avec "post_general_comment".

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

      case "load_skill":
        result = loadSkill(args.skill_name)
          ? `Contenu du skill "${args.skill_name}" :\n\n${loadSkill(args.skill_name)}`
          : `❌ Skill "${args.skill_name}" introuvable.`;
        break;

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
