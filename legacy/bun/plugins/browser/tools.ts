/**
 * Browser tools — MCP tool definitions for web browsing via Playwright.
 */

import type { ToolDef } from "@choomfie/shared";
import { text, err } from "@choomfie/shared";
import * as session from "./session.ts";

export const browserTools: ToolDef[] = [
  {
    definition: {
      name: "browse",
      description:
        "Navigate to a URL and return the page's accessibility tree snapshot. " +
        "Use refs from the snapshot (e.g. ref=\"link:Sign in\") to click or type into elements.",
      inputSchema: {
        type: "object" as const,
        properties: {
          url: {
            type: "string",
            description: "URL to navigate to",
          },
          session: {
            type: "string",
            description:
              'Named browser session (default: "default"). Use distinct names to keep multiple pages open.',
          },
        },
        required: ["url"],
      },
    },
    handler: async (args) => {
      try {
        const result = await session.browse(
          (args.session as string) || "default",
          args.url as string
        );
        return text(result);
      } catch (e: any) {
        return err(`Browse failed: ${e.message}`);
      }
    },
  },

  {
    definition: {
      name: "browser_click",
      description:
        'Click an element by ref from the page snapshot. Refs look like "link:Sign in" or "button:Submit".',
      inputSchema: {
        type: "object" as const,
        properties: {
          ref: {
            type: "string",
            description:
              'Element ref from snapshot (e.g. "link:Sign in", "button:Submit")',
          },
          session: {
            type: "string",
            description: "Browser session name (default: \"default\")",
          },
        },
        required: ["ref"],
      },
    },
    handler: async (args) => {
      try {
        const result = await session.click(
          (args.session as string) || "default",
          args.ref as string
        );
        return text(result);
      } catch (e: any) {
        return err(`Click failed: ${e.message}`);
      }
    },
  },

  {
    definition: {
      name: "browser_type",
      description:
        "Type or fill text into an element. If ref is provided, fills that specific field. " +
        "Otherwise types into the currently focused element.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "Text to type",
          },
          ref: {
            type: "string",
            description:
              "Element ref to fill (optional — omit to type into focused element)",
          },
          session: {
            type: "string",
            description: "Browser session name (default: \"default\")",
          },
        },
        required: ["text"],
      },
    },
    handler: async (args) => {
      try {
        const result = await session.type(
          (args.session as string) || "default",
          args.text as string,
          args.ref as string | undefined
        );
        return text(result);
      } catch (e: any) {
        return err(`Type failed: ${e.message}`);
      }
    },
  },

  {
    definition: {
      name: "browser_screenshot",
      description:
        "Take a screenshot of the current page. Returns the file path — can be attached to Discord messages via the reply tool's files param.",
      inputSchema: {
        type: "object" as const,
        properties: {
          session: {
            type: "string",
            description: "Browser session name (default: \"default\")",
          },
        },
      },
    },
    handler: async (args) => {
      try {
        const filePath = await session.screenshot(
          (args.session as string) || "default"
        );
        return text(filePath);
      } catch (e: any) {
        return err(`Screenshot failed: ${e.message}`);
      }
    },
  },

  {
    definition: {
      name: "browser_eval",
      description:
        "Evaluate JavaScript on the current page and return the result.",
      inputSchema: {
        type: "object" as const,
        properties: {
          code: {
            type: "string",
            description: "JavaScript code to evaluate",
          },
          session: {
            type: "string",
            description: "Browser session name (default: \"default\")",
          },
        },
        required: ["code"],
      },
    },
    handler: async (args) => {
      try {
        const result = await session.evaluate(
          (args.session as string) || "default",
          args.code as string
        );
        return text(result);
      } catch (e: any) {
        return err(`Eval failed: ${e.message}`);
      }
    },
  },

  {
    definition: {
      name: "browser_press_key",
      description:
        "Press a keyboard key (Enter, Tab, Escape, ArrowDown, etc.).",
      inputSchema: {
        type: "object" as const,
        properties: {
          key: {
            type: "string",
            description: "Key to press (e.g. Enter, Tab, Escape, ArrowDown)",
          },
          session: {
            type: "string",
            description: "Browser session name (default: \"default\")",
          },
        },
        required: ["key"],
      },
    },
    handler: async (args) => {
      try {
        const result = await session.pressKey(
          (args.session as string) || "default",
          args.key as string
        );
        return text(result);
      } catch (e: any) {
        return err(`Key press failed: ${e.message}`);
      }
    },
  },

  {
    definition: {
      name: "browser_close",
      description: "Close a browser session.",
      inputSchema: {
        type: "object" as const,
        properties: {
          session: {
            type: "string",
            description:
              "Session to close (default: \"default\"). Pass \"all\" to close everything.",
          },
        },
      },
    },
    handler: async (args) => {
      try {
        const name = (args.session as string) || "default";
        if (name === "all") {
          await session.closeAll();
          return text("All browser sessions closed.");
        }
        await session.closeSession(name);
        return text(`Session "${name}" closed.`);
      } catch (e: any) {
        return err(`Close failed: ${e.message}`);
      }
    },
  },
];
