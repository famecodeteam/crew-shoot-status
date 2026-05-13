// STEP 0 POC harness — picks up ?id=DRIVE_FILE_ID from the URL and drops
// it into a plain HTML5 <video src=...>. Validates that the Drive proxy
// route streams cleanly + supports seek in mobile Safari.
//
// Default file: "Testimonial Videos (Highlights Style) v.3.mp4" (286MB).

export const dynamic = "force-dynamic";

const DEFAULT_ID = "1cSxFXfQCl-up5rOV8zJFefDU724iTpkp";

export default async function PocPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const sp = await searchParams;
  const fileId = sp.id || DEFAULT_ID;
  const src = `/api/test-video?id=${encodeURIComponent(fileId)}`;

  return (
    <main
      style={{
        maxWidth: 920,
        margin: "32px auto",
        padding: "0 16px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ marginBottom: 12 }}>Drive proxy playback POC</h1>
      <p style={{ color: "#555", marginBottom: 16 }}>
        File ID: <code>{fileId}</code> · Proxy: <code>{src}</code>
      </p>
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        style={{
          width: "100%",
          height: "auto",
          background: "black",
          borderRadius: 8,
        }}
      />
      <p style={{ color: "#555", fontSize: 13, marginTop: 12 }}>
        Test plan: play, scrub to mid-video, scrub back to start. Try on
        desktop Chrome, iOS Safari, Android Chrome. Override the file via
        ?id=DRIVE_FILE_ID.
      </p>
    </main>
  );
}
