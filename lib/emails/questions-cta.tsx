// "Any questions?" block - the standard answer to "who do I talk to if
// something comes up?" on every milestone email. Two paths, both
// dropping the client into a place where the Fame team will see their
// message:
//
//   1. Reply to this email - the From is hello@shoots.fame.so but
//      Reply-To is the crew@fame.so Google Group, so any reply lands
//      in every group member's inbox.
//   2. WhatsApp group - only rendered if the Trello card has a
//      "Client WhatsApp" custom field set (shoot.clientWhatsappUrl).
//      Many clients prefer WhatsApp for shoot-week comms.

import { Section, Text } from "@react-email/components";
import { PrimaryButton } from "./layout";

export type QuestionsCTAProps = {
  whatsappUrl?: string;
};

export function QuestionsCTA({ whatsappUrl }: QuestionsCTAProps) {
  return (
    <Section style={section}>
      <Text style={heading}>Any questions?</Text>
      <Text style={paragraph}>
        Reply to this email any time
        {whatsappUrl ? " - it goes straight to the Fame team. Or jump into the WhatsApp group:" : " - it goes straight to the Fame team."}
      </Text>
      {whatsappUrl ? (
        <PrimaryButton href={whatsappUrl}>
          Open WhatsApp group
        </PrimaryButton>
      ) : null}
    </Section>
  );
}

const section = {
  marginTop: "24px",
  paddingTop: "20px",
  borderTop: "1px solid #eee",
};

const heading = {
  fontSize: "15px",
  fontWeight: 700,
  margin: "0 0 8px",
  color: "#111",
};

const paragraph = {
  margin: "0",
  fontSize: "14px",
  lineHeight: "1.55",
  color: "#444",
};
