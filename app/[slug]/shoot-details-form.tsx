// Client component: asks for the shoot date and/or location when the booking
// was paid before either was known.
//
// Shown while the field is still blank (not only on the ?welcome=1 landing) -
// the welcome banner's query param is stripped after the first render, so a
// welcome-only form would vanish on a refresh and we'd never get the answer.
// It disappears for good once submitted.
//
// Only renders the fields we're actually missing: date-only, location-only, or
// both.

"use client";

import { useState, type FormEvent } from "react";

type Props = {
  slug: string;
  needDate: boolean;
  needLocation: boolean;
};

export function ShootDetailsForm({ slug, needDate, needLocation }: Props) {
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div className="details-ask details-ask-done" role="status">
        <strong>Thank you - that&apos;s saved.</strong> Your producer has it and will be
        in touch if anything else is needed.
      </div>
    );
  }

  // Today, so the picker can't offer a past date in the client's own timezone.
  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const both = needDate && needLocation;
  const heading = both
    ? "When and where is your shoot?"
    : needDate
      ? "When is your shoot?"
      : "Where is your shoot?";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (needDate && !date && needLocation && !location) {
      setError("Add a date or a location to continue.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/shoot-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          shootDate: needDate ? date || null : null,
          shootLocation: needLocation ? location.trim() || null : null,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Couldn't save that - please try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Couldn't save that - please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="details-ask" onSubmit={onSubmit}>
      <div className="details-ask-title">{heading}</div>
      <p className="details-ask-sub">
        We don&apos;t have {both ? "these yet" : "this yet"}. Adding{" "}
        {both ? "them" : "it"} now means we can start lining up your crew
        straight away - it only takes a moment.
      </p>
      <div className="details-ask-fields">
        {needDate && (
          <label className="details-ask-field">
            <span>Shoot date</span>
            <input
              type="date"
              value={date}
              min={minDate}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        )}
        {needLocation && (
          <label className="details-ask-field">
            <span>Shoot location</span>
            <input
              type="text"
              value={location}
              placeholder="Venue or address, city"
              maxLength={200}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
        )}
      </div>
      {error && (
        <p className="details-ask-error" role="alert">
          {error}
        </p>
      )}
      <button className="details-ask-btn" type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save details"}
      </button>
      <p className="details-ask-note">
        Not confirmed yet? No problem - just reply to your booking email when you know.
      </p>
    </form>
  );
}
