/**
 * PluginContext — minimal context interface plugins code against.
 *
 * When running inside Choomfie, plugins receive the full AppContext (which extends PluginContext).
 * When running standalone, they receive a minimal implementation of this interface.
 */

/** Minimal config interface plugins can depend on (no ConfigManager class import). */
export interface PluginConfig {
  getConfig(): Record<string, any>;
  getEnabledPlugins(): string[];
  getVoiceConfig(): { stt: string; tts: string; ttsSpeed?: number };
  getSocialsConfig(): Record<string, any> | undefined;
}

export interface PluginContext {
  /** Data directory for persistent storage */
  DATA_DIR: string;
  /** Config manager (typed interface, not the class) */
  config: PluginConfig;
  /** MCP server or proxy for sending notifications */
  mcp?: {
    sendNotification?(notification: { method: string; params: any }): void;
  };
  /** Discord client (only if running inside Choomfie) */
  discord?: any;
  /** Owner user ID (for permission checks) */
  ownerUserId?: string | null;
}
