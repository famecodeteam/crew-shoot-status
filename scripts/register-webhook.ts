// Trello webhook registration CLI.
//
//   pnpm register-webhook              — register against TRELLO_BOARD_ID + TRELLO_WEBHOOK_CALLBACK_URL (idempotent)
//   pnpm register-webhook --list       — list existing webhooks for this token
//   pnpm register-webhook --delete <id>— delete a webhook by id
//
// Idempotency: if a webhook for the same (idModel, callbackURL) pair already
// exists, we re-PUT it (re-actives + bumps the description) rather than
// creating a duplicate.
//
// On creation, Trello immediately HEADs the callback URL to verify it. Our
// /api/trello-webhook route returns 200 on HEAD, so this should succeed —
// if it doesn't, double-check the deployment is live and the URL is correct.

const API = "https://api.trello.com/1";

type Webhook = {
  id: string;
  idModel: string;
  callbackURL: string;
  description: string;
  active: boolean;
};

function creds(): { key: string; token: string } {
  const key = process.env.TRELLO_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token) {
    throw new Error("TRELLO_KEY and TRELLO_TOKEN must be set in .env.local.");
  }
  return { key, token };
}

// Trello's webhook endpoint requires a canonical (long) idModel; the board
// shortLink we use everywhere else is rejected with 400. Resolve it once.
async function resolveBoardId(shortOrLong: string): Promise<string> {
  // Long IDs are 24 hex chars; shortLinks are 8 alphanumeric. Cheap heuristic.
  if (/^[a-f0-9]{24}$/i.test(shortOrLong)) return shortOrLong;
  const { key, token } = creds();
  const resp = await fetch(
    `${API}/boards/${encodeURIComponent(shortOrLong)}?fields=id&key=${key}&token=${token}`,
  );
  if (!resp.ok) {
    throw new Error(`resolve board id: ${resp.status} ${await resp.text()}`);
  }
  const body = (await resp.json()) as { id: string };
  return body.id;
}

async function listWebhooks(): Promise<Webhook[]> {
  const { key, token } = creds();
  const resp = await fetch(`${API}/tokens/${token}/webhooks?key=${key}&token=${token}`);
  if (!resp.ok) throw new Error(`list webhooks: ${resp.status} ${await resp.text()}`);
  return (await resp.json()) as Webhook[];
}

async function createWebhook(
  idModel: string,
  callbackURL: string,
  description: string,
): Promise<Webhook> {
  const { key, token } = creds();
  const resp = await fetch(`${API}/webhooks?key=${key}&token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idModel, callbackURL, description, active: true }),
  });
  if (!resp.ok) {
    throw new Error(`create webhook: ${resp.status} ${await resp.text()}`);
  }
  return (await resp.json()) as Webhook;
}

async function updateWebhook(
  id: string,
  idModel: string,
  callbackURL: string,
  description: string,
): Promise<Webhook> {
  const { key, token } = creds();
  const resp = await fetch(`${API}/webhooks/${id}?key=${key}&token=${token}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idModel, callbackURL, description, active: true }),
  });
  if (!resp.ok) {
    throw new Error(`update webhook: ${resp.status} ${await resp.text()}`);
  }
  return (await resp.json()) as Webhook;
}

async function deleteWebhook(id: string): Promise<void> {
  const { key, token } = creds();
  const resp = await fetch(`${API}/webhooks/${id}?key=${key}&token=${token}`, {
    method: "DELETE",
  });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`delete webhook: ${resp.status} ${await resp.text()}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === "--list") {
    const hooks = await listWebhooks();
    if (hooks.length === 0) {
      console.log("(no webhooks registered for this token)");
      return;
    }
    for (const h of hooks) {
      console.log(
        `  ${h.id}  idModel=${h.idModel}  active=${h.active}  url=${h.callbackURL}`,
      );
      if (h.description) console.log(`    description: ${h.description}`);
    }
    return;
  }

  if (args[0] === "--delete") {
    const id = args[1];
    if (!id) {
      console.error("Usage: pnpm register-webhook --delete <webhook-id>");
      process.exit(2);
    }
    await deleteWebhook(id);
    console.log(`deleted ${id}`);
    return;
  }

  // Default: register (or update existing) for the configured board + URL.
  const boardRef = process.env.TRELLO_BOARD_ID;
  const callbackURL = process.env.TRELLO_WEBHOOK_CALLBACK_URL;
  if (!boardRef) throw new Error("TRELLO_BOARD_ID is unset.");
  const idModel = await resolveBoardId(boardRef);
  if (idModel !== boardRef) {
    console.log(`(resolved board shortLink ${boardRef} → ${idModel})`);
  }
  if (!callbackURL) {
    throw new Error(
      "TRELLO_WEBHOOK_CALLBACK_URL is unset. Set it to the public URL Trello will POST to, e.g. https://shoots.fame.so/api/trello-webhook",
    );
  }

  const description = `crew-shoot-status (${new Date().toISOString().slice(0, 10)})`;

  // Check if a webhook for this exact pair already exists. If so, re-PUT to
  // keep it active + refresh the description.
  const existing = await listWebhooks();
  const match = existing.find(
    (h) => h.idModel === idModel && h.callbackURL === callbackURL,
  );

  if (match) {
    const updated = await updateWebhook(match.id, idModel, callbackURL, description);
    console.log(`updated existing webhook ${updated.id}`);
    console.log(`  idModel:     ${updated.idModel}`);
    console.log(`  callbackURL: ${updated.callbackURL}`);
    console.log(`  active:      ${updated.active}`);
  } else {
    const created = await createWebhook(idModel, callbackURL, description);
    console.log(`created new webhook ${created.id}`);
    console.log(`  idModel:     ${created.idModel}`);
    console.log(`  callbackURL: ${created.callbackURL}`);
    console.log(`  active:      ${created.active}`);
    console.log(
      "\nNote: Trello will HEAD the callback URL on every API restart;\n" +
        "if your deployment goes down, the webhook auto-deactivates after a few\n" +
        "failed attempts. Re-run this script to re-activate.",
    );
  }
}

main().catch((err) => {
  console.error("[register-webhook] failed:", err);
  process.exit(1);
});
