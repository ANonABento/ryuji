/**
 * LessonDB singleton — breaks circular dependency between index.ts and tools.
 */

import type { LessonDB } from "./lesson-db.ts";

let _db: LessonDB | null = null;

export function setLessonDB(db: LessonDB | null) {
  _db = db;
}

export function getLessonDB(): LessonDB | null {
  return _db;
}
