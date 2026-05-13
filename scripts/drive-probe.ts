// Diagnostic: list folders the service account can see that look like
// shoot folders. Helps figure out the actual naming convention vs. the
// "#NNNN" Crew Scout assumes.

import { google } from "googleapis";
import { googleAuth, serviceAccountEmail } from "../lib/google-auth";

const ROOT_ID = "1cE89gQA21fr9Mre8V3IyJTqoByrLMOdb";

async function main() {
  console.log(`SA: ${serviceAccountEmail()}`);

  const auth = googleAuth(["https://www.googleapis.com/auth/drive.readonly"]);
  const drive = google.drive({ version: "v3", auth });

  // 0. Can the SA see the root folder Tom pointed at?
  console.log(`\n--- 0. Access check on root folder ${ROOT_ID} ---`);
  try {
    const meta = await drive.files.get({
      fileId: ROOT_ID,
      fields: "id,name,mimeType,driveId",
      supportsAllDrives: true,
    });
    console.log(
      `  ✅ Accessible: name="${meta.data.name}", drive=${meta.data.driveId ?? "personal"}`,
    );
  } catch (err) {
    const msg = (err as Error).message.split("\n")[0];
    console.log(`  ❌ NOT accessible: ${msg}`);
  }

  // 1. Try the exact "#NNNN" pattern Crew Scout assumes - see if any match.
  console.log("\n--- 1. Folders matching `name contains '#0'` ---");
  const exactProbe = await drive.files.list({
    q: "name contains '#0' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: "files(id, name, parents, driveId)",
    pageSize: 30,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const exactFiles = exactProbe.data.files ?? [];
  console.log(`Found ${exactFiles.length}`);
  for (const f of exactFiles.slice(0, 15)) {
    console.log(`  "${f.name}"  (id ${f.id}, drive ${f.driveId ?? "personal"})`);
  }

  // 2. Search for the most recent active client name to find the folder.
  console.log("\n--- 2. Folders containing 'Flagright' ---");
  const flagProbe = await drive.files.list({
    q: "name contains 'Flagright' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: "files(id, name, parents, driveId)",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const flagFiles = flagProbe.data.files ?? [];
  console.log(`Found ${flagFiles.length}`);
  for (const f of flagFiles) {
    console.log(`  "${f.name}"  (id ${f.id})`);
  }

  // 3. Folders containing '0189' anywhere in the name.
  console.log("\n--- 3. Folders containing '0189' ---");
  const numProbe = await drive.files.list({
    q: "name contains '0189' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: "files(id, name, parents, driveId)",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const numFiles = numProbe.data.files ?? [];
  console.log(`Found ${numFiles.length}`);
  for (const f of numFiles) {
    console.log(`  "${f.name}"  (id ${f.id})`);
  }

  // 4. Top-level folders the SA has access to (in shared drives).
  console.log("\n--- 4. First 30 folders the SA can see (any name) ---");
  const allProbe = await drive.files.list({
    q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: "files(id, name, parents, driveId)",
    pageSize: 30,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    orderBy: "modifiedTime desc",
  });
  const allFiles = allProbe.data.files ?? [];
  console.log(`Found ${allFiles.length} (capped at 30)`);
  for (const f of allFiles) {
    console.log(`  "${f.name}"  (drive ${f.driveId ?? "personal"})`);
  }
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
