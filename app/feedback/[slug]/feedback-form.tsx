// Client component: the interactive feedback form. Fields mirror the
// spec §6.5 schema 1:1 (rating, went well, could improve, book again,
// other). Sends to POST /api/feedback; on 200 we swap into a thanks
// state in place.

"use client";

import { useState, type FormEvent } from "react";

type Props = {
  slug: string;
  cardId: string;
  shootNumber: string;
};

type BookAgain = "yes" | "maybe" | "no" | "";

export function FeedbackForm({ slug, cardId, shootNumber }: Props) {
  const [rating, setRating] = useState(0);
  const [wentWell, setWentWell] = useState("");
  const [couldImprove, setCouldImprove] = useState("");
  const [bookAgain, setBookAgain] = useState<BookAgain>("");
  const [other, setOther] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (submitted) {
    return (
      <section className="section feedback-thanks">
        <div className="card">
          <h2 className="feedback-thanks-h">Thanks - really appreciate it.</h2>
          <p>
            Your feedback is in - we'll read every word. If you've got more to
            share later, just reply to your latest email and the Fame Crew team
            will see it.
          </p>
        </div>
      </section>
    );
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!rating) {
      setError("Please pick a star rating.");
      return;
    }
    if (!bookAgain) {
      setError("Let us know whether you'd book again - even a maybe helps.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          cardId,
          shootNumber,
          rating,
          wentWell: wentWell.trim(),
          couldImprove: couldImprove.trim(),
          bookAgain,
          other: other.trim(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Submission failed (${res.status})`);
      }
      setSubmitted(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="feedback-form" onSubmit={handleSubmit} noValidate>
      <div className="card feedback-card">
        <label className="feedback-q">
          Overall, how was the shoot?
        </label>
        <StarPicker value={rating} onChange={setRating} />
      </div>

      <div className="card feedback-card">
        <label className="feedback-q" htmlFor="wentWell">
          What went well?
        </label>
        <textarea
          id="wentWell"
          className="feedback-textarea"
          rows={3}
          value={wentWell}
          onChange={(e) => setWentWell(e.target.value)}
          placeholder="Optional"
        />
      </div>

      <div className="card feedback-card">
        <label className="feedback-q" htmlFor="couldImprove">
          What could we do better next time?
        </label>
        <textarea
          id="couldImprove"
          className="feedback-textarea"
          rows={3}
          value={couldImprove}
          onChange={(e) => setCouldImprove(e.target.value)}
          placeholder="Optional - honest answers welcome"
        />
      </div>

      <div className="card feedback-card">
        <fieldset className="feedback-fieldset">
          <legend className="feedback-q">Would you book us again?</legend>
          <div className="feedback-radio-group">
            {(["yes", "maybe", "no"] as const).map((opt) => (
              <label key={opt} className="feedback-radio">
                <input
                  type="radio"
                  name="bookAgain"
                  value={opt}
                  checked={bookAgain === opt}
                  onChange={(e) => setBookAgain(e.target.value as BookAgain)}
                />
                <span>{opt[0].toUpperCase() + opt.slice(1)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="card feedback-card">
        <label className="feedback-q" htmlFor="other">
          Anything else you'd like us to know?
        </label>
        <textarea
          id="other"
          className="feedback-textarea"
          rows={3}
          value={other}
          onChange={(e) => setOther(e.target.value)}
          placeholder="Optional"
        />
      </div>

      {error ? <div className="feedback-error">{error}</div> : null}

      <button
        type="submit"
        className="feedback-submit"
        disabled={submitting}
      >
        {submitting ? "Sending..." : "Send feedback"}
      </button>

      <p className="feedback-footnote">
        Shoot {shootNumber} &middot; Your reply goes to the Fame Crew team.
      </p>
    </form>
  );
}

function StarPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="star-picker" role="radiogroup" aria-label="Star rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            className={`star ${filled ? "filled" : ""}`}
            onClick={() => onChange(n)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}
