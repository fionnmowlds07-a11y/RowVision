"use client";

import { useActionState, useState } from "react";
import { checkCode, sendCode, type SignInState } from "./actions";

const START: SignInState = { email: "", step: "email" };

export function SignInForm() {
  const [sent, send, sending] = useActionState(sendCode, START);
  const [checked, check, checking] = useActionState(checkCode, sent);
  const [changing, setChanging] = useState(false);

  if (sent.step === "code" && !changing) {
    return (
      <form action={check} className="card stack">
        <input type="hidden" name="email" value={sent.email} />
        <p className="soft">We sent a 6-digit code to {sent.email}. It lasts 10 minutes.</p>
        <label className="field">
          Code
          <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
        </label>
        {checked.error ? <p role="alert" className="error">{checked.error}</p> : null}
        <button className="button primary" disabled={checking}>
          {checking ? "Checking" : "Sign in"}
        </button>
        <button type="button" className="button quiet" onClick={() => setChanging(true)}>
          Use a different email
        </button>
      </form>
    );
  }

  return (
    <form action={send} onSubmit={() => setChanging(false)} className="card stack">
      <label className="field">
        Email
        <input name="email" type="email" autoComplete="email" placeholder="you@example.com" defaultValue={sent.email} required />
      </label>
      {sent.error ? <p role="alert" className="error">{sent.error}</p> : null}
      <button className="button primary" disabled={sending}>
        {sending ? "Sending" : "Send my code"}
      </button>
    </form>
  );
}
