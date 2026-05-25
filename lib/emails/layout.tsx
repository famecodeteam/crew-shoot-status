// Branded shell used by every milestone email. Keep this minimal -
// each template provides the body; layout owns header, footer, and
// the single CTA-button style.
//
// Email clients are HTML-1999-style restricted. No flexbox, no grid,
// no modern CSS - inline styles + table layouts. React Email's
// primitives handle most of the boilerplate (Tailwind-style props
// compile to inline-style attrs at render time).

import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

export type LayoutProps = {
  // Inbox preview text - first ~80 chars shown next to the subject on
  // most clients before the user opens the email.
  preview: string;
  // Producer signature at the foot. Falls back to "the Fame team" if
  // we don't have a name (e.g. producer email is a shared inbox).
  signOff?: {
    name: string;
    email: string;
  };
  children: ReactNode;
};

export function EmailLayout({ preview, signOff, children }: LayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={headerSection}>
            <Text style={headerLogo}>FAME</Text>
          </Section>

          <Section style={content}>{children}</Section>

          <Hr style={hr} />

          <Section style={footer}>
            <Text style={signOffName}>
              {signOff ? `- ${signOff.name}` : "- the Fame team"}
            </Text>
            {signOff?.email ? (
              <Text style={signOffEmail}>{signOff.email}</Text>
            ) : null}
            <Text style={footerNote}>
              You can reach the team any time by replying to this email.
            </Text>
            <Text style={footerSmallPrint}>
              Fame Studios &middot; shoots.fame.so
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// CTA button used across all templates. Reusable so subject + body
// styling stays consistent.
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
      style={{ margin: "24px 0" }}
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

const body = {
  backgroundColor: "#f6f6f4",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  margin: 0,
  padding: 0,
};

const container = {
  backgroundColor: "#ffffff",
  margin: "32px auto",
  padding: "0",
  maxWidth: "560px",
  borderRadius: "8px",
  overflow: "hidden",
  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
};

const headerSection = {
  padding: "28px 32px 16px",
};

const headerLogo = {
  fontSize: "18px",
  fontWeight: 700,
  letterSpacing: "2px",
  margin: 0,
  color: "#111",
};

const content = {
  padding: "8px 32px 24px",
  color: "#222",
  fontSize: "15px",
  lineHeight: "1.55",
};

const hr = {
  borderColor: "#e7e7e3",
  margin: "0 32px",
};

const footer = {
  padding: "20px 32px 28px",
  color: "#555",
  fontSize: "14px",
  lineHeight: "1.5",
};

const signOffName = {
  margin: "0 0 4px",
  color: "#222",
};

const signOffEmail = {
  margin: "0 0 16px",
  color: "#666",
  fontSize: "13px",
};

const footerNote = {
  margin: "0 0 12px",
  color: "#666",
  fontSize: "13px",
};

const footerSmallPrint = {
  margin: "16px 0 0",
  color: "#999",
  fontSize: "12px",
};

const buttonCell = {
  backgroundColor: "#111",
  borderRadius: "6px",
  padding: "0",
};

const buttonLink = {
  color: "#ffffff",
  textDecoration: "none",
  display: "inline-block",
  padding: "12px 22px",
  fontSize: "15px",
  fontWeight: 600,
};
