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
import type { Asset } from "@/lib/types";
import { AssetPlayer } from "./player";

export const dynamic = "force-dynamic";

const FAME_LOGO_URL =
  "https://cdn.prod.website-files.com/65af97212977390aef05af1b/65bcbe23cfb0eb14d2ce0063_logo.svg";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; asset: string }>;
}): Promise<Metadata> {
  const { slug, asset: assetSlug } = await params;
  const shoot = await getBySlug(slug);
  if (!shoot) return { title: "Fame Crew" };
  const asset = await getAsset(shoot.cardId, assetSlug);
  if (!asset) {
    return { title: `Fame Crew - Shoot Status - ${shoot.shootNumber}` };
  }
  return { title: `${asset.name} · Fame Crew` };
}

export default async function AssetReviewPage({
  params,
}: {
  params: Promise<{ slug: string; asset: string }>;
}) {
  const { slug, asset: assetSlug } = await params;
  const shoot = await getBySlug(slug);
  if (!shoot) notFound();
  const asset = await getAsset(shoot.cardId, assetSlug);
  if (!asset) notFound();

  const latest = asset.versions.length
    ? asset.versions[asset.versions.length - 1]
    : null;

  return (
    <main className="shell">
      <header className="hero">
        <div className="hero-top">
          <Link href={`/${slug}`} aria-label="Back to shoot status">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="hero-logo" src={FAME_LOGO_URL} alt="Fame" />
          </Link>
        </div>
        <div className="hero-shoot-no">
          <Link href={`/${slug}`}>
            Shoot {shoot.shootNumber} · {shoot.clientName}
          </Link>
        </div>
        <h1 className="hero-title">{asset.name}</h1>
        {asset.notes && (
          <details className="asset-notes">
            <summary>Editor notes</summary>
            <p>{asset.notes}</p>
          </details>
        )}
      </header>

      {latest ? (
        <AssetPlayer asset={asset} initialVersion={latest.n} />
      ) : (
        <PendingUploadState />
      )}

      <footer className="footer" style={{ marginTop: 56 }}>
        <div>
          Questions? Email{" "}
          <a href={`mailto:${shoot.producerEmail}`}>{shoot.producerEmail}</a>
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
        <div>Fame Crew</div>
      </footer>
    </main>
  );
}

function PendingUploadState() {
  return (
    <section className="section">
      <div className="card asset-pending">
        <h2>Your editor is preparing this asset</h2>
        <p>Check back soon — we&apos;ll send you the review link as soon as it&apos;s ready.</p>
      </div>
    </section>
  );
}

// Helper used by the player + (later) comments. Exported so the player
// component can call it without a server round-trip.
export type AssetForPlayer = Asset;
