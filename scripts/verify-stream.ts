// M1 smoke test for lib/stream.ts. Ingests a small public test video,
// polls it to "ready", prints the playback URLs, then deletes it -
// exercising copyFromUrl + getVideo + deleteVideo in one run.
//   pnpm tsx --env-file=.env.local scripts/verify-stream.ts

import { copyFromUrl, getVideo, deleteVideo, streamHlsUrl } from "../lib/stream";

// A small public test MP4 (~1 MB, 10s) served with Content-Length +
// Accept-Ranges - which Cloudflare's copy-from-URL needs to size the file.
const TEST_VIDEO_URL =
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4";

async function main() {
  console.log("1. copyFromUrl - ingesting test video...");
  const created = await copyFromUrl(TEST_VIDEO_URL, "fame-stream-m1-verify");
  const uid = created.uid;
  console.log(`   uid: ${uid}  state: ${created.status.state}`);

  console.log("2. polling getVideo until ready...");
  let video = created;
  const startedAt = Date.now();
  while (!video.readyToStream && video.status.state !== "error") {
    if (Date.now() - startedAt > 5 * 60 * 1000) {
      throw new Error("timed out waiting for transcode (>5 min)");
    }
    await new Promise((r) => setTimeout(r, 4000));
    video = await getVideo(uid);
    console.log(
      `   state: ${video.status.state}  pct: ${video.status.pctComplete ?? "-"}`,
    );
  }
  if (video.status.state === "error") {
    throw new Error(
      `transcode failed: ${video.status.errorReasonText ?? video.status.errorReasonCode}`,
    );
  }
  console.log(
    `   ready. duration=${video.duration}s thumbnail=${video.thumbnail ?? "-"}`,
  );
  console.log(`   playback.hls (from API):  ${video.playback?.hls ?? "-"}`);
  console.log(`   streamHlsUrl (from code): ${streamHlsUrl(uid)}`);

  console.log("3. deleteVideo - cleaning up the test video...");
  await deleteVideo(uid);
  console.log("   deleted.");

  console.log(
    "\nM1 verify OK - copyFromUrl + getVideo + deleteVideo all work.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("verify failed:", e?.stack ?? e?.message ?? e);
    process.exit(1);
  });
