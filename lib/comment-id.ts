// Short, URL-safe IDs for comments + author tokens. crypto.randomUUID()
// is too long for nice URLs and not Base62-pretty; we use a 6-char
// hex hash for IDs (collision space ~16M - plenty for per-version
// threads) and a 32-byte hex token for author auth (~128-bit secret).

import { randomBytes } from "node:crypto";

export function newCommentId(): string {
  return `cmt_${randomBytes(4).toString("hex")}`;
}

// Activity-stream entry id (shared-KV contract v2 §5). "act_" + 8 hex.
export function newActivityId(): string {
  return `act_${randomBytes(4).toString("hex")}`;
}

export function newAuthorToken(): string {
  return randomBytes(32).toString("hex");
}
