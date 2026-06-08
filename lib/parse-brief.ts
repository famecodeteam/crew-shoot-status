// Doc → typed brief.
//
// Walks the Docs API structural response, splits on HEADING_3 paragraphs,
// and dispatches each section to a typed parser based on its title. Unknown
// section titles fall through to a 'prose' renderer so nothing is silently
// dropped (except sections in EXCLUDED_SECTION_TITLES, which are dropped
// intentionally).
//
// The page renderer (phase 3) uses dangerouslySetInnerHTML for prose blocks;
// the only HTML emitter in this pipeline is `renderRichText` in doc-walker,
// which escapes text and only emits <strong>/<em>/<a> with explicit hrefs.

import type { docs_v1 } from "googleapis";
import {
  bulletLevel,
  escapeHtml,
  firstLink,
  isBulleted,
  isHeading3,
  paragraphs as docParagraphs,
  plainTextTrimmed,
  renderRichText,
  splitLabelValue,
  type Paragraph,
} from "./doc-walker";

export type LinkValue = { text: string; url: string };

export type ScheduleRow = { time: string; what: string };

// A run of prose with inline marks (bold/italic/links) pre-rendered to a
// small HTML subset. The page sets innerHTML; the only HTML producer is
// doc-walker.renderRichText, which escapes text and emits a fixed allowlist.
//
// `bullet` is true when the source paragraph was bulleted in the Doc. The
// renderer groups consecutive bullet blocks into a single <ul>. `level`
// carries the Doc's nestingLevel through so the renderer can rebuild the
// tree (so "Reference 1" stays nested under "2x sizzle reels", which
// stays nested under "Deliverables", etc.).
export type ProseBlock = { html: string; bullet?: boolean; level?: number };

// CrewMember has two production sources:
//   • The brief Doc's "Team On-Site" section (parser-populated).
//     Yields {name, contact} where contact is a WhatsApp/Phone string
//     or a hyperlinked LinkValue.
//   • The matching Shoot record on the brief page (page-level override).
//     Yields {name, bio, photoUrl, vetted} for the richer card seen on
//     the status page — preferred when available so the brief mirrors
//     the status-page treatment instead of the Doc's contact-only row.
export type CrewMember = {
  name: string;
  contact?: LinkValue | string;
  bio?: string;
  photoUrl?: string;
  vetted?: boolean;
};

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

// Sections never surfaced on the public page. Case-insensitive, matched
// after stripping the leading "N." number. Extend here when the producer
// wants a new section to stay crew-only.
export const EXCLUDED_SECTION_TITLES: string[] = [
  "Questions for the Client Call",
];

export function isExcludedSection(rawTitle: string): boolean {
  const stripped = stripLeadingNumber(rawTitle).toLowerCase();
  return EXCLUDED_SECTION_TITLES.some((t) => t.toLowerCase() === stripped);
}

function stripLeadingNumber(s: string): string {
  return s.replace(/^\s*\d+\.\s*/u, "").replace(/\s+$/u, "").trim();
}

// Section title → typed kind. Keys are stripLeadingNumber()'d and
// lowercased so "1. Project Overview" → "project overview". Variants
// ("and" vs "&", "Onsite" vs "On-Site") tolerated explicitly to absorb
// small producer rewrites without dropping into the prose fallback.
const SECTION_KIND_BY_TITLE: Record<string, Exclude<Section["kind"], "prose">> = {
  "project overview": "overview",
  "shoot objectives & style": "objectives",
  "shoot objectives and style": "objectives",
  "production scope & deliverables": "production",
  "production scope and deliverables": "production",
  "team on-site": "crew",
  "team onsite": "crew",
  "team on site": "crew",
  "pre-event communications timeline": "comms",
  "pre-event communications": "comms",
  "communications timeline": "comms",
};

export function parseBriefDoc(doc: docs_v1.Schema$Document): ParsedBrief {
  const ps = docParagraphs(doc);
  const header = parseHeader(doc.title ?? "");
  const chunks = splitSections(ps);

  const sections: Section[] = [];
  for (const c of chunks) {
    if (isExcludedSection(c.titleRaw)) {
      console.log(`[parse-brief] dropping excluded section: ${c.titleRaw}`);
      continue;
    }
    const norm = stripLeadingNumber(c.titleRaw).toLowerCase();
    const kind = SECTION_KIND_BY_TITLE[norm];
    sections.push(kind ? parseTyped(kind, c) : parseAsProse(c));
  }

  return { header, sections };
}

// --- Header --------------------------------------------------------------

function parseHeader(title: string): ParsedBrief["header"] {
  // Doc title format: "Brief #NNNN - Client - Event Name" (en- and em-dashes
  // tolerated). Loose fallback: if it doesn't parse, treat the whole title
  // as the event name so we still show *something*.
  const trimmed = title.trim();
  const m = trimmed.match(
    /^Brief\s+#?(\S+)\s*[-–—]\s*([^-–—]+?)\s*[-–—]\s*(.+)$/iu,
  );
  if (m) {
    return {
      briefNumber: m[1].trim(),
      clientName: m[2].trim(),
      eventName: m[3].trim(),
    };
  }
  return { briefNumber: "", clientName: "", eventName: trimmed };
}

