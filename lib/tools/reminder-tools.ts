/**
 * Reminder tools — set, list, cancel reminders.
 */

import type { ToolDef } from "../types.ts";
import { text, err } from "../types.ts";

export const reminderTools: ToolDef[] = [
  {
    definition: {
      name: "set_reminder",
      description:
        "Set a reminder that will be posted to the Discord channel at the specified time.",
      inputSchema: {
        type: "object" as const,
        properties: {
          user_id: {
            type: "string",
            description: "Discord user ID to remind",
          },
          chat_id: {
            type: "string",
            description: "Channel ID to post reminder in",
          },
          message: { type: "string", description: "Reminder message" },
          due_at: {
            type: "string",
            description:
              "When to fire the reminder (ISO 8601 UTC, e.g. 2026-03-25T14:30:00Z)",
          },
        },
        required: ["user_id", "chat_id", "message", "due_at"],
      },
    },
    handler: async (args, ctx) => {
      ctx.memory.addReminder(
        args.user_id as string,
        args.chat_id as string,
        args.message as string,
        args.due_at as string
      );
      return text(`Reminder set for ${args.due_at}: ${args.message}`);
    },
  },
  {
    definition: {
      name: "list_reminders",
      description: "List active (unfired) reminders.",
      inputSchema: {
        type: "object" as const,
        properties: {
          user_id: {
            type: "string",
            description: "Filter by user (optional)",
          },
        },
      },
    },
    handler: async (args, ctx) => {
      const reminders = ctx.memory.getActiveReminders(
        args.user_id as string | undefined
      );
      if (reminders.length === 0) return text("No active reminders.");
      const formatted = reminders
        .map((r) => `- [#${r.id}] ${r.message} (due: ${r.dueAt})`)
        .join("\n");
      return text(formatted);
    },
  },
  {
    definition: {
      name: "cancel_reminder",
      description: "Cancel a reminder by ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Reminder ID" },
        },
        required: ["id"],
      },
    },
    handler: async (args, ctx) => {
      const success = ctx.memory.cancelReminder(args.id as number);
      return success
        ? text(`Reminder #${args.id} cancelled.`)
        : err(
            `Reminder #${args.id} not found or already fired.`
          );
    },
  },
];
