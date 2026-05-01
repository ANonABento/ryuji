/**
 * Config manager — personas, settings, presets.
 *
 * Stored in config.json alongside the database.
 * Personas define how the bot behaves (personality, name, tone).
 * Settings control bot behavior (rate limits, triggers, etc.).
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { SocialsPlatformConfig } from "@choomfie/shared";

export interface Persona {
  name: string;
  personality: string;
  /** Local model override (e.g. "llama3.1:8b", "mistral:7b"). Activates local-model prompt hints. */
  model?: string;
}

export interface VoiceConfig {
  stt: string;
  tts: string;
  ttsSpeed?: number; // 0.5 to 2.0 (default 1.0)
}

export type LlmProvider = "claude" | "ollama" | string;
export type EmbeddingsProvider = "none" | "local" | string;

export interface SocialsConfig {
  youtube?: {
    apiKey?: string;       // Optional — for YouTube Data API v3 reads (fallback to yt-dlp)
    clientId?: string;     // Optional — for OAuth (comments)
    clientSecret?: string; // Optional — for OAuth (comments)
    [key: string]: string | undefined;
  };
  linkedin?: {
    clientId: string;
    clientSecret: string;
    [key: string]: string;
  };
  reddit?: {
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
    [key: string]: string;
  };
  [key: string]: { [k: string]: string | undefined } | undefined;
}

export type LlmProvider = "anthropic" | "openai" | "ollama" | "lmstudio";

export interface LlmConfig {
  provider: LlmProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface Config {
  provider: "claude" | "ollama";
  ollama_model: string;
  activePersona: string;
  personas: Record<string, Persona>;
  rateLimitMs: number;
  convoTimeoutMs: number;
  autoSummarize: boolean;
  plugins: string[];
  voice: VoiceConfig;
  /** When true, personas with a model field use local-model prompt hints. */
  localFirst?: boolean;
  socials?: SocialsConfig;
  llm?: LlmConfig;
  [key: string]: unknown;
}

export const DEFAULT_OLLAMA_MODEL = "llama3.1:8b";

const DEFAULT_CONFIG: Config = {
  provider: "claude",
  ollama_model: DEFAULT_OLLAMA_MODEL,
  activePersona: "choomfie",
  personas: {
    choomfie: {
      name: "Choomfie",
      personality:
        "Be casual, friendly, and fun. Talk like a cyberpunk buddy — use slang, be a ride-or-die friend.",
    },
  },
  rateLimitMs: 5000,
  convoTimeoutMs: 5 * 60 * 1000, // 5 min
  autoSummarize: true,
  plugins: [],
  voice: { stt: "auto", tts: "auto", ttsSpeed: 0.7 },
};

function applyLocalFirst(config: Config): Config {
  if (!config.localFirst) return config;
  return {
    ...config,
    provider: "ollama",
    embeddings: "local",
    voice: {
      ...config.voice,
      stt: "whisper",
      tts: "kokoro",
    },
  };
}

function mergeConfig(saved: Partial<Config>): Config {
  const savedPersonas =
    saved.personas && typeof saved.personas === "object"
      ? saved.personas
      : {};
  const savedVoice =
    saved.voice && typeof saved.voice === "object" ? saved.voice : {};
  const savedSocials =
    saved.socials && typeof saved.socials === "object" ? saved.socials : undefined;

  return {
    ...DEFAULT_CONFIG,
    ...saved,
    provider: saved.provider === "ollama" ? "ollama" : DEFAULT_CONFIG.provider,
    ollama_model:
      typeof saved.ollama_model === "string" && saved.ollama_model.trim()
        ? saved.ollama_model.trim()
        : DEFAULT_CONFIG.ollama_model,
    personas: {
      ...DEFAULT_CONFIG.personas,
      ...savedPersonas,
    },
    voice: {
      ...DEFAULT_CONFIG.voice,
      ...savedVoice,
    },
    ...(savedSocials ? { socials: savedSocials } : {}),
  };
}

export class ConfigManager {
  private configPath: string;
  private config: Config;

