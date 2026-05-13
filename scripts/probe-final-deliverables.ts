// One-shot probe: walk the SA's view of Drive, find any folder named
// "Final Deliverables", peek inside to find MP4 candidates for the
// playback POC. Tom can pick the file ID to test with.

import { google } from "googleapis";
import { googleAuth } from "../lib/google-auth";

async function main() {
  const auth = googleAuth(["https://www.googleapis.com/auth/drive.readonly"]);
  const drive = google.drive({ version: "v3", auth });

  console.log('Searching for "Final Deliverables" folders…');
  const folders = await drive.files.list({
    q: `name = 'Final Deliverables' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name, parents)",
    pageSize: 50,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const all = folders.data.files ?? [];
  console.log(`Found ${all.length} "Final Deliverables" folders\n`);

  for (const f of all) {
    console.log(`📁 ${f.id}`);
    // Get the parent folder name (the shoot folder #NNNN, hopefully)
    if (f.parents?.[0]) {
      try {
        const parent = await drive.files.get({
          fileId: f.parents[0],
          fields: "name",
          supportsAllDrives: true,
        });
        console.log(`   parent: ${parent.data.name}`);
      } catch {
        console.log("   parent: <can't access>");
      }
    }

    const children = await drive.files.list({
      q: `'${f.id}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, size)",
      pageSize: 50,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const c of children.data.files ?? []) {
      const sizeMB = c.size ? Math.round(Number(c.size) / 1024 / 1024) : null;
      const isFolder = c.mimeType === "application/vnd.google-apps.folder";
      if (isFolder) {
        console.log(`   📁 ${c.name}`);
        const sub = await drive.files.list({
          q: `'${c.id}' in parents and trashed = false`,
          fields: "files(id, name, mimeType, size)",
          pageSize: 20,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        for (const s of sub.data.files ?? []) {
          const ssize = s.size ? Math.round(Number(s.size) / 1024 / 1024) : "?";
          console.log(
            `      ${s.mimeType?.includes("video") ? "🎬" : "📄"} ${s.name}  ${ssize}MB  id=${s.id}`,
          );
        }
      } else {
        const icon = c.mimeType?.startsWith("video/") ? "🎬" : "📄";
        console.log(`   ${icon} ${c.name}  ${sizeMB}MB  id=${c.id}`);
      }
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
