// Milestone email #4 - fires when Trello card moves into
// "Assets Received From Crew". Copy branches on hasPostProduction:
//   - PP shoots: "footage is in - editing has started"
//   - Crew-only shoots: "your raw footage is ready"
//
// No timeline embed - this is a POST-shoot email (per spec, timeline
// is only on before/during-shoot templates).

import { Text } from "@react-email/components";
import { EmailLayout, PrimaryButton } from "../layout";
import { QuestionsCTA } from "../questions-cta";
import { fameTheme } from "../theme";
import type { Shoot } from "../../types";

const { colors } = fameTheme;

export type FootageInProps = {
  shoot: Shoot;
  statusPageUrl: string;
  clientFirstName: string;
};

export function FootageInEmail({
  shoot,
  statusPageUrl,
  clientFirstName,
}: FootageInProps) {
  const greeting = clientFirstName ? `Hi ${clientFirstName},` : "Hi there,";
  const pp = shoot.hasPostProduction;

  return (
    <EmailLayout
      preview={
        pp
          ? `Footage from ${shoot.shootNumber} is in - editing started`
          : `Your raw footage for ${shoot.shootNumber} is ready`
      }
      hero={{
        shootNumber: shoot.shootNumber,
        title: shoot.clientName,
        statusLabel: pp ? "In editing" : "Delivering footage",
      }}
      signOffName={shoot.producerFirstName}
    >
      <Text style={lede}>
        {pp ? "Footage is in - editing has started" : "Your raw footage is ready"}
      </Text>
      <Text style={paragraph}>{greeting}</Text>

      {pp ? (
        <>
          <Text style={paragraph}>
            Footage from {shoot.shootNumber} just landed - the day went
            well. Our editors are on it now. You can expect the first
            cut ready to review in around 5 business days.
          </Text>
          <Text style={paragraph}>
            We'll send you a notification the moment your videos are
            ready. In the meantime, your status page has the latest:
          </Text>
        </>
      ) : (
        <>
          <Text style={paragraph}>
            All raw files from your shoot are uploaded and organised on
            your status page. You can preview every clip directly in
            the browser - each preview is auto-transcribed, so you can
            search the transcripts to find the moment you need without
            scrubbing through hours of footage.
          </Text>
          <Text style={paragraph}>
            Each clip links straight to Google Drive for full-resolution
            download - that's where you (or your editors) grab the
            files to edit with.
          </Text>
          <Text style={paragraph}>
            For crew-only shoots like this, that's the handoff - your
            team takes it from here. Anything you need from us during
            your edit, just reply.
          </Text>
          <Text style={paragraph}>
            Also, if you would prefer that we do post production, just
            hit reply and explain what you need editing and we'll get
            right on it!
          </Text>
        </>
      )}

      <PrimaryButton href={statusPageUrl}>
        {pp ? "View your status page" : "Browse your footage"}
      </PrimaryButton>

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
