/**
 * Shared handler utilities — DRY helpers used by both slash commands and modals.
 */

import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { AppContext } from "../types.ts";

/** Check if a Discord user is the owner */
export function isOwner(ctx: AppContext, userId: string): boolean {
  return ctx.ownerUserId ? userId === ctx.ownerUserId : false;
}

/** Check if a Discord user is allowed (on the allowlist or owner) */
export function isAllowed(ctx: AppContext, userId: string): boolean {
  if (ctx.allowedUsers.size === 0) return true; // bootstrap mode
  return ctx.allowedUsers.has(userId);
}

/** Reply with "owner only" error. Returns true if blocked. */
export async function requireOwner(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext
): Promise<boolean> {
  if (isOwner(ctx, interaction.user.id)) return false;
  await interaction.reply({
    content: "This command is owner-only~",
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

interface ReminderOpts {
  userId: string;
  channelId: string;
  message: string;
  dueAt: Date;
  cron?: string;
  nagInterval?: number;
}

/**
 * Create a reminder, schedule its timer, and return a formatted response string.
 * Used by both /remind command and the reminder modal submit handler.
 */
export function createAndScheduleReminder(
  ctx: AppContext,
  opts: ReminderOpts
): string {
  const newId = ctx.memory.addReminder(
    opts.userId,
    opts.channelId,
    opts.message,
    opts.dueAt.toISOString(),
    {
      cron: opts.cron,
      nagInterval: opts.nagInterval,
    }
  );

  const reminder = ctx.memory.getReminder(newId);
  if (reminder) ctx.reminderScheduler.scheduleReminder(reminder);

  const ts = Math.floor(opts.dueAt.getTime() / 1000);
  const parts = [`**Reminder set** for <t:${ts}:R>: ${opts.message}`];
  if (opts.cron) parts.push(`Recurring: ${opts.cron}`);
  if (opts.nagInterval) parts.push(`Nag mode: on (every ${opts.nagInterval}min until done)`);

  return parts.join("\n");
}
