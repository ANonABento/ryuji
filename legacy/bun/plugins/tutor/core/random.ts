/** Random utilities for tutor exercises and quizzes. */

export function shuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function pick<T>(items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error("Cannot pick from an empty list");
  }
  return items[Math.floor(Math.random() * items.length)];
}

export function pickN<T>(items: readonly T[], count: number): T[] {
  return shuffle(items).slice(0, count);
}
