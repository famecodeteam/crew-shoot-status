// "Any questions?" block. Standard on every milestone email - the
// answer to "who do I talk to if something comes up?"
//
// Always invites a reply (From is hello@shoots.fame.so but Reply-To
// is the crew@fame.so Google Group, so any reply lands in every group
// member's inbox).
//
// Optionally renders the WhatsApp group join button when the Trello
// card's "Client WhatsApp" custom field is set. Many clients prefer
// WhatsApp for shoot-week comms.

import { Section, Text } from "@react-email/components";
import { OutlineButton } from "./layout";
import { fameTheme } from "./theme";

const { colors } = fameTheme;

export type QuestionsCTAProps = {
  whatsappUrl?: string;
};

export function QuestionsCTA({ whatsappUrl }: QuestionsCTAProps) {
  return (
    <Section style={section}>
      <Text style={heading}>Any questions?</Text>
      <Text style={paragraph}>
        Reply to this email any time
        {whatsappUrl
          ? " - it goes straight to the Fame team. Or jump into the WhatsApp group:"
          : " - it goes straight to the Fame team."}
      </Text>
      {whatsappUrl ? (
        <OutlineButton href={whatsappUrl}>
          Open WhatsApp group
        </OutlineButton>
      ) : null}
    </Section>
  );
}

const section = {
  marginTop: "8px",
  paddingTop: "20px",
};

const heading = {
  fontSize: "11px",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.1em",
  color: colors.textMuted,
  margin: "0 0 10px",
};

const paragraph = {
  margin: "0",
  fontSize: "14px",
  lineHeight: 1.55,
  color: colors.dark,
};
