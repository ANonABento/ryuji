/**
 * Persona tools — switch, save, list, delete personas.
 */

import type { ToolDef } from "../types.ts";
import { text, err } from "../types.ts";
import { McpProxy } from "../mcp-proxy.ts";

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
      const localFirst = ctx.config.getLocalFirst();
      const compatNote = persona.model && !localFirst
        ? ` (⚠️ model \`${persona.model}\` set but \`localFirst\` is off — override won't apply)`
        : !persona.model && localFirst
        ? " (ℹ️ localFirst on but no model override — using default local hints)"
        : persona.model
        ? ` (model: \`${persona.model}\`)`
        : "";
      // Auto-restart so the new persona's system prompt takes effect
      if (ctx.mcp instanceof McpProxy) {
        ctx.mcp.requestRestart(`persona switch: ${args.key}`);
      }
      return text(
        `Switched to **${persona.name}**${compatNote}. Restarting to apply new personality...`
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
          model: {
            type: "string",
            description:
              "Optional local model override (e.g. 'llama3.1:8b', 'mistral:7b'). Activates local-model prompt hints when localFirst is enabled.",
          },
        },
        required: ["key", "name", "personality"],
      },
    },
    handler: async (args, ctx) => {
      const model = args.model as string | undefined;
      ctx.config.savePersona(
        args.key as string,
        args.name as string,
        args.personality as string,
        model
      );
      const modelNote = model ? ` (model: \`${model}\`)` : "";
      return text(
        `Persona "${args.key}" saved: ${args.name} — ${args.personality}${modelNote}`
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
      const localFirst = ctx.config.getLocalFirst();
      const formatted = personas
        .map(
          (p) =>
            `${p.active ? "**→** " : "  "}**${p.persona.name}** (\`${p.key}\`)${p.persona.model ? ` [model: \`${p.persona.model}\`]` : ""}: ${p.persona.personality}`
        )
        .join("\n");
      const footer = localFirst ? "\n\n🔧 `localFirst` mode is **on**." : "";
      return text(formatted + footer);
    },
  },
  {
    definition: {
      name: "set_local_first",
      description:
        "Enable or disable localFirst mode. When on, personas with a model override get local-model prompt hints injected into the system prompt (e.g. 'keep responses concise'). Requires worker restart to take effect.",
      inputSchema: {
        type: "object" as const,
        properties: {
          enabled: {
            type: "boolean",
            description: "true to enable localFirst mode, false to disable",
          },
        },
        required: ["enabled"],
      },
    },
    handler: async (args, ctx) => {
      const enabled = args.enabled as boolean;
      ctx.config.setLocalFirst(enabled);
      const status = enabled ? "**on**" : "**off**";
      const hint = enabled
        ? " Personas with a model override will now include local-model prompt hints."
        : " Local-model prompt hints are disabled.";
      return text(`localFirst mode is now ${status}.${hint} Restart for changes to take effect.`);
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
