# Chinese (Mandarin) Module Spec

> Mandarin Chinese module for the tutor plugin. Follows the same TutorModule interface as Japanese.

## Status: Planned (after Japanese is polished)

## Design Principle

The tutor plugin is language-agnostic. SRS, lesson engine, session tracking, quiz system, and Discord interactions all reuse. Each language module only provides:
- Dictionary lookup
- Language-specific utilities (pinyin, hanzi)
- Tutor prompt per level
- Quiz generation
- Lesson content
- Optional module-specific tools

## Level Framework: HSK 1-6

| Level | Words | Description |
|-------|-------|-------------|
| HSK 1 | 150 | Basic greetings, numbers, time, family |
| HSK 2 | 300 | Daily life, shopping, weather |
| HSK 3 | 600 | Travel, hobbies, work, opinions |
| HSK 4 | 1200 | News, culture, abstract topics |
| HSK 5 | 2500 | Fluent reading, complex discussion |
| HSK 6 | 5000+ | Near-native, academic, literary |

Default: HSK 1 (complete beginner).

## Chinese-Specific Features

### Pinyin System
- Tone marks display: mā, má, mǎ, mà, ma
- Numeric representation: ma1, ma2, ma3, ma4, ma5
- Bidirectional conversion (marks ↔ numbers)
- Tone validation
- NPM: `pinyin-pro` or `pinyin-utils`

### Hanzi (Characters)
- Stroke count per character
- Radical decomposition (learning aid)
- Simplified (primary) with traditional variant support
- Character frequency ranking
- NPM: `hanzi` or custom JSON data

### Tone Practice (Critical)
- Tone recognition: read pinyin → identify tone number
- Tone production: given meaning → type correct pinyin with tones
- Tone pair drills (3rd + 3rd → 2nd + 3rd tone sandhi)
- All 4 tones + neutral tone

### Measure Words
- Dedicated quiz type: match noun to correct measure word
- Common measure words taught early (个, 只, 张, 本, 杯, 块)
- Integrated into vocabulary lessons

## Dictionary: CC-CEDICT

Free, open-license Chinese-English dictionary with 100k+ entries.

Format: `traditional simplified [pinyin] /definition1/definition2/`
Example: `你好 你好 [ni3 hao3] /hello/hi/how are you?/`

Implementation:
- Download once (~6MB text file), parse at module init
- Build in-memory lookup map (simplified → entries)
- Return `DictionaryEntry[]` matching the existing interface
- Source: https://www.mdbg.net/chinese/dictionary?page=cc-cedict

## File Structure

```
packages/tutor/modules/chinese/
├── index.ts                # TutorModule implementation
├── dictionary.ts           # CC-CEDICT parser + lookup
├── pinyin.ts               # Pinyin utilities (tone conversion, display)
├── hanzi.ts                # Hanzi utilities (stroke count, radicals)
├── tools.ts                # Module-specific tools
├── data/
│   ├── hsk-1-vocab.json    # 150 HSK 1 vocabulary cards
│   └── cedict.txt          # CC-CEDICT dictionary (downloaded)
└── lessons/
    ├── index.ts            # Lesson registry + unit definitions
    ├── unit-1-tones.ts     # 4 tones + neutral, tone sandhi
    ├── unit-2-basic-hanzi.ts   # 50-100 common characters
    └── unit-3-hsk1-vocab.ts    # HSK 1 vocabulary with measure words
```

## Module-Specific Tools

| Tool | Description |
|------|-------------|
| `convert_pinyin` | Convert between tone marks and numbers (nǐ hǎo ↔ ni3 hao3) |
| `stroke_info` | Show stroke count and radical for a character |
| `simplify` | Convert traditional → simplified (or vice versa) |

## Quiz Types

| Type | Description | Example |
|------|-------------|---------|
| `vocab` | Character → meaning (multiple choice) | 你好 = ? (a) hello (b) goodbye ... |
| `pinyin` | Character → pinyin | 你好 → nǐ hǎo |
| `tone` | Identify correct tone | Which tone is "ma" in 妈? (1st) |
| `hanzi` | Meaning → character | "hello" = ? (a) 你好 (b) 再见 ... |
| `measure` | Pick correct measure word | 一___书 → 本 |

## Lesson Progression

### Unit 1: Tones (5 lessons)
1. 1st tone (flat, high): 妈 mā, 他 tā
2. 2nd tone (rising): 麻 má, 来 lái
3. 3rd tone (dipping): 马 mǎ, 你 nǐ
4. 4th tone (falling): 骂 mà, 大 dà
5. Tone pairs + sandhi rules (3rd + 3rd → 2nd + 3rd)

### Unit 2: Basic Characters (10 lessons)
1. Numbers 1-10
2. People (我, 你, 他/她, 人)
3. Actions (是, 有, 吃, 喝, 去, 来)
4. Time (今天, 明天, 昨天, 现在)
5-10. Common characters grouped by radical/theme

### Unit 3: HSK 1 Vocabulary (10 lessons)
- 150 words across 10 themed lessons
- Each lesson introduces 15 words + measure words
- Themes: greetings, family, food, places, weather, etc.
- SRS auto-import on completion

## Dependencies

```json
{
  "pinyin-pro": "^3.x",        // Pinyin conversion + tone handling
  "hanzi": "^0.x"              // Character stroke/radical data (optional)
}
```

Or: implement pinyin conversion from scratch (it's a simple mapping table). CC-CEDICT already includes pinyin for every entry.

## SRS Integration

Same as Japanese:
- Lesson completion adds items to SRS queue
- HSK vocabulary cards auto-import on first review (like JLPT N5)
- FSRS algorithm schedules reviews optimally
- Card format: front = character, back = pinyin + meaning

## Prerequisites

Before building Chinese module:
1. Japanese module should be fully polished (battle-tested the architecture)
2. Any TutorModule interface changes should be finalized
3. Lesson engine should handle all exercise types cleanly
4. SRS import flow should be reliable

## Estimated Effort

| Phase | Scope | Hours |
|-------|-------|-------|
| 1 — Foundation | Module scaffold, pinyin, CC-CEDICT dictionary, basic quiz | 7-10 |
| 2 — Hanzi + Quizzes | Stroke/radical system, tone quizzes, HSK 1 vocab data | 8-12 |
| 3 — Lessons | 3 lesson units (tones, hanzi, vocab), full SRS integration | 8-15 |
| **Total** | | **23-37** |

## Future Expansion

- HSK 2-6 vocabulary data + lessons
- Character writing practice (stroke order animation)
- Sentence construction drills (word order is key in Chinese)
- Chengyu (成语) idiom database
- Audio integration via voice plugin TTS
- Traditional Chinese variant mode
