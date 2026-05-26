// Milestone email #3 - fires when Trello card moves into
// "Ready For Shoot". Usually a day or two before shoot day.

import { Text } from "@react-email/components";
import { EmailLayout, PrimaryButton } from "../layout";
import { EmailTimeline } from "../timeline";
import { QuestionsCTA } from "../questions-cta";
import { fameTheme } from "../theme";
import type { Shoot } from "../../types";

const { colors } = fameTheme;

export type ReadyForShootProps = {
  shoot: Shoot;
  statusPageUrl: string;
  clientFirstName: string;
};

export function ReadyForShootEmail({
  shoot,
  statusPageUrl,
  clientFirstName,
}: ReadyForShootProps) {
  const greeting = clientFirstName ? `Hi ${clientFirstName},` : "Hi there,";
  const crewFirst = shoot.crew?.name.split(/\s+/)[0];

  return (
    <EmailLayout
      preview={`Your shoot ${shoot.shootNumber} is on - here's the plan`}
      hero={{
        shootNumber: shoot.shootNumber,
        title: shoot.clientName,
        statusLabel: "Ready for shoot",
      }}
      signOffName={shoot.producerFirstName}
    >
      <Text style={lede}>Shoot day is here</Text>
      <Text style={paragraph}>{greeting}</Text>
      <Text style={paragraph}>
        Quick heads-up on {shoot.shootNumber}.
        {crewFirst
          ? ` ${crewFirst} is your crew and will be on site`
          : " Your crew will be on site"}
        {shoot.location ? ` at ${shoot.location}` : ""}.
      </Text>

      <Text style={paragraph}>
        Everything's locked on our side - brief, shot list, gear. If
        anything has shifted on your end (schedule moves, location
        notes, last-minute requests), just reply and we'll pass it
        along straight away.
      </Text>

      <EmailTimeline shoot={shoot} />

      <Text style={paragraph}>
        Your status page has the full plan + crew details:
      </Text>

      <PrimaryButton href={statusPageUrl}>View your status page</PrimaryButton>

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
