"use client";

import { useActionState } from "react";
import { addEmail } from "./actions";

export function AddEmailForm() {
  const [state, add, adding] = useActionState(addEmail, {});
  return (
    <form action={add} className="card stack">
      <h2 style={{ fontSize: 19 }}>Add someone</h2>
      <label className="field">
        Email
        <input name="email" type="email" required />
      </label>
      <label className="field">
        Note, if you like
        <input name="note" maxLength={200} placeholder="Senior eight" />
      </label>
      {state.error ? <p role="alert" className="error">{state.error}</p> : null}
      <button className="button primary" disabled={adding}>Add to the list</button>
    </form>
  );
}
