// Milestone email #3 - fires when Trello card moves into
// "Ready For Shoot". Usually a day or two before shoot day.
//
// Shows the assigned crew (photo + bio) as a reminder of who's
// arriving on the day - the same crew card the client first saw on
// booking-confirmed and crew-confirmed, recurring here so the day-of
// contact is fresh in their mind.

import { Img, Section, Text } from "@react-email/components";
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
  const crew = shoot.crew;
  const crewFirst = crew?.name.split(/\s+/)[0];

  return (
    <EmailLayout
      preview={`Your shoot is coming up - here's the plan`}
      hero={{
        shootNumber: shoot.shootNumber,
        title: shoot.clientName,
        statusLabel: "Ready for shoot",
      }}
      signOffName={shoot.producerFirstName}
    >
      <Text style={lede}>Your shoot is coming up</Text>
      <Text style={paragraph}>{greeting}</Text>
      <Text style={paragraph}>
        Quick heads-up on your shoot.
        {crewFirst
          ? ` ${crewFirst} is your crew and will be on site`
          : " Your crew will be on site"}
        {shoot.location ? ` at ${shoot.location}` : ""}.
      </Text>

      {crew ? (
        <Section style={crewCard}>
          <table
            cellPadding={0}
            cellSpacing={0}
            border={0}
            role="presentation"
            style={crewTable}
          >
            <tbody>
              <tr>
                {crew.photoUrl ? (
                  <td style={crewPhotoCell}>
                    <Img
                      src={crew.photoUrl}
                      alt={crew.name}
                      width="80"
                      height="80"
                      style={crewPhoto}
                    />
                  </td>
                ) : null}
                <td style={crewTextCell}>
                  <Text style={crewName}>{crew.name}</Text>
                  {crew.bio ? <Text style={crewBio}>{crew.bio}</Text> : null}
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      ) : null}

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

const crewCard = {
  backgroundColor: colors.card,
  border: `1px solid ${colors.border}`,
  borderRadius: "12px",
  padding: "20px",
  margin: "10px 0 18px",
};

const crewTable = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const crewPhotoCell = {
  width: "92px",
  verticalAlign: "middle" as const,
  paddingRight: "16px",
};

const crewPhoto = {
  borderRadius: "40px",
  display: "block",
  backgroundColor: colors.pinkLight,
};

const crewTextCell = {
  verticalAlign: "middle" as const,
};

const crewName = {
  margin: "0 0 6px",
  fontSize: "18px",
  fontWeight: 700,
  color: colors.dark,
};

const crewBio = {
  margin: 0,
  color: colors.textMuted,
  fontSize: "14px",
  lineHeight: 1.55,
};
