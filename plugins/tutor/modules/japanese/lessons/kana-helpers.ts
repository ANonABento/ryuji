import type { ChartExercise, Exercise } from "../../../core/lesson-types.ts";
import { renderChartPrompt } from "../../../core/chart.ts";

export { renderChartGrid } from "../../../core/chart.ts";

export function recognition(char: string, reading: string, pool: string[]): Exercise {
  const distractors = pool.filter((r) => r !== reading).sort(() => Math.random() - 0.5).slice(0, 3);
  return {
    type: "recognition",
    prompt: `What sound does **${char}** make?`,
    answer: reading,
    distractors,
  };
}

export function production(char: string, reading: string, kanaType: "hiragana" | "katakana"): Exercise {
  return {
    type: "production",
    prompt: `Type the ${kanaType} for **"${reading}"**`,
    answer: char,
    accept: [reading],
  };
}

export function chartReview(knownChars: [string, string][]): ChartExercise {
  const gridSize = Math.min(knownChars.length, 20);
  const selected = knownChars.slice(0, gridSize);

  const blankCount = Math.min(3, Math.max(1, Math.floor(gridSize / 5)));
  const blankIndexes = new Set<number>();
  while (blankIndexes.size < blankCount) {
    blankIndexes.add(Math.floor(Math.random() * gridSize));
  }

  const cols = 5;
  const rows = Math.ceil(gridSize / cols);
  const grid: (string | null)[][] = [];
  const colLabels = ["a", "i", "u", "e", "o"];
  const rowLabels: string[] = [];
  const blanks: ChartExercise["blanks"] = [];

  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const row: (string | null)[] = [];
    const firstReading = selected[idx]?.[1] ?? "";
    rowLabels.push(firstReading.length > 1 ? firstReading[0] + "-" : "∅-");

    for (let c = 0; c < cols && idx < gridSize; c++, idx++) {
      if (blankIndexes.has(idx)) {
        const [answer, reading] = selected[idx];
        row.push(null);
        blanks.push({ row: r, col: c, answer, reading });
      } else {
        row.push(selected[idx][0]);
      }
    }
    grid.push(row);
  }

  const distractorPool = selected
    .map(([char]) => char)
    .filter((char) => !blanks.some((blank) => blank.answer === char))
    .sort(() => Math.random() - 0.5)
    .slice(0, 8);

  const answer = blanks[0]?.answer ?? selected[0]?.[0] ?? "";

  const exercise: ChartExercise = {
    type: "chart",
    prompt: "",
    answer,
    distractors: distractorPool,
    grid,
    blanks,
    rowLabels,
    colLabels,
  };
  exercise.prompt = renderChartPrompt(exercise);
  return exercise;
}
