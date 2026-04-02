/**
 * Japanese tutor module.
 */

import type { TutorModule, QuizQuestion } from "../../core/types.ts";
import { lookupJisho } from "./dictionary.ts";
import { initFurigana } from "./furigana.ts";
import { japaneseTools } from "./tools.ts";

const HIRAGANA = [
  ["あ", "a"], ["い", "i"], ["う", "u"], ["え", "e"], ["お", "o"],
  ["か", "ka"], ["き", "ki"], ["く", "ku"], ["け", "ke"], ["こ", "ko"],
  ["さ", "sa"], ["し", "shi"], ["す", "su"], ["せ", "se"], ["そ", "so"],
  ["た", "ta"], ["ち", "chi"], ["つ", "tsu"], ["て", "te"], ["と", "to"],
  ["な", "na"], ["に", "ni"], ["ぬ", "nu"], ["ね", "ne"], ["の", "no"],
  ["は", "ha"], ["ひ", "hi"], ["ふ", "fu"], ["へ", "he"], ["ほ", "ho"],
  ["ま", "ma"], ["み", "mi"], ["む", "mu"], ["め", "me"], ["も", "mo"],
  ["や", "ya"], ["ゆ", "yu"], ["よ", "yo"],
  ["ら", "ra"], ["り", "ri"], ["る", "ru"], ["れ", "re"], ["ろ", "ro"],
  ["わ", "wa"], ["を", "wo"], ["ん", "n"],
];

const KATAKANA = [
  ["ア", "a"], ["イ", "i"], ["ウ", "u"], ["エ", "e"], ["オ", "o"],
  ["カ", "ka"], ["キ", "ki"], ["ク", "ku"], ["ケ", "ke"], ["コ", "ko"],
  ["サ", "sa"], ["シ", "shi"], ["ス", "su"], ["セ", "se"], ["ソ", "so"],
  ["タ", "ta"], ["チ", "chi"], ["ツ", "tsu"], ["テ", "te"], ["ト", "to"],
  ["ナ", "na"], ["ニ", "ni"], ["ヌ", "nu"], ["ネ", "ne"], ["ノ", "no"],
  ["ハ", "ha"], ["ヒ", "hi"], ["フ", "fu"], ["ヘ", "he"], ["ホ", "ho"],
  ["マ", "ma"], ["ミ", "mi"], ["ム", "mu"], ["メ", "me"], ["モ", "mo"],
  ["ヤ", "ya"], ["ユ", "yu"], ["ヨ", "yo"],
  ["ラ", "ra"], ["リ", "ri"], ["ル", "ru"], ["レ", "re"], ["ロ", "ro"],
  ["ワ", "wa"], ["ヲ", "wo"], ["ン", "n"],
];

