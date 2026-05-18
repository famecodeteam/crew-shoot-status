// Doc → typed brief.
//
// Phase 1 (this file): the type contract + a minimal stub that the cron
// handler can call to satisfy the BriefRecord.parsedJson field. Phase 2
// replaces parseBriefDoc with the full structural walker.

import type { docs_v1 } from "googleapis";

export type LinkValue = { text: string; url: string };

export type ScheduleRow = { time: string; what: string };

// A run of prose with inline marks (bold/italic/links) rendered to a small,
// allowlisted HTML subset. The page component sets innerHTML — the parser
// is the only producer, so the only attack surface is what we emit. Phase
// 2 builds the actual renderer; Phase 1 produces empty content.
export type ProseBlock = { html: string };

export type CrewMember = { name: string; contact?: LinkValue | string };

export type LinkCard = { label?: string; url: string };

export type Section =
  | { kind: "overview"; title: string; fields: Record<string, string | LinkValue> }
  | { kind: "objectives"; title: string; blocks: ProseBlock[] }
  | {
      kind: "production";
      title: string;
      schedule: ScheduleRow[];
      equipment: Record<string, string>;
      deliverables: ProseBlock[];
    }
  | { kind: "crew"; title: string; members: CrewMember[] }
  | { kind: "comms"; title: string; links: LinkCard[] }
  | { kind: "prose"; title: string; blocks: ProseBlock[] };

export type ParsedBrief = {
  header: { briefNumber: string; clientName: string; eventName: string };
  sections: Section[];
};

// Section titles to drop at sync time. Matched case-insensitively against
// the heading text with the leading "N." number stripped. Extend here when
// the producer wants a new section to stay crew-only.
export const EXCLUDED_SECTION_TITLES: string[] = [
  "Questions for the Client Call",
];

export function isExcludedSection(rawTitle: string): boolean {
  const stripped = rawTitle.replace(/^\s*\d+\.\s*/, "").trim().toLowerCase();
  return EXCLUDED_SECTION_TITLES.some((t) => t.toLowerCase() === stripped);
}

// Phase 1 stub. Returns header derived from the Doc title, no sections.
// Phase 2 replaces the body with the structural walker described in the
// build brief (HEADING_3 split, section-title → kind map, prose fallback).
export function parseBriefDoc(doc: docs_v1.Schema$Document): ParsedBrief {
  const title = (doc.title ?? "").trim();
  // Loose "Brief #NNNN - Client - Event" parse; falls back gracefully when
  // the title doesn't follow the convention.
  const m = title.match(/^Brief\s+#?(\S+)\s*[-–—]\s*([^-–—]+?)\s*[-–—]\s*(.+)$/i);
  const header = m
    ? { briefNumber: m[1].trim(), clientName: m[2].trim(), eventName: m[3].trim() }
    : { briefNumber: "", clientName: "", eventName: title };
  return { header, sections: [] };
}
