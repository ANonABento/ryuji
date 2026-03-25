/**
 * Language learning tools — tutor, dictionary, quiz, level setting.
 */

import type { ToolDef } from "../../lib/types.ts";
import { text, err } from "../../lib/types.ts";
import { getLanguageModule, listLanguages } from "./languages/index.ts";
import { getSession, setLevel, setLanguage } from "./session.ts";

export const languageLearningTools: ToolDef[] = [
  {
    definition: {
      name: "tutor_prompt",
      description:
        "Get the tutor system prompt for the current language and level. Use this to understand how to tutor the student.",
      inputSchema: {
        type: "object" as const,
        properties: {
          user_id: {
            type: "string",
            description: "Discord user ID",
          },
        },
        required: ["user_id"],
      },
    },
    handler: async (args, ctx) => {
      const session = getSession(args.user_id as string);
      const langModule = getLanguageModule(session.language);
      const prompt = langModule.buildTutorPrompt(session.level);
      return text(prompt);
    },
  },
  {
    definition: {
      name: "dictionary_lookup",
      description:
        "Look up a word in the dictionary for the current language. Returns readings, meanings, and level.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description:
              "Word to look up (in target language, romaji, or English)",
          },
          language: {
            type: "string",
            description:
              "Language to look up in (default: user's current language)",
          },
        },
        required: ["query"],
      },
    },
    handler: async (args, ctx) => {
      const langName = (args.language as string) || "japanese";
      const langModule = getLanguageModule(langName);

      try {
        const entries = await langModule.lookup(args.query as string);
        if (entries.length === 0) {
          return text(`No results found for "${args.query}"`);
        }

        const formatted = entries
          .map((e) => {
            const level = e.level ? ` [${e.level}]` : "";
            const pos = e.partOfSpeech.length > 0
              ? ` (${e.partOfSpeech.join(", ")})`
              : "";
            return `**${e.word}** (${e.reading})${level}${pos}\n  ${e.meanings.join("; ")}`;
          })
          .join("\n\n");

        return text(formatted);
      } catch (e: any) {
        return err(`Dictionary error: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "quiz",
      description:
        "Generate a quiz question for the student. Types: reading (kana), vocab, grammar.",
      inputSchema: {
        type: "object" as const,
        properties: {
          user_id: {
            type: "string",
            description: "Discord user ID",
          },
          type: {
            type: "string",
            enum: ["reading", "vocab", "grammar"],
            description: "Quiz type (default: random)",
          },
        },
        required: ["user_id"],
      },
    },
    handler: async (args, ctx) => {
      const session = getSession(args.user_id as string);
      const langModule = getLanguageModule(session.language);
      const quizType =
        (args.type as string) ||
        ["reading", "vocab", "grammar"][Math.floor(Math.random() * 3)];

      const q = langModule.generateQuiz(
        session.level,
        quizType as "reading" | "vocab" | "grammar"
      );

      const optionLines = q.options
        .map((o, i) => `${["A", "B", "C", "D"][i]}. ${o}`)
        .join("\n");

      const answer = ["A", "B", "C", "D"][q.correctIndex];

      return text(
        [
          `**Quiz (${quizType})**`,
          "",
          q.question,
          "",
          optionLines,
          "",
          `||Answer: ${answer}. ${q.explanation}||`,
        ].join("\n")
      );
    },
  },
  {
    definition: {
      name: "set_language_level",
      description:
        "Set the student's proficiency level for their current language.",
      inputSchema: {
        type: "object" as const,
        properties: {
          user_id: {
            type: "string",
            description: "Discord user ID",
          },
          level: {
            type: "string",
            description:
              "Proficiency level (e.g. N5, N4, N3, N2, N1 for Japanese)",
          },
        },
        required: ["user_id", "level"],
      },
    },
    handler: async (args, ctx) => {
      const session = getSession(args.user_id as string);
      const langModule = getLanguageModule(session.language);
      const level = (args.level as string).toUpperCase();

      if (!langModule.levels.includes(level)) {
        return err(
          `Invalid level "${level}" for ${langModule.displayName}. Available: ${langModule.levels.join(", ")}`
        );
      }

      setLevel(args.user_id as string, level);
      return text(
        `Set ${langModule.displayName} level to **${level}**. Tutor will adjust difficulty accordingly.`
      );
    },
  },
  {
    definition: {
      name: "set_study_language",
      description:
        "Switch which language the student is studying.",
      inputSchema: {
        type: "object" as const,
        properties: {
          user_id: {
            type: "string",
            description: "Discord user ID",
          },
          language: {
            type: "string",
            description: "Language to study (e.g. japanese, chinese)",
          },
        },
        required: ["user_id", "language"],
      },
    },
    handler: async (args, ctx) => {
      const langName = (args.language as string).toLowerCase();
      // Validate language exists
      getLanguageModule(langName);
      setLanguage(args.user_id as string, langName);
      const langModule = getLanguageModule(langName);
      return text(
        `Switched to **${langModule.displayName}**. Level: ${getSession(args.user_id as string).level}`
      );
    },
  },
  {
    definition: {
      name: "list_languages",
      description: "List all available languages for study.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    handler: async (_args, _ctx) => {
      const langs = listLanguages();
      const formatted = langs
        .map(
          (l) =>
            `**${l.displayName}** (\`${l.name}\`) — Levels: ${l.levels.join(", ")}`
        )
        .join("\n");
      return text(formatted);
    },
  },
];
