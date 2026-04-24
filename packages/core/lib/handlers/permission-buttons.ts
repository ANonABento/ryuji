import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { registerButtonHandler } from "../interactions.ts";

/** Build Approve/Deny button row for a permission request */
export function buildPermissionButtons(
  requestId: string
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`permission:allow:${requestId}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅"),
    new ButtonBuilder()
      .setCustomId(`permission:deny:${requestId}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("❌")
  );
}

// Reserved prefix: plugins must not register another "permission" handler —
// registerButtonHandler uses Map.set, so a collision silently shadows this one.
registerButtonHandler("permission", async (interaction, parts, ctx) => {
  const action = parts[1];
  const requestId = parts[2];

  if (!requestId || (action !== "allow" && action !== "deny")) {
    await interaction.reply({
      content: "Invalid permission button.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Owner-only: DMs reach only the owner, but enforce here too (defense-in-depth).
  const ownerId = ctx.ownerUserId;
  if (!ownerId || interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "Only the owner can approve permission requests.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Mirrors the text-reply path in discord.ts.
  ctx.mcp?.notification?.({
    method: "notifications/claude/channel/permission",
    params: {
      request_id: requestId,
      behavior: action,
    },
  });

  const decision = action === "allow" ? "✅ Approved" : "❌ Denied";
  await interaction.update({
    content: `~~${interaction.message.content}~~\n${decision}`,
    components: [],
  });
});
