export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

const NOT_ON_LIST = "This email isn't on the preview list yet. Ask to be added, then try again.";

/** Turn a sending failure into a message for the athlete. */
export function sendError(error: { message?: string; code?: string; status?: number }): string {
  if (error.message?.includes("not_approved") || error.code === "user_banned") return NOT_ON_LIST;
  if (error.status === 429 || error.code === "over_email_send_rate_limit") {
    return "Too many codes have been sent. Wait a minute, then try again.";
  }
  return "We couldn't send your code. Check your connection and try again.";
}

export function verifyError(error: { code?: string; status?: number }): string {
  if (error.code === "user_banned") return NOT_ON_LIST;
  if (error.status === 429) return "Too many tries. Wait a minute, then try again.";
  return "That code is wrong or has expired. Check it, or send a new one.";
}
