import type { Exercise, LessonSRSItem } from "../../../core/lesson-types.ts";

function shuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function recognition(char: string, reading: string, pool: string[]): Exercise {
  const distractors = shuffle(pool.filter((r) => r !== reading)).slice(0, 3);
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

export function kanaSrsItems(
  pairs: [string, string][],
  tags: "hiragana" | "katakana"
): LessonSRSItem[] {
  return pairs.map(([char, reading]) => ({
    front: char,
    back: reading,
    reading,
    tags,
  }));
}

export function renderChartGrid(
  grid: (string | null)[][],
  rowLabels?: string[],
  colLabels?: string[],
): string {
  const cellWidth = 3;
  const lines: string[] = [];

  if (colLabels) {
    const header = (rowLabels ? "   " : "") + colLabels.map((l) => l.padStart(cellWidth)).join(" ");
    lines.push(header);
  }

  for (let r = 0; r < grid.length; r++) {
    let line = rowLabels ? `${(rowLabels[r] ?? "").padEnd(3)}` : "";
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      if (cell === null) {
        line += " __".padStart(cellWidth + 1);
      } else {
        line += ` ${cell}`.padStart(cellWidth + 1);
      }
    }
    lines.push(line);
  }

  return "```\n" + lines.join("\n") + "\n```";
}

export function chartReview(knownChars: [string, string][]): Exercise {
  const gridSize = Math.min(knownChars.length, 10);
  const selected = knownChars.slice(0, gridSize);

  const blankIdx = Math.floor(Math.random() * gridSize);

  const cols = 5;
  const rows = Math.ceil(gridSize / cols);
  const grid: (string | null)[][] = [];
  const colLabels = ["a", "i", "u", "e", "o"];
  const rowLabels: string[] = [];
  let blankChar = "";
  let blankReading = "";

  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const row: (string | null)[] = [];
    const firstReading = selected[idx]?.[1] ?? "";
    rowLabels.push(firstReading.length > 1 ? firstReading[0] + "-" : "∅-");

    for (let c = 0; c < cols && idx < gridSize; c++, idx++) {
      if (idx === blankIdx) {
        row.push(null);
        blankChar = selected[idx][0];
        blankReading = selected[idx][1];
      } else {
        row.push(selected[idx][0]);
      }
    }
    grid.push(row);
  }

  const distractorPool = shuffle(
    selected.map(([char]) => char).filter((c) => c !== blankChar)
  ).slice(0, 3);

  const gridText = renderChartGrid(grid, rowLabels, colLabels);

  return {
    type: "chart",
    prompt: `Which character goes in the blank? (reading: **${blankReading}**)\n${gridText}`,
    answer: blankChar,
    distractors: distractorPool,
  };
}
