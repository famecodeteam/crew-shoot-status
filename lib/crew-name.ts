// How a crew member's name is shown to CLIENTS: first name + surname initial
// ("Ekaterina Poletaeva" → "Ekaterina P").
//
// Fame sources and vets these freelancers; handing every client a full name
// makes them trivially findable and bookable direct. The crew member's own
// public profile still carries their full name - this is only about what a
// client sees on the shoot surfaces we send them.

/** "Ekaterina Poletaeva" → "Ekaterina P". Safe on empty/one-word input. */
export function clientFacingCrewName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0]!;
  // One name only (mononym, or we only ever captured a first name) - nothing
  // to abbreviate, so don't invent an initial.
  if (parts.length === 1) return first;
  // Initial comes from the LAST part, so "Maria de la Cruz" reads "Maria C"
  // rather than "Maria D".
  const initial = [...parts[parts.length - 1]!][0] ?? "";
  return initial ? `${first} ${initial.toUpperCase()}` : first;
}
