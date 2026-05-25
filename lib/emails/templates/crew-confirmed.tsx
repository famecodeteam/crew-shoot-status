// Milestone email #2 - fires when Trello card moves into "Crew Booked".
//
// Content goal: introduce the crew member by name + bio + photo, give
// the client confidence that production is on track, drop them on the
// status page for the deeper detail.

import { Img, Section, Text } from "@react-email/components";
import { EmailLayout, PrimaryButton } from "../layout";
import type { Shoot } from "../../types";

export type CrewConfirmedProps = {
  shoot: Shoot;
  // Producer's first name + email - drives the sign-off block.
  producerFirstName: string;
  producerEmail: string;
  // Fully-qualified URL to the client's status page (env-prefixed at
  // send time, not derivable from the Shoot record alone).
  statusPageUrl: string;
  // Client's first name for the greeting. Best-effort - falls back to
  // a polite generic if we can't split it.
  clientFirstName: string;
};

export function CrewConfirmedEmail({
  shoot,
  producerFirstName,
  producerEmail,
  statusPageUrl,
  clientFirstName,
}: CrewConfirmedProps) {
  const crew = shoot.crew;
  const greeting = clientFirstName ? `Hi ${clientFirstName},` : "Hi there,";

  return (
    <EmailLayout
      preview={
        crew
          ? `Your crew for ${shoot.shootNumber} is confirmed - meet ${crew.name.split(/\s+/)[0]}`
          : `Your crew for ${shoot.shootNumber} is confirmed`
      }
      signOff={{ name: producerFirstName, email: producerEmail }}
    >
      <Text style={heading}>Your crew is confirmed</Text>
      <Text style={paragraph}>{greeting}</Text>
      <Text style={paragraph}>
        Quick update on {shoot.shootNumber} - we've locked in your crew
        member{crew ? `, ${crew.name}` : ""}. They'll be the one on the
        ground for the shoot.
      </Text>

      {crew ? (
        <Section style={crewCard}>
          {crew.photoUrl ? (
            <Img
              src={crew.photoUrl}
              alt={crew.name}
              width="80"
              height="80"
              style={crewPhoto}
            />
          ) : null}
          <Text style={crewName}>{crew.name}</Text>
          {crew.bio ? <Text style={crewBio}>{crew.bio}</Text> : null}
        </Section>
      ) : null}

      <Text style={paragraph}>
        Your status page has the full picture - shoot date, location,
        and everything else lined up so far. We'll keep it updated as
        we move through the next steps.
      </Text>

      <PrimaryButton href={statusPageUrl}>View your status page</PrimaryButton>

      <Text style={paragraph}>
        Anything you'd like to flag before the shoot - questions about
        the brief, the crew, the day-of plan - just reply to this email
        and you'll reach the team.
      </Text>
    </EmailLayout>
  );
}

const heading = {
  fontSize: "20px",
  fontWeight: 700,
  margin: "8px 0 16px",
  color: "#111",
};

const paragraph = {
  margin: "0 0 14px",
};

const crewCard = {
  backgroundColor: "#f8f8f6",
  borderRadius: "6px",
  padding: "20px",
  margin: "16px 0",
};

const crewPhoto = {
  borderRadius: "40px",
  display: "block",
  margin: "0 0 12px",
};

const crewName = {
  margin: "0 0 8px",
  fontSize: "16px",
  fontWeight: 600,
  color: "#111",
};

const crewBio = {
  margin: 0,
  color: "#444",
  fontSize: "14px",
  lineHeight: "1.55",
};
