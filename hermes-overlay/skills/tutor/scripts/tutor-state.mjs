#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(__dirname, "..");
const dataDir = resolve(skillDir, "data");
const home = process.env.CHOOMFIE_HERMES_HOME || resolve(homedir(), ".choomfie-hermes");
const statePath = resolve(home, "tutor-state.json");

const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeState(state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function readState() {
  return readJson(statePath, {
    activeModule: null,
    moduleState: {},
    lastQuestion: null,
    history: []
  });
}

async function loadModules() {
  return readJson(resolve(dataDir, "modules.json"), {});
}

async function loadQuizSeeds() {
  return readJson(resolve(dataDir, "quiz-seeds.json"), []);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const [command, moduleArg, levelArg, ...restArgs] = process.argv.slice(2);
  const modules = await loadModules();
  const state = await readState();

  if (!command || command === "get") {
    print({ ok: true, state, modules });
    return;
  }

  if (command === "start") {
    const moduleName = normalize(moduleArg);
    if (!modules[moduleName]) {
      print({ ok: false, error: `Unknown module: ${moduleArg || ""}`, modules: Object.keys(modules) });
      process.exitCode = 2;
      return;
    }

    const level = levelArg || modules[moduleName].defaultLevel;
    if (!modules[moduleName].levels.includes(level)) {
      print({ ok: false, error: `Unsupported level for ${moduleName}: ${level}`, levels: modules[moduleName].levels });
      process.exitCode = 2;
      return;
    }

    state.activeModule = moduleName;
    state.moduleState[moduleName] = {
      level,
      lastActive: new Date().toISOString()
    };
    state.lastQuestion = null;
    await writeState(state);

    print({
      ok: true,
      activeModule: moduleName,
      level,
      starterPrompt: modules[moduleName].starterPrompt
    });
    return;
  }

  if (command === "quiz") {
    const activeModule = normalize(moduleArg) || state.activeModule;
    if (!activeModule || !modules[activeModule]) {
      print({ ok: false, error: "No active module. Start one first.", modules: Object.keys(modules) });
      process.exitCode = 2;
      return;
    }

    const level = levelArg || state.moduleState[activeModule]?.level || modules[activeModule].defaultLevel;
    const seeds = await loadQuizSeeds();
    const question = seeds.find((seed) => seed.module === activeModule && seed.level === level)
      || seeds.find((seed) => seed.module === activeModule)
      || null;

    if (!question) {
      print({ ok: false, error: `No quiz seed found for ${activeModule}/${level}` });
      process.exitCode = 2;
      return;
    }

    state.activeModule = activeModule;
    state.moduleState[activeModule] = {
      level,
      lastActive: new Date().toISOString()
    };
    state.lastQuestion = question.id;
    await writeState(state);

    print({
      ok: true,
      id: question.id,
      module: activeModule,
      level,
      prompt: question.prompt
    });
    return;
  }

  if (command === "answer") {
    const questionId = moduleArg || state.lastQuestion;
    const submitted = [levelArg, ...restArgs].filter(Boolean).join(" ");
    if (!questionId || !submitted) {
      print({ ok: false, error: "Usage: tutor-state.mjs answer <question-id> <answer>" });
      process.exitCode = 2;
      return;
    }

    const seeds = await loadQuizSeeds();
    const question = seeds.find((seed) => seed.id === questionId);
    if (!question) {
      print({ ok: false, error: `Unknown question: ${questionId}` });
      process.exitCode = 2;
      return;
    }

    const accepted = [question.answer, ...(question.accepted || [])].map(normalize);
    const correct = accepted.includes(normalize(submitted));
    state.history.push({
      questionId,
      submitted,
      correct,
      answeredAt: new Date().toISOString()
    });
    state.history = state.history.slice(-100);
    await writeState(state);

    print({
      ok: true,
      correct,
      answer: question.answer,
      explanation: question.explanation
    });
    return;
  }

  print({ ok: false, error: `Unknown command: ${command}` });
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
