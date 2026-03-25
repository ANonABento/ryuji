/**
 * Language module registry — picks language from config.
 *
 * To add a new language:
 *   1. Create languages/<name>/index.ts implementing LanguageModule
 *   2. Add to the registry below
 */

import type { LanguageModule } from "./types.ts";
import { japaneseModule } from "./japanese/index.ts";

const languages: Record<string, LanguageModule> = {
  japanese: japaneseModule,
};

export function getLanguageModule(name: string): LanguageModule {
  const mod = languages[name];
  if (!mod) {
    throw new Error(
      `Unknown language: "${name}". Available: ${Object.keys(languages).join(", ")}`
    );
  }
  return mod;
}

export function listLanguages(): LanguageModule[] {
  return Object.values(languages);
}

export type { LanguageModule };
