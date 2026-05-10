import type { Exercise, LessonSRSItem } from "../../../core/lesson-types.ts";

export function vocabSRS(
  items: Array<{ term: string; reading: string; meaning: string }>,
  tags: string,
): LessonSRSItem[] {
  return items.map((item) => ({
    front: item.term,
    back: item.meaning,
    reading: item.reading,
    tags,
  }));
}

export function patternSRS(
  patterns: Array<{ front: string; back: string }>,
  tags: string,
): LessonSRSItem[] {
  return patterns.map((p) => ({
    front: p.front,
    back: p.back,
    tags,
  }));
}

export function cloze(
  prompt: string,
  answer: string,
  hint?: string,
  explanation?: string,
  accept?: string[],
): Exercise {
  return {
    type: "cloze",
    prompt,
    answer,
    ...(hint && { hint }),
    ...(explanation && { explanation }),
    ...(accept && { accept }),
  };
}

export function mc(
  prompt: string,
  answer: string,
  distractors: string[],
  explanation?: string,
): Exercise {
  return {
    type: "multiple_choice",
    prompt,
    answer,
    distractors,
    ...(explanation && { explanation }),
  };
}
