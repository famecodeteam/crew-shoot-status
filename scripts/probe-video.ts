// Diagnostic: inspect a Drive video file's specs to reason about why
// playback is slow (size / bitrate / resolution / duration).
//   pnpm tsx --env-file=.env.local scripts/probe-video.ts <fileId>

import { google } from "googleapis";
import { googleAuth, serviceAccountEmail } from "../lib/google-auth";

const FILE_ID = process.argv[2] || "1zRZ65jxa8ZM9C7aroXp2y7NiirL8GLXC";

async function main() {
  console.log(`SA: ${serviceAccountEmail()}\n`);
  const auth = googleAuth(["https://www.googleapis.com/auth/drive.readonly"]);
  const drive = google.drive({ version: "v3", auth });

  const f = await drive.files.get({
    fileId: FILE_ID,
    fields: "id,name,size,mimeType,videoMediaMetadata,createdTime",
    supportsAllDrives: true,
  });
  const d = f.data;
  const sizeBytes = Number(d.size ?? 0);
  const vm = d.videoMediaMetadata;
  const durSec = vm?.durationMillis ? Number(vm.durationMillis) / 1000 : null;

  console.log(`name:      ${d.name}`);
  console.log(`mimeType:  ${d.mimeType}`);
  console.log(`size:      ${(sizeBytes / 1e6).toFixed(0)} MB  (${sizeBytes} bytes)`);
  console.log(`resolution:${vm?.width ?? "?"}x${vm?.height ?? "?"}`);
  console.log(`duration:  ${durSec ? durSec.toFixed(1) + "s" : "unknown"}`);
  if (durSec && sizeBytes) {
    const mbps = (sizeBytes * 8) / durSec / 1e6;
    console.log(`bitrate:   ${mbps.toFixed(1)} Mbps`);
    const webMB = (8 * durSec) / 8; // 8 Mbps -> MB
    console.log(
      `for ref:   a web-optimised 1080p H.264 export (~8 Mbps) of this length is ~${webMB.toFixed(0)} MB`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.stack ?? e?.message ?? e);
    process.exit(1);
  });
