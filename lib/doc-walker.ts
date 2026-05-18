// Low-level helpers for reading a Google Docs API structural response.
// Pure functions only — no I/O — so the parser can be unit-tested against
// a fixture without standing up the Docs client.

import type { docs_v1 } from "googleapis";

export type Paragraph = NonNullable<docs_v1.Schema$StructuralElement["paragraph"]>;
export type ParagraphElement = docs_v1.Schema$ParagraphElement;
export type TextRun = NonNullable<ParagraphElement["textRun"]>;

// Iterate paragraph blocks in document order. Skips sectionBreak / table /
// tableOfContents — none appear in our brief template; if one does later
// the section walker just doesn't see it.
export function paragraphs(doc: docs_v1.Schema$Document): Paragraph[] {
  const out: Paragraph[] = [];
  for (const el of doc.body?.content ?? []) {
    if (el.paragraph) out.push(el.paragraph);
  }
  return out;
}

export function isHeading3(p: Paragraph): boolean {
  return p.paragraphStyle?.namedStyleType === "HEADING_3";
}

export function isHeading2(p: Paragraph): boolean {
  return p.paragraphStyle?.namedStyleType === "HEADING_2";
}

export function isBulleted(p: Paragraph): boolean {
  return p.bullet != null;
}

// Concatenated plain text of a paragraph — only textRun.content runs;
// auto-text and footnote references are ignored (the brief template
// doesn't use them).
export function plainText(p: Paragraph): string {
  let s = "";
  for (const el of p.elements ?? []) {
    if (el.textRun?.content) s += el.textRun.content;
  }
  return s;
}

// Trim trailing newline + surrounding whitespace. Docs API always appends
// "\n" to the last text run of a paragraph; we usually want it gone.
export function plainTextTrimmed(p: Paragraph): string {
  return plainText(p).replace(/\s+$/u, "").replace(/^\s+/u, "");
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

// Render a paragraph's text runs to a tiny HTML subset: <strong>, <em>,
// <a href ... target="_blank" rel="noopener">. Trailing newlines stripped
// (paragraphs become <p> at the next level up). Linked runs override the
// bold/italic wrapping order — links wrap inside marks.
//
// Raw-URL paste prettification: when the producer pastes a URL on its
// own and Docs auto-links it, the textRun's content IS the URL. We strip
// the `https?://` prefix from the display so the page shows a tidier
// "frame.io/project/…" instead of the full address.
//
// The parser is the only HTML producer in this pipeline; nothing else
// emits markup. So this is also the entire allowlist for the page's
// dangerouslySetInnerHTML calls.
export function renderRichText(p: Paragraph): string {
  let html = "";
  for (const el of p.elements ?? []) {
    const r = el.textRun;
    if (!r?.content) continue;
    const raw = r.content;
    // Trailing newline on the final run is paragraph-terminator noise.
    const text = raw.replace(/\n+$/u, "");
    if (!text) continue;
    let inner = escapeHtml(text);
    const url = r.textStyle?.link?.url;
    if (url) {
      // Raw URL paste: the link text IS the URL. Display the protocol-
      // stripped version while still linking to the full URL.
      const trimmed = text.trim();
      const isRawUrlPaste =
        trimmed === url || trimmed === url.replace(/\/$/, "");
      if (isRawUrlPaste) {
        const display = url.replace(/^https?:\/\//u, "").replace(/\/$/u, "");
        inner = escapeHtml(display);
      }
      inner = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${inner}</a>`;
    }
    if (r.textStyle?.italic) inner = `<em>${inner}</em>`;
    if (r.textStyle?.bold) inner = `<strong>${inner}</strong>`;
    html += inner;
  }
  return html;
}

// Many brief paragraphs follow the shape "**Label:** value..." — a
// contiguous prefix of bold text runs followed by the value in non-bold
// runs. Returns the trimmed plain-text label (without the trailing colon)
// and the trimmed value. Returns null if no colon can be located.
//
// Tolerates two producer patterns:
//   • Colon INSIDE the bold prefix:   **Label:** value
//     e.g. schedule rows "1:00 PM: …" — splits on the LAST colon in the
//     bold prefix so the internal colons in times don't get mistaken
//     for the separator.
//   • Colon OUTSIDE the bold prefix:  **Label**: value
//     e.g. "**On-Site Coverage**: 4 hours total". The colon is the
//     first character of the non-bold remainder.
export function splitLabelValue(p: Paragraph): { label: string; value: string } | null {
  const runs = (p.elements ?? [])
    .map((e) => e.textRun)
    .filter((r): r is TextRun => !!r && !!r.content);
  if (runs.length === 0) return null;

  // Leading bold prefix.
  let boldText = "";
  let i = 0;
  while (i < runs.length && runs[i].textStyle?.bold) {
    boldText += runs[i].content ?? "";
    i++;
  }
  if (!boldText.trim()) return null;

  // Non-bold tail.
  let valueText = "";
  for (let j = i; j < runs.length; j++) {
    valueText += runs[j].content ?? "";
  }

  let label: string;
  let value: string;
  // Pattern 1: bold prefix ends with ":" — the trailing colon is the
  // separator. Anchored to the END (not "any colon in bold") so labels
  // that legitimately contain colons internally — e.g. "Monday 11th
  // (10:00–11:30 am):" or schedule rows "1:00 PM:" — keep their full
  // text as the label.
  const trailing = boldText.match(/^(.*):\s*$/su);
  if (trailing) {
    label = trailing[1];
    value = valueText;
  } else {
    // Pattern 2: bold prefix doesn't end in ":" but the non-bold
    // remainder begins with one — e.g. "**On-Site Coverage**: 4 hours".
    const m = valueText.match(/^\s*:\s*(.*)$/su);
    if (!m) return null;
    label = boldText;
    value = m[1];
  }
  label = label.trim();
  value = value.replace(/\n+$/u, "").trim();
  if (!label) return null;
  return { label, value };
}

// First textRun with a non-empty link URL in this paragraph, if any.
export function firstLink(p: Paragraph): { url: string; text: string } | null {
  for (const el of p.elements ?? []) {
    const url = el.textRun?.textStyle?.link?.url;
    if (url) {
      return { url, text: (el.textRun?.content ?? "").trim() };
    }
  }
  return null;
}
