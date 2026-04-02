/**
 * GitHub tools — check PRs, issues, notifications via gh CLI.
 */

import type { ToolDef } from "../types.ts";
import { text, err } from "../types.ts";
import { buildGhArgs, runGh } from "../handlers/github.ts";

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
      const ghArgs = buildGhArgs(
        args.command as string,
        args.repo as string | undefined
      );
      if (!ghArgs) return err(`Unknown GitHub command: ${args.command}`);

      try {
        const output = await runGh(ghArgs);
        return text(output);
      } catch (e: any) {
        return err(`GitHub CLI error: ${e.message}`);
      }
    },
  },
];
