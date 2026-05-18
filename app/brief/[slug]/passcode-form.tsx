"use client";

// Brief unlock form. Posts the code to /api/brief/<slug>/unlock; on
// 200 the server has set the HttpOnly unlock cookie, so we just reload
// and the SSR pass renders the full content.
//
// Lifted from Fame's Video Review Tool passcode-form pattern — same
// security model: server-validated, content never in HTML until the
// cookie is set.

import { useState } from "react";

export function PasscodeForm({ slug }: { slug: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const trimmed = code.trim();
    if (!trimmed) {
      setErr("Enter the access code");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const resp = await fetch(
        `/api/brief/${encodeURIComponent(slug)}/unlock`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: trimmed }),
        },
      );
      if (resp.status === 401) {
        setErr("Wrong code. Try again.");
        return;
      }
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Access code"
        autoFocus
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        maxLength={20}
        className="brief-passcode-input"
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      {err && <div className="brief-passcode-error">{err}</div>}
      <button
        type="button"
        className="brief-passcode-btn"
        onClick={submit}
        disabled={busy}
      >
        {busy ? "Checking…" : "Unlock"}
      </button>
    </>
  );
}
