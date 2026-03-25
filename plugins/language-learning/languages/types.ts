/**
 * Language module interface — each language implements this.
 *
 * To add a new language:
 *   1. Create languages/<name>/index.ts
 *   2. Implement LanguageModule
 *   3. Register in languages/index.ts
 */

export interface DictionaryEntry {
  word: string;
  reading: string;
  meanings: string[];
  partOfSpeech: string[];
  level?: string; // e.g. "JLPT N5", "HSK 1"
  examples?: string[];
}

export interface Correction {
  original: string;
  corrected: string;
  type: "grammar" | "vocabulary" | "particle" | "formality" | "spelling";
  explanation: string;
}

export interface TutorResponse {
  responseNative: string; // Response in target language
  responseTranslation: string; // English translation
  furigana?: string; // Reading aids (JP: furigana, CN: pinyin)
  corrections: Correction[];
  newWords: Array<{ word: string; reading: string; meaning: string }>;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface LanguageModule {
  /** Language identifier, e.g. "japanese", "chinese" */
  name: string;
  /** Display name, e.g. "Japanese", "Chinese (Mandarin)" */
  displayName: string;
  /** ISO 639-1 code, e.g. "ja", "zh" */
  code: string;
  /** Proficiency levels for this language */
  levels: string[];

  /** Look up a word in the dictionary */
  lookup(query: string): Promise<DictionaryEntry[]>;

  /** Build a system prompt for the AI tutor at the given level */
  buildTutorPrompt(level: string): string;

  /** Generate a quiz question at the given level */
  generateQuiz(level: string, type: "reading" | "vocab" | "grammar"): QuizQuestion;
}
