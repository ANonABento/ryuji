import type { Interaction, Message } from "discord.js";
import type { Plugin, PluginContext } from "@choomfie/shared";

export async function initializePlugins(
  plugins: Plugin[],
  ctx: PluginContext,
): Promise<void> {
  for (const plugin of plugins) {
    if (!plugin.init) continue;
    try {
      await plugin.init(ctx);
      console.error(`Plugin initialized: ${plugin.name}`);
    } catch (e) {
      console.error(`Plugin ${plugin.name} init failed: ${e}`);
    }
  }
}

export async function dispatchPluginMessage(
  plugins: Plugin[],
  message: Message,
  ctx: PluginContext,
): Promise<void> {
  for (const plugin of plugins) {
    if (!plugin.onMessage) continue;
    try {
      await plugin.onMessage(message, ctx);
    } catch (e) {
      console.error(`Plugin ${plugin.name} onMessage error: ${e}`);
    }
  }
}

export async function dispatchPluginInteraction(
  plugins: Plugin[],
  interaction: Interaction,
  ctx: PluginContext,
): Promise<void> {
  for (const plugin of plugins) {
    if (!plugin.onInteraction) continue;
    try {
      await plugin.onInteraction(interaction, ctx);
    } catch (e) {
      console.error(`Plugin ${plugin.name} onInteraction error: ${e}`);
    }
  }
}

export async function destroyPlugins(plugins: Plugin[]): Promise<void> {
  for (const plugin of plugins) {
    if (!plugin.destroy) continue;
    try {
      await plugin.destroy();
    } catch {}
  }
}
