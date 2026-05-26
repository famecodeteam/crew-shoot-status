// Simplified shoot-journey timeline for embedding in pre-shoot and
// during-shoot milestone emails. Mirrors the .timeline / .step
// design on the public status page (app/[slug]/page.tsx).
//
// Layout uses an HTML table - flexbox / grid isn't reliable across
// email clients. Each step is a column with a 32px circle and a
// label underneath; connecting lines run between cells via the
// pseudo-element trick reproduced here as left/right borders on
// each step cell.
//
// Step state derives from shoot.status + shoot.hasPostProduction via
// currentStepIndex() - one source of truth shared with the public
// page so the email and the page never disagree.

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
  const cellWidth = `${Math.floor(100 / labels.length)}%`;

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
          {/* Dot row */}
          <tr>
            {labels.map((_, idx) => {
              const done = idx < stepIdx;
              const isFirst = idx === 0;
              const isLast = idx === labels.length - 1;
              // Each cell holds a 32px dot. The connecting line is
              // drawn via left/right cell padding bands - colored pink
              // for the segments where the journey has reached.
              return (
                <td
                  key={`dot-${idx}`}
                  align="center"
                  style={{
                    ...dotCell,
                    width: cellWidth,
                  }}
                >
                  <table
                    cellPadding={0}
                    cellSpacing={0}
                    border={0}
                    role="presentation"
                    style={{ margin: "0 auto" }}
                  >
                    <tbody>
                      <tr>
                        <td
                          style={{
                            ...connector,
                            backgroundColor: isFirst
                              ? "transparent"
                              : done
                                ? colors.pink
                                : colors.border,
                          }}
                        />
                        <td style={dotWrap}>
                          <Indicator
                            done={done}
                            current={idx === stepIdx}
                          />
                        </td>
                        <td
                          style={{
                            ...connector,
                            backgroundColor: isLast
                              ? "transparent"
                              : idx + 1 <= stepIdx
                                ? colors.pink
                                : colors.border,
                          }}
                        />
                      </tr>
                    </tbody>
                  </table>
                </td>
              );
            })}
          </tr>
          {/* Label row */}
          <tr>
            {labels.map((label, idx) => (
              <td
                key={`label-${idx}`}
                align="center"
                style={{ ...labelCell, width: cellWidth }}
              >
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

function Indicator({ done, current }: { done: boolean; current: boolean }) {
  if (done) {
    return (
      <span style={dotDone} aria-label="completed">
        ✓
      </span>
    );
  }
  if (current) {
    return (
      <span style={dotCurrentWrap} aria-label="in progress">
        <span style={dotCurrentInner}>{labelDotNumber(current)}</span>
      </span>
    );
  }
  return <span style={dotFuture} aria-label="upcoming" />;
}

// Show no inner content for the current dot - the pink-light ring +
// hollow circle is the visual. Kept as a helper for future variants
// (e.g. inner step number) without changing the call site.
function labelDotNumber(_current: boolean): string {
  return "";
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

const dotCell = {
  padding: "0 0 8px",
  verticalAlign: "middle" as const,
};

const labelCell = {
  padding: "4px 2px 0",
  verticalAlign: "top" as const,
};

const dotWrap = {
  padding: "0",
  verticalAlign: "middle" as const,
};

const connector = {
  height: "2px",
  width: "26px",
  fontSize: "1px",
  lineHeight: "1px",
  verticalAlign: "middle" as const,
};

const dotBase = {
  display: "inline-block",
  width: "32px",
  height: "32px",
  lineHeight: "30px",
  textAlign: "center" as const,
  borderRadius: "16px",
  fontSize: "14px",
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
const dotCurrentWrap = {
  ...dotBase,
  backgroundColor: colors.card,
  border: `2px solid ${colors.pink}`,
  boxShadow: `0 0 0 4px ${colors.pinkLight}`,
  color: colors.pink,
};

const dotCurrentInner = {
  display: "inline-block",
  lineHeight: "28px",
};

const dotFuture = {
  ...dotBase,
  backgroundColor: colors.card,
  border: `2px solid ${colors.border}`,
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
