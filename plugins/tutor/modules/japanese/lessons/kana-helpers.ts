import type { ChartBlank, Exercise } from "../../../core/lesson-types.ts";
import { renderChartGrid } from "../../../core/chart-renderer.ts";

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

export function chartReview(knownChars: [string, string][]): Exercise {
  if (knownChars.length === 0) {
    throw new Error("chartReview requires at least one character");
  }

  const selected = knownChars;
  const cols = 5;
  const rows = Math.ceil(selected.length / cols);
  const grid: (string | null)[][] = [];
  const colLabels = ["a", "i", "u", "e", "o"];
  const rowLabels: string[] = [];
  const blankIndexes = pickBlankIndexes(selected.length);
  const blanks: ChartBlank[] = [];

  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const row: (string | null)[] = [];
    const firstReading = selected[idx]?.[1] ?? "";
    rowLabels.push(firstReading.length > 1 ? firstReading[0] + "-" : "∅-");

    for (let c = 0; c < cols && idx < selected.length; c++, idx++) {
      if (blankIndexes.has(idx)) {
        row.push(null);
        blanks.push({
          row: r,
          col: c,
          answer: selected[idx][0],
          reading: selected[idx][1],
        });
      } else {
        row.push(selected[idx][0]);
      }
    }
    grid.push(row);
  }

  const firstBlank = blanks[0];
  const distractorPool = selected
    .map(([char]) => char)
    .filter((c) => c !== firstBlank.answer)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);

  const gridText = renderChartGrid(grid, rowLabels, colLabels);

  return {
    type: "chart",
    prompt: `Fill the kana chart blanks in order. First reading: **${firstBlank.reading}**\n${gridText}`,
    answer: firstBlank.answer,
    distractors: distractorPool,
    chart: {
      grid,
      blanks,
      rowLabels,
      colLabels,
    },
  };
}

function pickBlankIndexes(count: number): Set<number> {
  if (count <= 0) return new Set();
  if (count <= 5) return new Set([count - 1]);

  return new Set([
    Math.min(2, count - 1),
    Math.floor(count / 2),
    count - 1,
  ]);
}
