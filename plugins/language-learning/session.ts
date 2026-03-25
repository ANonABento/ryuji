/**
 * Session manager — tracks per-user language study state.
 *
 * Simple in-memory store. Persistent state (SRS cards, streaks)
 * will use SQLite in Phase 2.
 */

interface UserSession {
  language: string;
  level: string;
}

const sessions = new Map<string, UserSession>();

const DEFAULT_SESSION: UserSession = {
  language: "japanese",
  level: "N5",
};

export function getSession(userId: string): UserSession {
  return sessions.get(userId) || { ...DEFAULT_SESSION };
}

export function setLevel(userId: string, level: string) {
  const session = getSession(userId);
  session.level = level;
  sessions.set(userId, session);
}

export function setLanguage(userId: string, language: string) {
  const session = getSession(userId);
  session.language = language;
  sessions.set(userId, session);
}