// --- Section splitter ---------------------------------------------------

type SectionChunk = {
  titleRaw: string;        // "1. Project Overview"
  titleClean: string;      // "Project Overview"
  body: Paragraph[];
};

// Section headings always carry the numbered "N. Title" template (e.g.
// "1. Project Overview"). When a Doc has a HEADING_3 paragraph that
// DOESN'T match — a common producer mistake is to apply the heading
// style to field labels like "Client Name: ..." — treat it as regular
// content inside the current section rather than starting a new one.
// Without this, every styled paragraph splits the Doc into a stack of
// empty single-paragraph sections that all get filtered as empty.
const SECTION_HEADER_RX = /^\s*\d+\.\s+\S/u;

function splitSections(ps: Paragraph[]): SectionChunk[] {
  const out: SectionChunk[] = [];
  let current: SectionChunk | null = null;
  for (const p of ps) {
    if (isHeading3(p)) {
      const titleRaw = plainTextTrimmed(p);
      if (SECTION_HEADER_RX.test(titleRaw)) {
        if (current) out.push(current);
        current = {
          titleRaw,
          titleClean: stripLeadingNumber(titleRaw),
          body: [],
        };
        continue;
      }
      // HEADING_3 styling on a non-numbered line — producer drift.
      // Fall through and treat it as a regular paragraph below.
    }
    if (!current) continue; // pre-heading content (doc title etc.) ignored
    current.body.push(p);
  }
  if (current) out.push(current);
  return out;
}

// --- Section dispatchers ------------------------------------------------

function parseTyped(
  kind: Exclude<Section["kind"], "prose">,
  c: SectionChunk,
): Section {
  switch (kind) {
    case "overview":
      return { kind, title: c.titleClean, fields: parseOverview(c.body) };
    case "objectives":
      return { kind, title: c.titleClean, blocks: parseObjectives(c.body) };
    case "production":
      return { kind, title: c.titleClean, ...parseProduction(c.body) };
    case "crew":
      return { kind, title: c.titleClean, members: parseCrew(c.body) };
    case "comms":
      return { kind, title: c.titleClean, links: parseComms(c.body) };
  }
}

function parseAsProse(c: SectionChunk): Section {
  return {
    kind: "prose",
    title: c.titleClean,
    blocks: c.body.flatMap((p) => {
      const html = renderRichText(p);
      return html ? [{ html, bullet: isBulleted(p), level: bulletLevel(p) }] : [];
    }),
  };
}

// --- Section 1: Project Overview ----------------------------------------

function parseOverview(body: Paragraph[]): Record<string, string | LinkValue> {
  const fields: Record<string, string | LinkValue> = {};
  for (const p of body) {
    const split = splitLabelValue(p);
    if (!split) continue;
    const link = firstLink(p);
    if (link && link.text) {
      fields[split.label] = { text: link.text || split.value, url: link.url };
    } else {
      fields[split.label] = split.value;
    }
  }
  return fields;
}

// --- Section 2: Shoot Objectives & Style --------------------------------

// Objectives are bulleted paragraphs with a bold lead ("Core Goal:") and a
// value. Render each as a prose block so the page can keep the lead bold
// and preserve any inline links (e.g. Visual Reference). `bullet` flows
// through so the renderer can group consecutive bullets into a <ul>.
function parseObjectives(body: Paragraph[]): ProseBlock[] {
  return body.flatMap((p) => {
    const html = renderRichText(p);
    return html ? [{ html, bullet: isBulleted(p), level: bulletLevel(p) }] : [];
  });
}

// --- Section 3: Production Scope & Deliverables -------------------------

const PRODUCTION_SUBHEADINGS = {
  "confirmed schedule": "schedule",
  "schedule": "schedule",
  "equipment requirements": "equipment",
  "equipment": "equipment",
  "deliverables": "deliverables",
} as const;

type ProductionBucket = "schedule" | "equipment" | "deliverables";

function detectSubheading(p: Paragraph): {
  bucket: ProductionBucket;
  // Remaining value text in the same paragraph after the subheading colon,
  // if any. Used when the producer wrote the subheading inline with the
  // first item (e.g. "Equipment Requirements: Cameras: 2x 4K Camera Kits.").
  inlineRemainder?: string;
} | null {
  // A production subheading ("Confirmed Schedule" / "Equipment Requirements"
  // / "Deliverables") is a NON-bulleted section divider in the canonical
  // template. A *bulleted* "Deliverables:" line is instead a content grouping
  // with its own nested items (e.g. brief #0218b) - keep it as a normal
  // bullet so it renders with its bold label + children, rather than being
  // silently consumed as a bucket marker and dropped.
  if (isBulleted(p)) return null;
  const split = splitLabelValue(p);
  if (!split) return null;
  const key = split.label.toLowerCase().trim();
  const bucket = PRODUCTION_SUBHEADINGS[key as keyof typeof PRODUCTION_SUBHEADINGS];
  if (!bucket) return null;

  const value = split.value.trim();
  // The "equipment" bucket is structured as label→value pairs; if the
  // producer wrote "Equipment: <prose>" (no inner label:value), it's
  // really a single bulleted item not a subheading transition. Without
  // this check, the entire prose gets wedged into the equipment dict
  // as a giant key with an empty value, and following items get lost.
  // Schedule + deliverables are more forgiving — schedule validates the
  // time pattern at dispatch, deliverables takes any content.
  if (bucket === "equipment" && value && !/^\S[^:]*:\s+\S/.test(value)) {
    return null;
  }

  return { bucket, inlineRemainder: value || undefined };
}

