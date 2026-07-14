// Time-triggered reassurance email - fires from the crew-reassurance cron
// (NOT a Trello list move) while a paid shoot is still pre-crew-confirmed
// and the shoot date is inside the reassurance window.
//
// Purpose (per Tom): between paying the deposit and us formally confirming
// the crew, a client whose shoot is coming up has nothing to go on and ends
// up emailing to chase. This closes that gap with an unprompted "we're on
// it" note. Deliberately general - it does NOT promise a specific date for
// the crew reveal (that's a promise we'd have to keep every time); it just
// reassures them it's in hand and there's nothing for them to do.
//
// Kept short on purpose: the long orientation already went out with
// booking-confirmed. This is a light touch, not a second onboarding.

import { Text } from "@react-email/components";
import { EmailLayout, PrimaryButton } from "../layout";
import { QuestionsCTA } from "../questions-cta";
import { fameTheme } from "../theme";
import type { Shoot } from "../../types";

const { colors } = fameTheme;

export type CrewReassuranceProps = {
  shoot: Shoot;
  statusPageUrl: string;
  clientFirstName: string;
};

// "2026-07-15" -> "Wed, 15 Jul 2026". Parsed at UTC noon so the weekday
// never drifts across a timezone boundary. Falls back to "" if the date
// is missing or unparseable, so the copy simply omits it rather than
// printing "Invalid Date".
function friendlyShootDate(shootDate: string | undefined): string {
  const d = (shootDate ?? "").trim().slice(0, 10);
  if (d.length < 10) return "";
  const ms = Date.parse(`${d}T12:00:00Z`);
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

export function CrewReassuranceEmail({
  shoot,
  statusPageUrl,
  clientFirstName,
}: CrewReassuranceProps) {
  const greeting = clientFirstName ? `Hi ${clientFirstName},` : "Hi there,";
  const dateLabel = friendlyShootDate(shoot.shootDate);

  return (
    <EmailLayout
      preview={`Your crew is being lined up - nothing you need to do`}
      hero={{
        shootNumber: shoot.shootNumber,
        title: shoot.clientName,
        statusLabel: "Crew being confirmed",
      }}
      signOffName={shoot.producerFirstName}
    >
      <Text style={lede}>Your crew is being lined up</Text>
      <Text style={paragraph}>{greeting}</Text>
      <Text style={paragraph}>
        {dateLabel
          ? `With your shoot on ${dateLabel} coming up, a quick note to put your mind at ease: we're actively lining up your crew right now.`
          : `A quick note to put your mind at ease as your shoot approaches: we're actively lining up your crew right now.`}
      </Text>
      <Text style={paragraph}>
        As soon as they're locked in, we'll email you their details - name,
        bio and photo - so you know exactly who's turning up on the day.
        There's nothing you need to do in the meantime.
      </Text>
      <Text style={paragraph}>
        You can always see the latest on your status page:
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
