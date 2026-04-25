/** Convert an unknown thrown value into a readable message. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
