/**
 * Module management tools — list, switch modules.
 */

import type { ToolDef } from "@choomfie/shared";
import { text, err } from "@choomfie/shared";
import { getSession, setModule, getActiveModule } from "../core/session.ts";
import { getModule, listModules } from "../modules/index.ts";

export const moduleTools: ToolDef[] = [
  {
    definition: {
      name: "list_modules",
      description: "List all available tutor modules (subjects that can be studied).",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    handler: async (_args, _ctx) => {
      const mods = listModules();
      const formatted = mods
        .map(
          (m) =>
            `${m.icon || "📚"} **${m.displayName}** (\`${m.name}\`) — ${m.description}\n  Levels: ${m.levels.join(", ")}`
        )
        .join("\n\n");
      return text(formatted);
    },
  },
  {
    definition: {
      name: "switch_module",
      description: "Switch which module (subject) the student is studying.",
      inputSchema: {
        type: "object" as const,
        properties: {
          user_id: { type: "string", description: "Discord user ID" },
          module: {
            type: "string",
            description: "Module to switch to (e.g. japanese, trivia)",
          },
        },
        required: ["user_id", "module"],
      },
    },
    handler: async (args, _ctx) => {
      const moduleName = (args.module as string).toLowerCase();
      try {
        const mod = getModule(moduleName);
        const userId = args.user_id as string;
        setModule(userId, moduleName, mod.defaultLevel);
        const session = getSession(userId);
        const level = session.modules[moduleName]?.level ?? mod.defaultLevel;
        return text(
          `Switched to ${mod.icon || "📚"} **${mod.displayName}**. Level: ${level}`
        );
      } catch (e: any) {
        return err(e.message);
      }
    },
  },
];
