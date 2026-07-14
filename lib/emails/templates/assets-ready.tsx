// Milestone email #5 - fires when Trello card moves into
// "Assets Shared With Client". Final edits are up; the client is
// invited to review, comment, request changes, or approve.
//
// No timeline embed - post-shoot.

import { Text } from "@react-email/components";
import { EmailLayout, PrimaryButton } from "../layout";
import { QuestionsCTA } from "../questions-cta";
import { fameTheme } from "../theme";
import type { Shoot } from "../../types";

const { colors } = fameTheme;

export type AssetsReadyProps = {
  shoot: Shoot;
  statusPageUrl: string;
  clientFirstName: string;
};

export function AssetsReadyEmail({
  shoot,
  statusPageUrl,
  clientFirstName,
}: AssetsReadyProps) {
  const greeting = clientFirstName ? `Hi ${clientFirstName},` : "Hi there,";

  return (
    <EmailLayout
      preview={`Your videos are ready to review`}
      hero={{
        shootNumber: shoot.shootNumber,
        title: shoot.clientName,
        statusLabel: "Assets ready for review",
      }}
      signOffName={shoot.producerFirstName}
    >
      <Text style={lede}>Your videos are ready to review</Text>
      <Text style={paragraph}>{greeting}</Text>
      <Text style={paragraph}>
        First cut of {shoot.shootNumber} is up on your status page,
        ready for review. You can watch each video, leave timestamped
        comments, request changes, or approve when you're happy.
      </Text>
      <Text style={paragraph}>
        Take your time - there's no rush. Any questions or change
        requests, just reply to this email.
      </Text>

      <PrimaryButton href={statusPageUrl}>Review your videos</PrimaryButton>

      <QuestionsCTA whatsappUrl={shoot.clientWhatsappUrl} />
    </EmailLayout>
  );
}

const lede = {
  fontSize: "22px",
  fontWeight: 700,
  margin: "8px 0 16px",
  color: colors.dark,
  letterSpacing: "-0.01em",
};

const paragraph = {
  margin: "0 0 14px",
  color: colors.dark,
};
