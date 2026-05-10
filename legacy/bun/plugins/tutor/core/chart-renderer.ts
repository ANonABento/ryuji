export interface ChartGridPosition {
  row: number;
  col: number;
}

export function renderChartGrid(
  grid: (string | null)[][],
  rowLabels?: string[],
  colLabels?: string[],
  activeBlank?: ChartGridPosition
): string {
  const cellWidth = 3;
  const lines: string[] = [];

  if (colLabels) {
    const header = (rowLabels ? "   " : "") + colLabels.map((label) => label.padStart(cellWidth)).join(" ");
    lines.push(header);
  }

  for (let rowIndex = 0; rowIndex < grid.length; rowIndex++) {
    const row = grid[rowIndex];
    let line = rowLabels ? `${(rowLabels[rowIndex] ?? "").padEnd(3)}` : "";

    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const cell = row[colIndex];
      const isActiveBlank =
        activeBlank !== undefined &&
        activeBlank.row === rowIndex &&
        activeBlank.col === colIndex;
      const value = cell === null ? (isActiveBlank ? "??" : "__") : cell;
      line += ` ${value}`.padStart(cellWidth + 1);
    }

    lines.push(line);
  }

  return "```\n" + lines.join("\n") + "\n```";
}