  constructor(dataDir: string) {
    this.configPath = `${dataDir}/config.json`;
    this.config = this.load();
  }

  private load(): Config {
    try {
      const raw = readFileSync(this.configPath, "utf-8");
      const saved = JSON.parse(raw) as Partial<Config>;
      return mergeConfig(saved);
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  private save() {
    writeFileSync(
      this.configPath,
      JSON.stringify(this.config, null, 2)
    );
  }

  // --- Persona ---

  getActivePersona(): Persona {
    return (
      this.config.personas[this.config.activePersona] ||
      this.config.personas.choomfie ||
      { name: "Choomfie", personality: "Be casual, friendly, and fun." }
    );
  }

  getActivePersonaKey(): string {
    return this.config.activePersona;
  }

  switchPersona(key: string): Persona | null {
    const persona = this.config.personas[key.toLowerCase()];
    if (!persona) return null;
    this.config.activePersona = key.toLowerCase();
    this.save();
    return persona;
  }

  savePersona(key: string, name: string, personality: string, model?: string) {
    const persona: Persona = { name, personality };
    if (model) persona.model = model;
    this.config.personas[key.toLowerCase()] = persona;
    this.save();
  }

  getActivePersonaModel(): string | undefined {
    return this.getActivePersona().model;
  }

  getLocalFirst(): boolean {
    return this.config.localFirst ?? false;
  }

  setLocalFirst(enabled: boolean) {
    this.config.localFirst = enabled;
    this.save();
  }

  deletePersona(key: string): boolean {
    const k = key.toLowerCase();
    if (k === this.config.activePersona) return false; // can't delete active
    if (!this.config.personas[k]) return false;
    delete this.config.personas[k];
    this.save();
    return true;
  }

  listPersonas(): Array<{ key: string; persona: Persona; active: boolean }> {
    return Object.entries(this.config.personas).map(([key, persona]) => ({
      key,
      persona,
      active: key === this.config.activePersona,
    }));
  }

  // --- Settings ---

  getRateLimitMs(): number {
    return this.config.rateLimitMs;
  }

  setRateLimitMs(ms: number) {
    this.config.rateLimitMs = ms;
    this.save();
  }

  getConvoTimeoutMs(): number {
    return this.config.convoTimeoutMs || 5 * 60 * 1000;
  }

  setConvoTimeoutMs(ms: number) {
    this.config.convoTimeoutMs = ms;
    this.save();
  }

  getAutoSummarize(): boolean {
    return this.config.autoSummarize;
  }

  setAutoSummarize(enabled: boolean) {
    this.config.autoSummarize = enabled;
    this.save();
  }

  // --- Chat provider ---

  getProvider(): Config["provider"] {
    return this.config.provider === "ollama" ? "ollama" : "claude";
  }

  setProvider(provider: Config["provider"]) {
    this.config.provider = provider;
    this.save();
  }

  getOllamaModel(): string {
    return this.config.ollama_model || DEFAULT_CONFIG.ollama_model;
  }

  setOllamaModel(model: string) {
    const trimmed = model.trim();
    if (!trimmed) return;
    this.config.ollama_model = trimmed;
    this.save();
  }

  // --- Voice ---

  getVoiceConfig(): VoiceConfig {
    return applyLocalFirst(this.config).voice;
  }

  setVoiceConfig(voice: Partial<VoiceConfig>) {
    this.config.voice = { ...this.config.voice, ...voice };
    this.save();
  }

  // --- Plugins ---

  getEnabledPlugins(): string[] {
    return this.config.plugins || [];
  }

  setEnabledPlugins(names: string[]) {
    this.config.plugins = names;
    this.save();
  }

  // --- Socials ---

  getSocialsConfig(): SocialsConfig | undefined {
    return this.config.socials;
  }

  // --- LLM ---

  getLlmConfig(): LlmConfig {
    return this.config.llm ?? { provider: "anthropic" };
  }

  setLlmConfig(llm: LlmConfig) {
    this.config.llm = llm;
    this.save();
  }

  // --- Full config ---

  getConfig(): Config {
    return applyLocalFirst({ ...this.config });
  }
}
