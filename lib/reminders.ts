/**
 * Reminder checker — polls for due reminders and sends them to Discord.
 */

import type { TextChannel } from "discord.js";
import type { AppContext } from "./types.ts";

export async function checkReminders(ctx: AppContext) {
  const due = ctx.memory.getDueReminders();
  for (const reminder of due) {
    try {
      const channel = await ctx.discord.channels.fetch(reminder.chatId);
      if (channel?.isTextBased()) {
        await (channel as TextChannel).send(
          `**Reminder** for <@${reminder.userId}>: ${reminder.message}`
        );
      }
      ctx.memory.markReminderFired(reminder.id);
    } catch {
      // Channel not accessible, still mark as fired to avoid spam
      ctx.memory.markReminderFired(reminder.id);
    }
  }
}
