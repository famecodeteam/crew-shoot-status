/**
 * Shared Google service-account auth — adapted from meeting-agenda.
 * Reuses the HAM Dashboard service account
 *   ham-dashboard-runner@fame-ham-dashboard.iam.gserviceaccount.com
 *
 * Two ways to provide credentials:
 *   • GOOGLE_SERVICE_ACCOUNT_JSON — full JSON content as a single-line string (CI).
 *   • GOOGLE_APPLICATION_CREDENTIALS — path to the .json file on disk (local).
 * If both are set, GOOGLE_SERVICE_ACCOUNT_JSON wins.
 */

import { readFileSync } from "node:fs";
import { google, type Auth } from "googleapis";

let cachedCreds: object | null = null;
let cachedEmail: string | null = null;

function loadCredentials(): object {
  if (cachedCreds) return cachedCreds;

  const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const filePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  let raw: string;
  let source: string;
  if (inlineJson) {
    raw = inlineJson;
    source = "GOOGLE_SERVICE_ACCOUNT_JSON";
  } else if (filePath) {
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (err) {
      throw new Error(
        `Could not read GOOGLE_APPLICATION_CREDENTIALS=${filePath}: ${(err as Error).message}`,
      );
    }
    source = `GOOGLE_APPLICATION_CREDENTIALS (${filePath})`;
  } else {
    throw new Error(
      "No Google credentials. Set ONE of:\n" +
        "  GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json   (local)\n" +
        "  GOOGLE_SERVICE_ACCOUNT_JSON={\"type\":\"service_account\",...}      (CI)\n" +
        "Add it to .env.local in this project.",
    );
  }

  let parsed: { client_email?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${source} is not valid JSON.`);
  }
  cachedCreds = parsed;
  cachedEmail = parsed.client_email ?? null;
  return cachedCreds;
}

export function googleAuth(scopes: string[]): Auth.GoogleAuth {
  const credentials = loadCredentials();
  return new google.auth.GoogleAuth({ credentials, scopes });
}

export function serviceAccountEmail(): string {
  loadCredentials();
  return cachedEmail ?? "<unknown>";
}
