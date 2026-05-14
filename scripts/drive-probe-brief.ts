// Diagnostic: why does the brief lookup pick the wrong / no doc for a
// given shoot? Inspects the #NNNN folders + their contents, and resolves
// a known-correct doc to see how the real brief is named / where it sits.
//   pnpm tsx --env-file=.env.local scripts/drive-probe-brief.ts

import { google } from "googleapis";
import { googleAuth, serviceAccountEmail } from "../lib/google-auth";
import { findShootDriveLinks } from "../lib/drive";

const SHOOT_NUMBERS = ["0202", "0219"];
// The brief Tom says #0202 SHOULD be pointing at.
const KNOWN_GOOD_DOC = "1lv8lp2J-kzRvbq5WN1gkFn5PkWYAGrU-hMVbQfWN5j8";

async function main() {
  console.log(`SA: ${serviceAccountEmail()}\n`);
  const auth = googleAuth(["https://www.googleapis.com/auth/drive.readonly"]);
  const drive = google.drive({ version: "v3", auth });

  // --- Resolve the known-good brief doc: name + where it lives ---
  console.log(`=== Known-good #0202 brief (${KNOWN_GOOD_DOC}) ===`);
  try {
    const doc = await drive.files.get({
      fileId: KNOWN_GOOD_DOC,
      fields: "id, name, mimeType, parents, webViewLink",
      supportsAllDrives: true,
    });
    console.log(`  name:    "${doc.data.name}"`);
    console.log(`  mime:    ${doc.data.mimeType}`);
    console.log(`  parents: ${JSON.stringify(doc.data.parents)}`);
    for (const pid of doc.data.parents ?? []) {
      const p = await drive.files.get({
        fileId: pid,
        fields: "id, name, parents",
        supportsAllDrives: true,
      });
      console.log(`    parent ${pid}: "${p.data.name}"  (its parents: ${JSON.stringify(p.data.parents)})`);
    }
  } catch (err) {
    console.log(`  ❌ ${(err as Error).message.split("\n")[0]}`);
  }

  // --- For each shoot number: find #NNNN folders + folders containing NNNN ---
  for (const num of SHOOT_NUMBERS) {
    console.log(`\n=== Shoot #${num} ===`);

    // a. Exact "#NNNN" folders (what findShootDriveLinks looks for)
    const exact = await drive.files.list({
      q: `name = '#${num}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id, name, parents, webViewLink, driveId)",
      pageSize: 20,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const exactFolders = exact.data.files ?? [];
    console.log(`  folders named exactly "#${num}": ${exactFolders.length}`);

    // b. Any folder with the number in the name (in case naming differs)
    const loose = await drive.files.list({
      q: `name contains '${num}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id, name, parents, driveId)",
      pageSize: 20,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const looseFolders = loose.data.files ?? [];
    console.log(`  folders with "${num}" anywhere in name: ${looseFolders.length}`);
    for (const f of looseFolders) {
      console.log(`    "${f.name}"  (id ${f.id})`);
    }

    // c. List the docs/PDFs inside each exact "#NNNN" folder
    for (const folder of exactFolders) {
      if (!folder.id) continue;
      console.log(`  -- contents of "#${num}" folder ${folder.id} --`);
      const filesResp = await drive.files.list({
        q: `'${folder.id}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/pdf')`,
        fields: "files(id, name, mimeType, webViewLink, modifiedTime)",
        orderBy: "modifiedTime desc",
        pageSize: 100,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      const files = filesResp.data.files ?? [];
      if (files.length === 0) console.log(`     (no docs/PDFs)`);
      for (const f of files) {
        const kind = f.mimeType === "application/pdf" ? "PDF" : "DOC";
        const tags: string[] = [];
        const lname = (f.name ?? "").toLowerCase();
        if (lname.includes("brief")) tags.push("←brief-match");
        if (lname.includes("quote")) tags.push("←quote-match");
        if (lname.includes(num)) tags.push("←has-shoot-num");
        console.log(`     [${kind}] "${f.name}"  ${tags.join(" ")}  (id ${f.id})`);
      }
    }

    // d. Also: any DOC anywhere with "brief" + this shoot number in the name
    const briefSearch = await drive.files.list({
      q: `name contains '${num}' and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
      fields: "files(id, name, parents)",
      pageSize: 20,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const briefDocs = briefSearch.data.files ?? [];
    console.log(`  docs anywhere with "${num}" in name: ${briefDocs.length}`);
    for (const f of briefDocs) {
      console.log(`    "${f.name}"  (id ${f.id}, parents ${JSON.stringify(f.parents)})`);
    }
  }

  // --- What findShootDriveLinks() actually resolves now (the real fn) ---
  console.log(`\n=== findShootDriveLinks() output (the live logic) ===`);
  for (const num of SHOOT_NUMBERS) {
    const links = await findShootDriveLinks(`#${num}`);
    console.log(`  #${num}:`);
    console.log(`    briefUrl:  ${links.briefUrl ?? "(none)"}`);
    console.log(`    briefName: ${links.briefName ?? "(none)"}`);
    console.log(`    quoteUrl:  ${links.quoteUrl ?? "(none)"}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("probe failed:", err?.stack ?? err);
    process.exit(1);
  });
