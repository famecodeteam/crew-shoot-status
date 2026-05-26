// Simplified shoot-journey timeline for pre-shoot and during-shoot
// milestone emails. Mirrors the .timeline / .step design on the
// public status page (app/[slug]/page.tsx).
//
// Layout uses an HTML table - flexbox / grid aren't reliable across
// email clients. The table has 2N-1 columns where N is the number
// of steps: alternating dot / connector / dot / connector ...
//
// Step state derives from shoot.status + shoot.hasPostProduction via
// currentStepIndex() - one source of truth shared with the public
// page so the email and the page never disagree.

import { Fragment } from "react";
import { Section } from "@react-email/components";
import type { Shoot } from "../types";
import { currentStepIndex } from "../../app/[slug]/status";
import { fameTheme } from "./theme";

const { colors } = fameTheme;

// Short labels for tight email layouts. Order matches the journey;
// crew-only shoots drop "Editing" (we slice to 4 below when
// hasPostProduction is false).
const SHORT_LABELS_WITH_PP = [
  "Booked",
  "Crew",
  "Shoot",
  "Editing",
  "Delivered",
] as const;

const SHORT_LABELS_NO_PP = [
  "Booked",
  "Crew",
  "Shoot",
  "Delivered",
] as const;

export function EmailTimeline({ shoot }: { shoot: Shoot }) {
  const labels = shoot.hasPostProduction
    ? SHORT_LABELS_WITH_PP
    : SHORT_LABELS_NO_PP;
  const stepIdx = currentStepIndex(shoot.status, shoot.hasPostProduction);

  return (
    <Section style={section}>
      <table
        cellPadding={0}
        cellSpacing={0}
        border={0}
        role="presentation"
        style={table}
      >
        <tbody>
          {/* Dot + connector row */}
          <tr>
            {labels.map((_, idx) => {
              // Each step contributes either [connector, dot] (for steps
              // after the first) or just [dot] (for the first). The
              // connector colour reflects whether the journey has crossed
              // that gap (i.e. step `idx - 1` is done).
              const gapDone = idx - 1 < stepIdx; // segment from prev step to this one
              return (
                <Fragment key={`dotrow-${idx}`}>
                  {idx > 0 ? (
                    <td valign="middle" style={connectorCell}>
                      <div
                        style={{
                          ...connectorLine,
                          backgroundColor: gapDone
                            ? colors.pink
                            : colors.border,
                        }}
                      />
                    </td>
                  ) : null}
                  <td align="center" valign="middle" style={dotCell}>
                    <Indicator
                      done={idx < stepIdx}
                      current={idx === stepIdx}
                      stepNumber={idx + 1}
                    />
                  </td>
                </Fragment>
              );
            })}
          </tr>
          {/* Label row - empty cells under connectors to keep column
              alignment, label cells under each dot column */}
          <tr>
            {labels.map((label, idx) => (
              <Fragment key={`labelrow-${idx}`}>
                {idx > 0 ? <td style={emptyLabelCell} /> : null}
                <td align="center" valign="top" style={labelCell}>
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
              </Fragment>
            ))}
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

function Indicator({
  done,
  current,
  stepNumber,
}: {
  done: boolean;
  current: boolean;
  stepNumber: number;
}) {
  if (done) {
    return (
      <span style={dotDone} aria-label="completed">
        ✓
      </span>
    );
  }
  if (current) {
    return (
      <span style={dotCurrent} aria-label="in progress">
        {stepNumber}
      </span>
    );
  }
  return (
    <span style={dotFuture} aria-label="upcoming">
      {stepNumber}
    </span>
  );
}

const section = {
  margin: "24px 0 8px",
  padding: "20px 0 16px",
  borderTop: `1px solid ${colors.border}`,
  borderBottom: `1px solid ${colors.border}`,
};

const table = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

// Connector TD is a row-height cell with a thin centred line inside.
// We use a child <div> for the line so the cell itself stays
// transparent - this is what fixes the "pink rectangle next to each
// dot" bug from the prior version.
const connectorCell = {
  padding: "0 6px",
  // Letting the cell auto-size between dots keeps the connectors
  // proportional regardless of step count.
};

const connectorLine = {
  height: "2px",
  width: "100%",
  fontSize: "1px",
  lineHeight: "1px",
};

const dotCell = {
  padding: "0 0 8px",
  // Fixed width on dot cells so labels line up with their dots
  // regardless of intervening connector lengths.
  width: "32px",
};

const labelCell = {
  padding: "4px 0 0",
  width: "32px",
};

const emptyLabelCell = {
  padding: "0",
};

// Dot styling mirrors .step-dot on the public page (app/globals.css):
// 32px circle, 2px border, font-size 13px / weight 700, content
// centred via line-height equal to the inner box height (28px).
const dotBase = {
  display: "inline-block",
  width: "32px",
  height: "32px",
  lineHeight: "28px",
  textAlign: "center" as const,
  borderRadius: "16px",
  fontSize: "13px",
  fontWeight: 700,
  boxSizing: "border-box" as const,
};

const dotDone = {
  ...dotBase,
  backgroundColor: colors.pink,
  color: colors.card,
  border: `2px solid ${colors.pink}`,
};

// Current step: hollow pink-bordered circle with a soft pink-light
// ring (achieved via boxShadow). Matches .step.current .step-dot on
// the public page.
const dotCurrent = {
  ...dotBase,
  backgroundColor: colors.card,
  border: `2px solid ${colors.pink}`,
  boxShadow: `0 0 0 4px ${colors.pinkLight}`,
  color: colors.pink,
};

const dotFuture = {
  ...dotBase,
  backgroundColor: colors.card,
  border: `2px solid ${colors.border}`,
  color: colors.textMuted,
};

const labelBase = {
  fontSize: "12px",
  lineHeight: 1.3,
  letterSpacing: "0.2px",
};

const labelDone = { ...labelBase, color: colors.dark, fontWeight: 600 };
const labelCurrent = {
  ...labelBase,
  color: colors.dark,
  fontWeight: 700,
};
const labelFuture = { ...labelBase, color: colors.textMuted, fontWeight: 500 };
