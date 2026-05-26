// Branded shell used by every milestone email. Designed to feel like
// the public status page (app/[slug]/page.tsx): cream background,
// white card, Fame pink accents, Figtree font, Fame logo at the top.
// One source of truth for layout chrome (header, footer, CTA button,
// hero block) so individual templates can focus on the milestone body.

import {
  Body,
  Container,
  Font,
  Head,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";
import { fameTheme } from "./theme";

const { colors, fontFamily, figtreeUrl, logoUrl, radius } = fameTheme;

export type LayoutProps = {
  // Inbox preview text - first ~80 chars shown by most clients next to
  // the subject line before the user opens the email.
  preview: string;
  // Optional hero block (mirrors the page hero). When provided we show:
  //   logo + "SHOOT #NNNN" eyebrow + big pink title + optional status pill.
  hero?: {
    shootNumber: string; // "#0221a"
    title: string; // big pink line (usually the client/show name)
    statusLabel?: string; // pill text e.g. "Crew confirmed"
  };
  // Sign-off block. Falls back to "the Fame team" if absent.
  signOff?: { name: string; email: string };
  children: ReactNode;
};

export function EmailLayout({
  preview,
  hero,
  signOff,
  children,
}: LayoutProps) {
  return (
    <Html>
      <Head>
        <Font
          fontFamily="Figtree"
          fallbackFontFamily="Verdana"
          webFont={{ url: figtreeUrl, format: "woff2" }}
          fontWeight={400}
          fontStyle="normal"
        />
        <Font
          fontFamily="Figtree"
          fallbackFontFamily="Verdana"
          webFont={{ url: figtreeUrl, format: "woff2" }}
          fontWeight={600}
          fontStyle="normal"
        />
        <Font
          fontFamily="Figtree"
          fallbackFontFamily="Verdana"
          webFont={{ url: figtreeUrl, format: "woff2" }}
          fontWeight={700}
          fontStyle="normal"
        />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          {hero ? (
            <Section style={heroSection}>
              <Img
                src={logoUrl}
                alt="Fame"
                height={28}
                style={heroLogo}
              />
              <Text style={eyebrow}>SHOOT {hero.shootNumber}</Text>
              <Text style={heroTitle}>{hero.title}</Text>
              {hero.statusLabel ? (
                <span style={statusBadge}>
                  <span style={statusDot} />
                  {hero.statusLabel}
                </span>
              ) : null}
            </Section>
          ) : (
            <Section style={headerSection}>
              <Img src={logoUrl} alt="Fame" height={28} style={heroLogo} />
            </Section>
          )}

          <Section style={content}>{children}</Section>

          <Section style={footer}>
            <Text style={signOffLine}>
              {signOff ? `- ${signOff.name}` : "- the Fame team"}
            </Text>
            {signOff?.email ? (
              <Text style={signOffEmail}>{signOff.email}</Text>
            ) : null}
            <Text style={footerSmallPrint}>
              Fame Crew &middot; shoots.fame.so
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// CTA button - pink filled, white text, rounded. Mirrors the page's
// primary action style (.btn-primary patterns on the status page).
export function PrimaryButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      style={{ margin: "20px 0" }}
    >
      <tbody>
        <tr>
          <td style={buttonCell}>
            <a href={href} style={buttonLink}>
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// Secondary outline button - used for WhatsApp on the questions block,
// so the primary status-page CTA stays the visually dominant action.
export function OutlineButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      style={{ margin: "12px 0 0" }}
    >
      <tbody>
        <tr>
          <td style={outlineButtonCell}>
            <a href={href} style={outlineButtonLink}>
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

const body = {
  backgroundColor: colors.cream,
  fontFamily,
  margin: 0,
  padding: 0,
};

const container = {
  backgroundColor: colors.card,
  margin: "32px auto",
  padding: "0",
  maxWidth: "600px",
  borderRadius: radius,
  overflow: "hidden",
  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
};

const headerSection = {
  padding: "28px 32px 16px",
};

const heroSection = {
  padding: "32px 32px 24px",
  borderBottom: `2px solid ${colors.pink}`,
};

const heroLogo = {
  display: "block",
  marginBottom: "20px",
};

const eyebrow = {
  fontSize: "11px",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.1em",
  color: colors.textMuted,
  margin: "0 0 8px",
};

const heroTitle = {
  fontSize: "30px",
  fontWeight: 700,
  color: colors.pink,
  letterSpacing: "-0.02em",
  lineHeight: 1.1,
  margin: "0 0 14px",
};

const statusBadge = {
  display: "inline-block",
  backgroundColor: colors.pinkLight,
  color: colors.pink,
  fontWeight: 600,
  fontSize: "13px",
  padding: "6px 14px",
  borderRadius: "999px",
};

const statusDot = {
  display: "inline-block",
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  backgroundColor: colors.pink,
  marginRight: "8px",
  verticalAlign: "middle",
};

const content = {
  padding: "24px 32px 8px",
  color: colors.dark,
  fontSize: "15px",
  lineHeight: 1.55,
};

const footer = {
  padding: "8px 32px 28px",
  color: colors.dark,
  fontSize: "14px",
  lineHeight: 1.5,
};

const signOffLine = {
  margin: "16px 0 4px",
  color: colors.dark,
  fontWeight: 500,
};

const signOffEmail = {
  margin: "0 0 16px",
  color: colors.textMuted,
  fontSize: "13px",
};

const footerSmallPrint = {
  margin: "20px 0 0",
  color: colors.textMuted,
  fontSize: "12px",
};

const buttonCell = {
  backgroundColor: colors.pink,
  borderRadius: "999px",
  padding: "0",
};

const buttonLink = {
  color: "#ffffff",
  textDecoration: "none",
  display: "inline-block",
  padding: "13px 24px",
  fontSize: "15px",
  fontWeight: 600,
  letterSpacing: "0.01em",
};

const outlineButtonCell = {
  backgroundColor: colors.card,
  borderRadius: "999px",
  padding: "0",
};

const outlineButtonLink = {
  color: colors.pink,
  textDecoration: "none",
  display: "inline-block",
  padding: "11px 22px",
  fontSize: "14px",
  fontWeight: 600,
  border: `1.5px solid ${colors.pink}`,
  borderRadius: "999px",
};
