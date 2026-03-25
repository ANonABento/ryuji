/**
 * Persona tools — switch, save, list, delete personas.
 */

import type { ToolDef } from "../types.ts";
import { text, err } from "../types.ts";

export const personaTools: ToolDef[] = [
  {
    definition: {
      name: "switch_persona",
      description:
        "Switch to a different persona. Changes name and personality.",
      inputSchema: {
        type: "object" as const,
        properties: {
          key: {
            type: "string",
            description: "Persona key (e.g. 'takagi', 'choomfie')",
          },
        },
        required: ["key"],
      },
    },
    handler: async (args, ctx) => {
      const persona = ctx.config.switchPersona(args.key as string);
      if (!persona) {
        const available = ctx.config
          .listPersonas()
          .map((p) => p.key)
          .join(", ");
        return err(
          `Persona "${args.key}" not found. Available: ${available}`
        );
      }
      return text(
        `Switched to **${persona.name}**. Restart the session for full effect.\nPersonality: ${persona.personality}`
      );
    },
  },
  {
    definition: {
      name: "save_persona",
      description: "Create or update a persona preset.",
      inputSchema: {
        type: "object" as const,
        properties: {
          key: {
            type: "string",
            description:
              "Unique key for the persona (lowercase, e.g. 'pirate')",
          },
          name: {
            type: "string",
            description: "Display name (e.g. 'Captain Jack')",
          },
          personality: {
            type: "string",
            description:
              "Personality description (e.g. 'Talk like a pirate, arrr.')",
          },
        },
        required: ["key", "name", "personality"],
      },
    },
    handler: async (args, ctx) => {
      ctx.config.savePersona(
        args.key as string,
        args.name as string,
        args.personality as string
      );
      return text(
        `Persona "${args.key}" saved: ${args.name} — ${args.personality}`
      );
    },
  },
  {
    definition: {
      name: "list_personas",
      description: "List all available personas.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    handler: async (_args, ctx) => {
      const personas = ctx.config.listPersonas();
      const formatted = personas
        .map(
          (p) =>
            `${p.active ? "**→** " : "  "}**${p.persona.name}** (\`${p.key}\`): ${p.persona.personality}`
        )
        .join("\n");
      return text(formatted);
    },
  },
  {
    definition: {
      name: "delete_persona",
      description:
        "Delete a persona preset (cannot delete the active one).",
      inputSchema: {
        type: "object" as const,
        properties: {
          key: { type: "string" },
        },
        required: ["key"],
      },
    },
    handler: async (args, ctx) => {
      const success = ctx.config.deletePersona(args.key as string);
      if (!success)
        return err(
          `Cannot delete "${args.key}" — either it's the active persona or it doesn't exist.`
        );
      return text(`Persona "${args.key}" deleted.`);
    },
  },
];
