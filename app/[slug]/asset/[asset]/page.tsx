// Asset review page (client-facing).
//
//   URL: /<shoot-slug>/asset/<asset-slug>
//
// The shoot slug is for breadcrumbs / context only; the asset slug is
// the unique identifier and what the player + comments + approval
// endpoints key off.
//
// Renders one of three states:
//   • shoot or asset not found      → 404
//   • asset has no finished version → placeholder ("editor preparing")
//   • asset has ≥1 version          → branded player + (later) comments
//                                      + approval bar

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getBySlug } from "@/lib/storage";
import { getAsset } from "@/lib/asset-storage";
import { findAssetBySlug } from "@/lib/asset-lookup";
import { clientVersions } from "@/lib/asset-versions";
import { getAssetsLocked } from "@/lib/assets-lock";
import type { Asset, Shoot } from "@/lib/types";
import { ReviewShell } from "./review-shell";

export const dynamic = "force-dynamic";

const FAME_LOGO_URL =
  "https://cdn.prod.website-files.com/65af97212977390aef05af1b/65bcbe23cfb0eb14d2ce0063_logo.svg";

// Client-facing "Questions?" contact - always the shared inbox, never an
// individual producer's personal address. Mirrors app/[slug]/page.tsx.
const SHARED_CREW_EMAIL = "crew@fame.so";

// Resolve the shoot + asset for this URL. The asset slug is globally unique
// (random suffix), so when the shoot slug in the URL is stale - e.g. it was
// regenerated in a data migration - we still recover the asset and its real
// shoot by asset slug alone, keeping old /<shoot>/asset/<asset> links alive.
async function resolveShootAsset(
  slug: string,
  assetSlug: string,
): Promise<{ shoot: Shoot; asset: Asset } | null> {
  const shoot = await getBySlug(slug);
  if (shoot) {
    const asset = await getAsset(shoot.cardId, assetSlug);
    if (asset) return { shoot, asset };
  }
  const found = await findAssetBySlug(assetSlug);
  return found ? { shoot: found.shoot, asset: found.asset } : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; asset: string }>;
}): Promise<Metadata> {
  const { slug, asset: assetSlug } = await params;
  const resolved = await resolveShootAsset(slug, assetSlug);
  if (!resolved) return { title: "Fame Crew" };
  const { shoot, asset } = resolved;
  return {
    title: `${asset.name} · ${shoot.clientName} · Fame Crew`,
    description: `Review and approve ${asset.name} for ${shoot.clientName}'s shoot (${shoot.shootNumber}).`,
  };
}

export default async function AssetReviewPage({
  params,
}: {
  params: Promise<{ slug: string; asset: string }>;
}) {
  const { slug, asset: assetSlug } = await params;
  const resolved = await resolveShootAsset(slug, assetSlug);
  if (!resolved) notFound();
  const { shoot, asset } = resolved;

  // Publish gate (contract v2 §4). Filter at the server boundary:
  // <ReviewShell> serialises its entire `asset` prop into the public
  // browser payload, so an unpublished version must be dropped *before*
  // it crosses into the client component - filtering only inside
  // ReviewShell would still ship the unpublished version's driveFileId /
  // streamUid to the browser. Absent flag ⇒ published (clientVersions).
  const visibleAsset: Asset = {
    ...asset,
    versions: clientVersions(asset),
  };
  const latest = visibleAsset.versions.length
    ? visibleAsset.versions[visibleAsset.versions.length - 1]
    : null;

  // Unpaid-invoice lock (set by the CPM on member.fame.so). When on, the
  // review surface hides the download bar and blocks the player's own
  // save/download affordances. Playback stays so the client can still review.
  const locked = await getAssetsLocked(shoot.cardId).catch(() => false);

  return (
    <main className="shell">
      <header className="hero">
        <div className="hero-top">
          <Link href={`/${shoot.slug}`} aria-label="Back to shoot status">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="hero-logo" src={FAME_LOGO_URL} alt="Fame" />
          </Link>
        </div>
        <div className="hero-shoot-no">
          <Link href={`/${shoot.slug}`}>
            Shoot {shoot.shootNumber} · {shoot.clientName}
          </Link>
        </div>
        <h1 className="hero-title">{asset.name}</h1>
      </header>

      {latest ? (
        <ReviewShell
          asset={visibleAsset}
          streamCustomerCode={process.env.CF_STREAM_CUSTOMER_CODE ?? null}
          locked={locked}
        />
      ) : (
        <PendingUploadState />
      )}

      <footer className="footer" style={{ marginTop: 56 }}>
        <div>
          Questions? Email{" "}
          <a href={`mailto:${SHARED_CREW_EMAIL}`}>{SHARED_CREW_EMAIL}</a>
          {shoot.clientWhatsappUrl && (
            <>
              {" "}or{" "}
              <a href={shoot.clientWhatsappUrl} target="_blank" rel="noreferrer">
                message us on WhatsApp
              </a>
            </>
          )}
          .
        </div>
        <div>Made with ❤️ by Fame Crew</div>
      </footer>
    </main>
  );
}

function PendingUploadState() {
  return (
    <section className="section">
      <div className="card asset-pending">
        <h2>Your editor is preparing this asset</h2>
        <p>Check back soon - we&apos;ll send you the review link as soon as it&apos;s ready.</p>
      </div>
    </section>
  );
}

// Helper used by the player + (later) comments. Exported so the player
// component can call it without a server round-trip.
export type AssetForPlayer = Asset;