const N5_VOCAB = [
  ["食べる", "たべる", "to eat"],
  ["飲む", "のむ", "to drink"],
  ["行く", "いく", "to go"],
  ["来る", "くる", "to come"],
  ["見る", "みる", "to see/watch"],
  ["聞く", "きく", "to hear/ask"],
  ["話す", "はなす", "to speak"],
  ["読む", "よむ", "to read"],
  ["書く", "かく", "to write"],
  ["買う", "かう", "to buy"],
  ["大きい", "おおきい", "big"],
  ["小さい", "ちいさい", "small"],
  ["新しい", "あたらしい", "new"],
  ["古い", "ふるい", "old"],
  ["高い", "たかい", "expensive/tall"],
  ["安い", "やすい", "cheap"],
  ["学校", "がっこう", "school"],
  ["先生", "せんせい", "teacher"],
  ["学生", "がくせい", "student"],
  ["友達", "ともだち", "friend"],
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

const LEVEL_GUIDES: Record<string, string> = {
  N5: `Student is a COMPLETE BEGINNER (JLPT N5).
- Use only basic vocabulary and grammar
- Always include furigana for kanji: 食[た]べる
- Explain everything in English first, then show Japanese
- Focus on: greetings, self-introduction, basic verbs, numbers, time
- Grammar: です/ます form, particles は/が/を/に/で/へ, question か
- Keep sentences SHORT (5-10 words max)
- If they write in romaji, gently encourage hiragana but still understand
- Celebrate small wins, be encouraging`,

  N4: `Student is ELEMENTARY (JLPT N4).
- Use N5+N4 vocabulary
- Include furigana for N4+ kanji
- Mix English and Japanese explanations
- Focus on: て-form, ない-form, たい-form, basic counters, giving/receiving
- Grammar: conditional ば/たら, てもいい/てはいけない, ている
- Introduce casual speech alongside polite`,

  N3: `Student is INTERMEDIATE (JLPT N3).
- Use up to N3 vocabulary freely
- Furigana only for uncommon kanji
- Explain primarily in Japanese with English for complex grammar
- Focus on: passive, causative, keigo basics, compound sentences
- Longer conversations, abstract topics`,

  N2: `Student is UPPER-INTERMEDIATE (JLPT N2).
- Natural Japanese, minimal English
- Complex grammar and expressions
- Nuance, context, register differences
- Business Japanese, formal writing`,

  N1: `Student is ADVANCED (JLPT N1).
- Native-level Japanese
- Literary expressions, classical grammar references
- Debate, persuasion, academic topics
- Only use English if explicitly asked`,
};

const GRAMMAR_QUESTIONS: QuizQuestion[] = [
  {
    question: 'Fill in the blank: わたし＿学生です。(I am a student)',
    options: ["は", "が", "を", "に"],
    correctIndex: 0,
    explanation: "は (wa) is the topic marker. わたしは = 'As for me...'",
  },
  {
    question: 'Fill in the blank: 水＿飲みます。(I drink water)',
    options: ["を", "は", "に", "で"],
    correctIndex: 0,
    explanation: "を (wo) marks the direct object. 水を飲む = drink water",
  },
  {
    question: 'Fill in the blank: 学校＿行きます。(I go to school)',
    options: ["に", "を", "は", "が"],
    correctIndex: 0,
    explanation: "に (ni) marks the destination. 学校に行く = go to school",
  },
  {
    question: "How do you say 'I don't eat' in Japanese?",
    options: ["食べません", "食べます", "食べない", "食べた"],
    correctIndex: 0,
    explanation: "食べません is the polite negative form of 食べる (to eat)",
  },
  {
    question: "Which is the correct question form?",
    options: ["これは何ですか？", "これは何です。", "これは何でか？", "これは何かです？"],
    correctIndex: 0,
    explanation: "か at the end of a です/ます sentence makes it a question",
  },
];

export const japaneseModule: TutorModule = {
  name: "japanese",
  displayName: "Japanese",
  description: "JLPT-based Japanese language learning with kana, kanji, and grammar",
  icon: "🇯🇵",
  levels: ["N5", "N4", "N3", "N2", "N1"],
  defaultLevel: "N5",
  quizTypes: ["reading", "vocab", "grammar"],

  tools: japaneseTools,

  async lookup(query: string) {
    return lookupJisho(query);
  },

  buildTutorPrompt(level: string): string {
    return `You are a Japanese language tutor. ${LEVEL_GUIDES[level] || LEVEL_GUIDES.N5}

When the student writes in Japanese, respond with a JSON block:
\`\`\`json
{
  "response_jp": "Your Japanese response",
  "response_en": "English translation",
  "furigana": "Response with furigana: 食[た]べる",
  "corrections": [
    { "original": "what they wrote wrong", "corrected": "correct version", "type": "grammar|vocabulary|particle|formality|spelling", "explanation": "why" }
  ],
  "new_words": [
    { "word": "新しい", "reading": "あたらしい", "meaning": "new" }
  ]
}
\`\`\`

If the student writes in English, respond naturally as a tutor — teach, explain, give examples.
Always be encouraging and patient. Language learning is hard!`;
  },

  generateQuiz(level: string, type: string): QuizQuestion {
    if (type === "reading") {
      const kanaSet = Math.random() > 0.5 ? HIRAGANA : KATAKANA;
      const setName = kanaSet === HIRAGANA ? "hiragana" : "katakana";
      const correct = pick(kanaSet);
      const wrongOptions = pickN(
        kanaSet.filter((k) => k[1] !== correct[1]),
        3
      );
      const options = [correct[1], ...wrongOptions.map((w) => w[1])].sort(
        () => Math.random() - 0.5
      );

      return {
        question: `What is the reading of this ${setName}: **${correct[0]}**?`,
        options,
        correctIndex: options.indexOf(correct[1]),
        explanation: `${correct[0]} is read as "${correct[1]}"`,
      };
    }

    if (type === "vocab") {
      const correct = pick(N5_VOCAB);
      const wrongOptions = pickN(
        N5_VOCAB.filter((v) => v[2] !== correct[2]),
        3
      );
      const options = [correct[2], ...wrongOptions.map((w) => w[2])].sort(
        () => Math.random() - 0.5
      );

      return {
        question: `What does **${correct[0]}** (${correct[1]}) mean?`,
        options,
        correctIndex: options.indexOf(correct[2]),
        explanation: `${correct[0]} (${correct[1]}) means "${correct[2]}"`,
      };
    }

    // Grammar
    const q = pick(GRAMMAR_QUESTIONS);
    const correctAnswer = q.options[q.correctIndex];
    const shuffled = [...q.options].sort(() => Math.random() - 0.5);
    return {
      ...q,
      options: shuffled,
      correctIndex: shuffled.indexOf(correctAnswer),
    };
  },

  async init() {
    try {
      await initFurigana();
    } catch (e) {
      console.error(`Japanese module: furigana init failed (non-critical): ${e}`);
    }
  },
};
