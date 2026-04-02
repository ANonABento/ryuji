/**
 * Session manager — tracks per-user tutor state.
 *
 * Module-aware: tracks which module is active and per-module level state.
 * In-memory for now — session persistence planned for Phase 2.
 */

export interface ModuleState {
  level: string;
  lastActive?: string;
}

export interface UserSession {
  activeModule: string;
  modules: Record<string, ModuleState>;
}

const sessions = new Map<string, UserSession>();

const DEFAULT_MODULE = "japanese";
const DEFAULT_LEVEL = "N5";

export function getSession(userId: string): UserSession {
  const existing = sessions.get(userId);
  if (existing) return existing;

  return {
    activeModule: DEFAULT_MODULE,
    modules: {
      [DEFAULT_MODULE]: { level: DEFAULT_LEVEL },
    },
  };
}

export function getActiveModule(userId: string): string {
  return getSession(userId).activeModule;
}

export function getModuleLevel(userId: string, moduleName: string): string {
  const session = getSession(userId);
  return session.modules[moduleName]?.level ?? DEFAULT_LEVEL;
}

export function setModule(userId: string, moduleName: string, defaultLevel: string) {
  const session = getSession(userId);
  session.activeModule = moduleName;
  if (!session.modules[moduleName]) {
    session.modules[moduleName] = { level: defaultLevel };
  }
  session.modules[moduleName].lastActive = new Date().toISOString();
  sessions.set(userId, session);
}

export function setLevel(userId: string, level: string) {
  const session = getSession(userId);
  const mod = session.activeModule;
  if (!session.modules[mod]) {
    session.modules[mod] = { level };
  } else {
    session.modules[mod].level = level;
  }
  sessions.set(userId, session);
}
