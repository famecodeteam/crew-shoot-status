// Google Docs API client. Reuses the shared service account (same one
// `lib/drive.ts` and `lib/google-auth.ts` use) — brief Docs are already
// shared with this SA via the per-shoot Drive folders that findShootDriveLinks
// queries, so adding the `documents.readonly` scope is enough to read them
// here without a separate OAuth dance.

import { docs_v1, google } from "googleapis";
import { googleAuth } from "./google-auth";

const DOCS_SCOPES = [
  "https://www.googleapis.com/auth/documents.readonly",
];

let docsClient: docs_v1.Docs | null = null;

function docs(): docs_v1.Docs {
  if (!docsClient) {
    const auth = googleAuth(DOCS_SCOPES);
    docsClient = google.docs({ version: "v1", auth });
  }
  return docsClient;
}

export type DocStructure = docs_v1.Schema$Document;

export async function fetchDocStructure(docId: string): Promise<DocStructure> {
  const resp = await docs().documents.get({ documentId: docId });
  return resp.data;
}
