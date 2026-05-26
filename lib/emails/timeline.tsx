// Simplified shoot-journey timeline for embedding in milestone emails
// that fire BEFORE and DURING the shoot (booking-confirmed,
// crew-confirmed, ready-for-shoot, shoot-complete). Skipped for
// post-shoot emails (footage-in onward), where the timeline is less
// useful and the email body covers the deliverable details directly.
//
// Layout is a 4- or 5-column HTML table. Each column has a small
// indicator circle on top and a short label below. Email clients
// don't support flexbox, so we use table-based layout - reliable
// across Gmail, Outlook, Apple Mail, the lot.
//
// Step state derives from shoot.status + shoot.hasPostProduction
// using the same logic the public status page uses
// (currentStepIndex). One source of truth so the email and the
// page never disagree about where the shoot is.

import { Section } from "@react-email/components";
import type { Shoot } from "../types";
import { currentStepIndex } from "../../app/[slug]/status";

// Short labels for tight email layouts. Order matches the journey;
// crew-only shoots drop "Editing" entirely (we slice to 4 below
// when hasPostProduction is false).
const SHORT_LABELS_WITH_PP = [
  "Booked",
  "Crew",
  "Shoot",
  "Editing",
  "Done",
] as const;

const SHORT_LABELS_NO_PP = ["Booked", "Crew", "Shoot", "Done"] as const;

export function EmailTimeline({ shoot }: { shoot: Shoot }) {
  const labels = shoot.hasPostProduction
    ? SHORT_LABELS_WITH_PP
    : SHORT_LABELS_NO_PP;
  const stepIdx = currentStepIndex(shoot.status, shoot.hasPostProduction);

  return (
    <Section style={section}>
      <table cellPadding={0} cellSpacing={0} border={0} style={table}>
        <tbody>
          <tr>
            {labels.map((_, idx) => (
              <td key={`dot-${idx}`} style={dotCell} align="center">
                <Indicator
                  done={idx < stepIdx}
                  current={idx === stepIdx}
                />
              </td>
            ))}
          </tr>
          <tr>
            {labels.map((label, idx) => (
              <td key={`label-${idx}`} style={labelCell} align="center">
                <span
                  style={
                    idx === stepIdx
                      ? labelCurrent
                      : idx < stepIdx
                        ? labelDone
                        : labelFuture
                  }
                >
                  {label}
                </span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

// Single circle. Done = filled black with white check. Current =
// filled accent. Future = outlined gray. Using inline-block + fixed
// dimensions; emoji checkmark fallback keeps it readable in clients
// that strip the styled circle.
function Indicator({ done, current }: { done: boolean; current: boolean }) {
  if (done) {
    return (
      <span style={dotDone} aria-label="completed">
        ✓
      </span>
    );
  }
  if (current) {
    return <span style={dotCurrent} aria-label="in progress" />;
  }
  return <span style={dotFuture} aria-label="upcoming" />;
}

const section = {
  margin: "20px 0 8px",
  padding: "16px 0",
  borderTop: "1px solid #eee",
  borderBottom: "1px solid #eee",
};

const table = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const dotCell = {
  padding: "0 0 6px",
  verticalAlign: "middle" as const,
};

const labelCell = {
  padding: "0",
  verticalAlign: "top" as const,
};

const dotBase = {
  display: "inline-block",
  width: "20px",
  height: "20px",
  lineHeight: "20px",
  textAlign: "center" as const,
  borderRadius: "10px",
  fontSize: "12px",
  fontWeight: 700,
  boxSizing: "border-box" as const,
};

const dotDone = {
  ...dotBase,
  backgroundColor: "#111",
  color: "#ffffff",
};

const dotCurrent = {
  ...dotBase,
  backgroundColor: "#ff5b8d",
  border: "0",
};

const dotFuture = {
  ...dotBase,
  backgroundColor: "#ffffff",
  border: "1.5px solid #d4d4d0",
};

const labelBase = {
  fontSize: "12px",
  lineHeight: "1.3",
  letterSpacing: "0.2px",
};

const labelDone = { ...labelBase, color: "#666" };
const labelCurrent = { ...labelBase, color: "#111", fontWeight: 600 };
const labelFuture = { ...labelBase, color: "#aaa" };
