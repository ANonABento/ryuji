import type { ToolDef } from "@choomfie/shared";
import { err, text } from "@choomfie/shared";
import {
  getYouTubeCommentClient,
  getYouTubeProvider,
} from "../providers/index.ts";

const yt = getYouTubeProvider();

export const youtubeTools: ToolDef[] = [
  {
    definition: {
      name: "youtube_search",
      description:
        "Search YouTube for videos. Returns titles, URLs, channels, and durations.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default: 5)" },
        },
        required: ["query"],
      },
    },
    handler: async (args, _ctx) => {
      try {
        const results = await yt.search(
          args.query as string,
          (args.limit as number) || 5,
        );
        if (results.length === 0) return text("No results found.");

        const formatted = results
          .map(
            (v, i) =>
              `**${i + 1}.** ${v.title}\n  ${v.url}\n  ${v.channel} · ${v.duration}${v.views ? ` · ${v.views} views` : ""}`,
          )
          .join("\n\n");
        return text(formatted);
      } catch (e: any) {
        return err(`YouTube search failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "youtube_info",
      description: "Get detailed info about a YouTube video.",
      inputSchema: {
        type: "object" as const,
        properties: {
          url: { type: "string", description: "YouTube video URL" },
        },
        required: ["url"],
      },
    },
    handler: async (args, _ctx) => {
      try {
        const info = await yt.getInfo(args.url as string);
        if (!info) return err("Video not found.");
        return text(
          [
            `**${info.title}**`,
            `Channel: ${info.channel}`,
            `Duration: ${info.duration}`,
            info.views ? `Views: ${info.views}` : null,
            info.published ? `Published: ${info.published}` : null,
            `URL: ${info.url}`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      } catch (e: any) {
        return err(`YouTube info failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "youtube_transcript",
      description: "Get the transcript/captions of a YouTube video.",
      inputSchema: {
        type: "object" as const,
        properties: {
          url: { type: "string", description: "YouTube video URL" },
        },
        required: ["url"],
      },
    },
    handler: async (args, _ctx) => {
      try {
        const segments = await yt.getTranscript(args.url as string);
        if (segments.length === 0) {
          return text("No transcript available for this video.");
        }
        const transcript = segments.map((s) => s.text).join(" ");
        return text(
          transcript.length > 3000
            ? `${transcript.slice(0, 3000)}\n\n...(truncated)`
            : transcript,
        );
      } catch (e: any) {
        return err(`Transcript failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "youtube_auth",
      description:
        "Start YouTube OAuth flow for commenting. Returns an authorization URL the user must visit. " +
        "Owner only. Requires socials.youtube.clientId and clientSecret in config.json.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    handler: async (_args, _ctx) => {
      try {
        const client = getYouTubeCommentClient();
        if (!client) {
          return text(
            "YouTube: **Not configured for comments**\n\n" +
              "Add YouTube OAuth credentials to config.json:\n" +
              '```json\n"socials": {\n  "youtube": {\n    "clientId": "...",\n    "clientSecret": "..."\n  }\n}\n```\n' +
              "Create a Google Cloud project with YouTube Data API v3 at https://console.cloud.google.com\n" +
              "Then add an OAuth 2.0 client ID (Web application type) with redirect URI http://localhost:{port}/callback.",
          );
        }

        const { authUrl, port } = await client.startAuth();
        return text(
          `**YouTube Authorization**\n\n` +
            `Click the link below to connect your YouTube/Google account:\n${authUrl}\n\n` +
            `A temporary callback server is running on port ${port}. ` +
            `It will automatically capture the authorization and shut down.\n` +
            "The link expires in 5 minutes.",
        );
      } catch (e: any) {
        return err(`YouTube auth failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "youtube_comment",
      description:
        "Post a comment on a YouTube video. Owner only. Requires YouTube OAuth (run youtube_auth first).",
      inputSchema: {
        type: "object" as const,
        properties: {
          video_url: {
            type: "string",
            description: "YouTube video URL (extracts video ID automatically)",
          },
          text: {
            type: "string",
            description: "Comment text",
          },
        },
        required: ["video_url", "text"],
      },
    },
    handler: async (args, _ctx) => {
      try {
        const client = getYouTubeCommentClient();
        if (!client) {
          return err(
            "YouTube comments not configured. Add socials.youtube.clientId and clientSecret to config.json, " +
              "then run youtube_auth to connect your account.",
          );
        }

        if (!client.isAuthenticated()) {
          return err("Not authenticated with YouTube. Run youtube_auth first.");
        }

        const videoUrl = args.video_url as string;
        const commentText = args.text as string;
        const idMatch = videoUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        if (!idMatch) {
          return err(
            "Invalid YouTube URL. Must contain a video ID (e.g. https://youtube.com/watch?v=...)",
          );
        }

        const videoId = idMatch[1];
        const result = await client.postComment(videoId, commentText);
        return text(
          `Comment posted on YouTube video.\n` +
            `Video: https://www.youtube.com/watch?v=${videoId}\n` +
            `Comment ID: ${result.commentId}`,
        );
      } catch (e: any) {
        return err(`YouTube comment failed: ${e.message}`);
      }
    },
  },
];
