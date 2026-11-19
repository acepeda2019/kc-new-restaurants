"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const passcode = new FormData(event.currentTarget).get("passcode");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode }),
    }).catch(() => null);
    if (res?.ok) {
      router.replace("/");
      return;
    }
    setError(res?.status === 401 ? "Wrong passcode." : "Could not sign in. Try again.");
    setPending(false);
  }

  return (
    <main className="login">
      <h1>King County New Eats</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="passcode">Passcode</label>
        <input
          id="passcode"
          name="passcode"
          type="password"
          autoComplete="current-password"
          maxLength={200}
          required
        />
        <button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Enter"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}
