import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SlashCommandBuilder } from "discord.js";
import { buildCustomCommandDefs, mergeCommandDefs } from "../lib/custom-commands.ts";
import { MemoryStore } from "../lib/memory.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {}))
  );
});

async function makeMemory(): Promise<{ memory: MemoryStore; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-custom-commands-"));
  tempDirs.push(dir);
  const path = join(dir, "choomfie.db");
  return { memory: new MemoryStore(path), path };
}

test("MemoryStore adds, updates, lists, deletes, and persists custom commands", async () => {
  const { memory, path } = await makeMemory();

  memory.setCustomCommand("hello", "hi there", "owner");
  expect(memory.getCustomCommand("hello")?.response).toBe("hi there");

  memory.setCustomCommand("hello", "updated", "owner");
  expect(memory.listCustomCommands()).toHaveLength(1);
  expect(memory.getCustomCommand("hello")?.response).toBe("updated");
  memory.close();

  const reopened = new MemoryStore(path);
  expect(reopened.getCustomCommand("hello")?.response).toBe("updated");
  expect(reopened.deleteCustomCommand("hello")).toBe(true);
  expect(reopened.listCustomCommands()).toHaveLength(0);
  reopened.close();
});

test("buildCustomCommandDefs creates slash commands and merge skips built-in collisions", () => {
  const staticCommands = [
    new SlashCommandBuilder().setName("help").setDescription("Help").toJSON(),
  ];

  expect(buildCustomCommandDefs([{ name: "hello" }])[0].name).toBe("hello");
  expect(mergeCommandDefs(staticCommands, [{ name: "help" }, { name: "hello" }]).map((c) => c.name))
    .toEqual(["help", "hello"]);
});
