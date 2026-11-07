import { createBrowserClient } from "@supabase/ssr";
import { cookieOptions } from "./cookie";

export type Connection = { url: string; anonKey: string };

export function browserClient({ url, anonKey }: Connection) {
  return createBrowserClient(url, anonKey, { cookieOptions });
}
