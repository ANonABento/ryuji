import type { AppContext } from "./types.ts";

export function isOwner(ctx: AppContext, userId: string): boolean {
  return ctx.ownerUserId ? userId === ctx.ownerUserId : false;
}

export function isAllowed(ctx: AppContext, userId: string): boolean {
  if (ctx.allowedUsers.size === 0) return true;
  return ctx.allowedUsers.has(userId);
}
