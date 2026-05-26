// Client-facing feedback form for a delivered shoot.
//
// URL: /feedback/<slug>. The delivered-milestone email's primary CTA
// links here. Per spec §6.5, the form captures rating + free-text +
// "book again" + open notes, and persistence will ultimately live in
// the shared Supabase project that backs delivery.fame.so. For Phase
// 1, submissions land in our local KV (`feedback:<cardId>`) and the
// Phase 4 cross-repo handoff will migrate them. Same form shape on
// both sides.
//
// The page is intentionally light - hero block mirrors the shoot
// status page so the brand stays consistent. No auth: the unguessable
// shoot slug (with 8-char hex suffix) acts as the entry token.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBySlug } from "@/lib/storage";
import { FeedbackForm } from "./feedback-form";

export const dynamic = "force-dynamic";

const FAME_LOGO_URL =
  "https://cdn.prod.website-files.com/65af97212977390aef05af1b/65bcbe23cfb0eb14d2ce0063_logo.svg";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const shoot = await getBySlug(slug);
  return {
    title: shoot ? `Feedback - ${shoot.shootNumber} - Fame Crew` : "Feedback - Fame Crew",
    description:
      "Tell us how your Fame shoot went - the good and the bad. Takes about 60 seconds.",
    robots: { index: false, follow: false },
  };
}

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const shoot = await getBySlug(slug);
  if (!shoot) notFound();

  return (
    <main className="shell">
      <header className="hero">
        <div className="hero-top">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="hero-logo" src={FAME_LOGO_URL} alt="Fame" />
        </div>
        <div className="hero-shoot-no">Shoot {shoot.shootNumber}</div>
        <h1 className="hero-title">How did we do?</h1>
        <div className="hero-meta">
          {shoot.clientName}
          {shoot.location ? (
            <>
              <span className="hero-meta-sep">·</span>
              {shoot.location}
            </>
          ) : null}
        </div>
      </header>

      <FeedbackForm
        slug={shoot.slug}
        cardId={shoot.cardId}
        shootNumber={shoot.shootNumber}
      />
    </main>
  );
}
