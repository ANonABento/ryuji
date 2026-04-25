# Lesson Authoring Guide

## Conventions

### Vocab-First Flow

Within each unit, structure lessons so vocabulary sub-lessons come before grammar sub-lessons. Use the prerequisite system to enforce this order:

```
Unit 3 example:
  3.1 Vocab: Greetings         → prereqs: [unit 2 complete]
  3.2 Vocab: People & Time     → prereqs: ["3.1"]
  3.3 Grammar: XはYです         → prereqs: ["3.1", "3.2"]  ← vocab gates grammar
  3.4 Grammar: Question か      → prereqs: ["3.3"]
```

### Furigana Levels

Set `furiganaLevel` on each lesson to control reading aids:

| Level | When | Example |
|-------|------|---------|
| `"full"` | Kana lessons, early vocab | 食[た]べる |
| `"partial"` | Grammar lessons, mid-level | 食べる (common kanji bare) |
| `"none"` | Advanced, review | 食べる (no aids) |

### Exercise Types

| Type | UX | Best For |
|------|-----|----------|
| `recognition` | Buttons (MC) | Kana ID, vocab meaning |
| `production` | User types | Spelling, writing |
| `cloze` | User types | Grammar patterns |
| `multiple_choice` | Buttons | Grammar, culture |
| `chart` | Buttons + grid | Kana chart review |
| `matching` | Buttons | Term-meaning pair matching |

### Content Sets

Define content sets instead of hand-writing individual exercises. The exercise generator creates exercises automatically:

```typescript
import type { ContentSet } from "../../../core/lesson-types.ts";
import { generateExercises } from "../../../core/exercise-generator.ts";

const greetingsContent: ContentSet = {
  items: [
    { term: "おはよう", reading: "ohayou", meaning: "good morning" },
    { term: "こんにちは", reading: "konnichiwa", meaning: "hello" },
    { term: "こんばんは", reading: "konbanwa", meaning: "good evening" },
    { term: "さようなら", reading: "sayounara", meaning: "goodbye" },
  ],
  modes: ["recognition", "production", "matching"],
};

// Generate specific mode:
const recogExercises = generateExercises(greetingsContent, "recognition");
// Or all modes at once:
const allExercises = generateAllExercises(greetingsContent);
```

**Modes available:**
| Mode | UX | What it generates |
|------|-----|-------------------|
| `recognition` | Buttons | See term → pick meaning |
| `production` | User types | See meaning → type term |
| `matching` | Buttons | Match term to meaning (sequential pairs) |

4 items × 3 modes = 12 exercises from one content set.

Lessons can expose a Discord mode picker by carrying source content sets alongside the authored default exercises:

```typescript
{
  exercises: [
    ...generateExercises(greetingsContent, "recognition"),
    ...generateExercises(greetingsContent, "production").slice(0, 3),
  ],
  contentSets: [greetingsContent],
  selectableModes: ["recognition", "production", "matching", "mixed"],
}
```

The in-memory lesson session stores the exact generated exercise list selected by the user. Scoring totals must read from the session exercise list, not the authored `Lesson.exercises` fallback.

You can mix content set exercises with hand-written ones in the same lesson:

```typescript
exercises: [
  ...generateExercises(vocabContent, "recognition"),  // auto-generated
  cloze("わたし___学生です", "は", "", "particle"),     // hand-written
  ...generateExercises(vocabContent, "production"),    // auto-generated
],
```

### SRS Items

Every lesson should define `srsItems` — these are auto-added to the user's review deck on lesson completion:

```typescript
srsItems: [
  { front: "あ", back: "a", reading: "a", tags: "hiragana" },
]
```

### Exercise Count

Target 10-12 exercises per lesson. Mix types:
- 60% recognition/MC (fast, builds confidence)
- 30% production (harder, builds recall)
- 10% review/chart (reinforcement)

### Chart Exercises

Chart review exercises should store structured chart data, not only a rendered prompt string. Use the kana `chartReview()` helper where possible. It creates a `chart` exercise with:

- `grid`: a 2D array where `null` marks blanks
- `blanks`: ordered blank coordinates and answers
- `rowLabels` / `colLabels`: optional labels for rendering

At runtime, structured chart exercises expand into one scored exercise per blank. Button custom IDs use short tokens and never include raw kana or readings.

### Mastery Threshold

80% to pass. Design exercises so a student who understood the intro should score ~90%. If too many students fail, the exercises are too hard — add easier warm-up exercises at the start.

## Deferred Scope

- Random word auto-posting needs a channel/config ownership model before it can run automatically. Keep `random_word` as an explicit tool until that exists.

## Smoke Test

Run this manually in a development Discord server after lesson catalog changes:

1. Use `/lesson` and confirm the intro embed appears for the first uncompleted lesson.
2. Click `Start Exercises` and confirm the first exercise renders correctly: answer buttons for recognition, multiple-choice, chart, and matching exercises; `Type your answer below` for production and cloze exercises.
3. Complete lesson `2.1` end-to-end and confirm the `Lesson Complete!` summary appears and lesson SRS items are added.
4. Use `/progress` and confirm four unit bars appear: Hiragana, Katakana, First Words & Phrases, and Basic Grammar.
5. While a `furiganaLevel: "partial"` lesson is active, call `tutor_prompt` and confirm the prompt includes the partial-furigana directive.