const TIME_RX =
  /^\s*(\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s*[-–—]\s*\d{1,2}:\d{2}\s*(?:AM|PM))?)\s*$/iu;

function parseProduction(body: Paragraph[]): {
  schedule: ScheduleRow[];
  equipment: Record<string, string>;
  deliverables: ProseBlock[];
} {
  const schedule: ScheduleRow[] = [];
  const equipment: Record<string, string> = {};
  const deliverables: ProseBlock[] = [];
  let bucket: ProductionBucket | null = null;

  // Inline-subheading remainder: the producer sometimes wrote the
  // subheading inline with the first item ("Equipment Requirements:
  // Cameras: 2x 4K Camera Kits."). We can't recover the bold structure
  // on the remainder cleanly, so this path uses a regex split on the
  // plain-text remainder — fine for equipment (values are plain strings)
  // and schedule (we still validate the time pattern). The deliverables
  // case carries the source paragraph's bullet state through so the
  // remainder renders alongside other bullets in the same <ul>.
  const dispatchRemainder = (
    remainder: string,
    sourceBullet: boolean,
    sourceLevel: number,
  ) => {
    if (!bucket || !remainder) return;
    if (bucket === "schedule") {
      const m = remainder.match(/^(.+?):\s*(.+)$/u);
      if (m && TIME_RX.test(m[1])) {
        schedule.push({ time: m[1].trim(), what: m[2].trim() });
      }
    } else if (bucket === "equipment") {
      const m = remainder.match(/^(.+?):\s*(.+)$/u);
      if (m) {
        equipment[m[1].trim()] = m[2].trim();
      } else {
        equipment[remainder.trim()] = "";
      }
    } else if (bucket === "deliverables") {
      const html = escapeHtml(remainder.trim());
      if (html)
        deliverables.push({ html, bullet: sourceBullet, level: sourceLevel });
    }
  };

  for (const p of body) {
    const trans = detectSubheading(p);
    if (trans) {
      bucket = trans.bucket;
      if (trans.inlineRemainder) {
        dispatchRemainder(trans.inlineRemainder, isBulleted(p), bulletLevel(p));
      }
      continue;
    }
    // Until we've seen an explicit subheading, default to "deliverables"
    // so free-form section-3 templates (no Confirmed Schedule / Equipment
    // Requirements / Deliverables subheadings — e.g. brief #0214) still
    // render their bullets instead of being silently dropped.
    const effective: ProductionBucket = bucket ?? "deliverables";
    const split = splitLabelValue(p);
    if (effective === "schedule") {
      if (split && TIME_RX.test(split.label)) {
        schedule.push({ time: split.label.trim(), what: split.value });
      }
      continue;
    }
    if (effective === "equipment") {
      if (split) {
        equipment[split.label] = split.value;
      }
      continue;
    }
    if (effective === "deliverables") {
      const html = renderRichText(p);
      if (html)
        deliverables.push({
          html,
          bullet: isBulleted(p),
          level: bulletLevel(p),
        });
    }
  }

  return { schedule, equipment, deliverables };
}

// --- Section 4: Team On-Site --------------------------------------------

// Brief #0219 has one assigned crew member with one nested contact row.
// We support that shape and degrade gracefully if a different brief comes
// through: any paragraph with a bold "Assigned Crew Member:" lead starts
// a new member; subsequent paragraphs (until the next "Assigned Crew
// Member:") get attached as that member's contact.
function parseCrew(body: Paragraph[]): CrewMember[] {
  const members: CrewMember[] = [];
  let current: CrewMember | null = null;

  for (const p of body) {
    const split = splitLabelValue(p);
    if (split && /^assigned crew member$/iu.test(split.label.trim())) {
      if (current) members.push(current);
      current = { name: split.value };
      continue;
    }
    if (!current) continue;
    const link = firstLink(p);
    if (link) {
      current.contact = { text: link.text || link.url, url: link.url };
      continue;
    }
    const text = plainTextTrimmed(p);
    if (text && !current.contact) current.contact = text;
  }
  if (current) members.push(current);
  return members;
}

// --- Section 5: Pre-Event Communications --------------------------------

// Bulleted rows of "Label: <url>" or just "<url>". The label becomes the
// link card's heading; the URL comes from the textRun's link.url.
function parseComms(body: Paragraph[]): LinkCard[] {
  const out: LinkCard[] = [];
  for (const p of body) {
    const link = firstLink(p);
    if (!link) continue;
    const split = splitLabelValue(p);
    out.push({
      label: split?.label,
      url: link.url,
    });
  }
  return out;
}
