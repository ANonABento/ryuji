/**
 * GitHub tools — check PRs, issues, notifications via gh CLI.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDef } from "../types.ts";
import { text, err } from "../types.ts";

const execFileAsync = promisify(execFile);

export const githubTools: ToolDef[] = [
  {
    definition: {
      name: "check_github",
      description:
        "Check GitHub PRs, issues, or notifications using the gh CLI.",
      inputSchema: {
        type: "object" as const,
        properties: {
          command: {
            type: "string",
            enum: ["prs", "issues", "notifications", "pr_status"],
            description:
              "What to check: prs (open PRs), issues (open issues), notifications, pr_status (current branch PR)",
          },
          repo: {
            type: "string",
            description:
              "Repository in owner/repo format (optional, defaults to current repo)",
          },
        },
        required: ["command"],
      },
    },
    handler: async (args, _ctx) => {
      const repo = args.repo ? ["-R", args.repo as string] : [];
      let ghArgs: string[] = [];

      switch (args.command) {
        case "prs":
          ghArgs = ["pr", "list", "--state=open", "--limit=10", ...repo];
          break;
        case "issues":
          ghArgs = ["issue", "list", "--state=open", "--limit=10", ...repo];
          break;
        case "notifications":
          ghArgs = [
            "api",
            "/notifications",
            "--jq",
            ".[].subject.title",
          ];
          break;
        case "pr_status":
          ghArgs = ["pr", "status", ...repo];
          break;
        default:
          return err(`Unknown GitHub command: ${args.command}`);
      }

      try {
        const { stdout, stderr } = await execFileAsync("gh", ghArgs, {
          timeout: 15_000,
        });
        return text(stdout.trim() || stderr.trim() || "(no results)");
      } catch (e: any) {
        return err(`GitHub CLI error: ${e.message}`);
      }
    },
  },
];
