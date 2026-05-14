// Diagnostic: inspect a Drive folder + verify findShootDriveLinks output.
// Used to work out why brief/quote lookup picks the wrong (or no) file.
//   pnpm tsx --env-file=.env.local scripts/drive-probe-brief.ts

import { google } from "googleapis";
import { googleAuth, serviceAccountEmail } from "../lib/google-auth";
import { findShootDriveLinks } from "../lib/drive";

// Folder to inspect fully (the real #0219 shoot folder per Tom).
const INSPECT_FOLDER = "1kNGhgO_GAN-W8DvDa5qXJFTv70E7NjjF";
// Shoot numbers to run the live lookup against.
const SHOOT_NUMBERS = ["0202", "0219"];

async function main() {
  console.log(`SA: ${serviceAccountEmail()}\n`);
  const auth = googleAuth(["https://www.googleapis.com/auth/drive.readonly"]);
  const drive = google.drive({ version: "v3", auth });

  // --- Inspect the folder: name, parent chain, ALL children ---
  console.log(`=== Folder ${INSPECT_FOLDER} ===`);
  try {
    const meta = await drive.files.get({
      fileId: INSPECT_FOLDER,
      fields: "id, name, mimeType, parents, webViewLink, driveId",
      supportsAllDrives: true,
    });
    console.log(`  name:    "${meta.data.name}"`);
    console.log(`  drive:   ${meta.data.driveId ?? "personal"}`);
    console.log(`  parents: ${JSON.stringify(meta.data.parents)}`);
    for (const pid of meta.data.parents ?? []) {
      const p = await drive.files.get({
        fileId: pid,
        fields: "id, name, parents",
        supportsAllDrives: true,
      });
      console.log(`    parent "${p.data.name}" (${pid})`);
    }
  } catch (err) {
    console.log(`  ❌ ${(err as Error).message.split("\n")[0]}`);
  }

  console.log(`\n  -- ALL children (any type) --`);
  const children = await drive.files.list({
    q: `'${INSPECT_FOLDER}' in parents and trashed = false`,
    fields: "files(id, name, mimeType, webViewLink, modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const files = children.data.files ?? [];
  if (files.length === 0) console.log(`     (empty)`);
  for (const f of files) {
    const m = f.mimeType ?? "";
    const kind = m.includes("folder")
      ? "FOLDER"
      : m.includes("pdf")
        ? "PDF"
        : m.includes("document")
          ? "DOC"
          : m.split(".").pop()?.slice(0, 8) ?? "?";
    const tags: string[] = [];
    const lname = (f.name ?? "").toLowerCase();
    if (lname.includes("brief")) tags.push("←brief");
    if (lname.includes("quote")) tags.push("←quote");
    console.log(`     [${kind.padEnd(6)}] "${f.name}"  ${tags.join(" ")}  (id ${f.id})`);
  }

  // --- What findShootDriveLinks resolves now ---
  console.log(`\n=== findShootDriveLinks() output (live logic) ===`);
  for (const num of SHOOT_NUMBERS) {
    const links = await findShootDriveLinks(`#${num}`);
    console.log(`  #${num}:`);
    console.log(`    briefUrl:  ${links.briefUrl ?? "(none)"}  [${links.briefName ?? "-"}]`);
    console.log(`    quoteUrl:  ${links.quoteUrl ?? "(none)"}  [${links.quoteName ?? "-"}]`);
    console.log(`    folderUrl: ${links.shootFolderUrl ?? "(none)"}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("probe failed:", err?.stack ?? err);
    process.exit(1);
  });
