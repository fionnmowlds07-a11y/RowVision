"use server";

import { redirect } from "next/navigation";
import { isCode, isEmail, normaliseEmail, sendError, verifyError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type SignInState = { email: string; step: "email" | "code"; error?: string };

export async function sendCode(_: SignInState, form: FormData): Promise<SignInState> {
  const email = normaliseEmail(String(form.get("email") ?? ""));
  if (!isEmail(email)) return { email, step: "email", error: "Enter your full email address." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) return { email, step: "email", error: sendError(error) };
  return { email, step: "code" };
}

export async function checkCode(_: SignInState, form: FormData): Promise<SignInState> {
  const email = normaliseEmail(String(form.get("email") ?? ""));
  const token = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!isCode(token)) return { email, step: "code", error: "Enter the 6 digits from your email." };
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { email, step: "code", error: verifyError(error) };
  redirect("/");
}
