// Map a Trello card's assigned members to the producer whose email
// shows on the public status page.
//
// Priority order - first match in this list wins. So if Zandro is on the
// card, the page shows zandro@; otherwise if Tom is on it, tom@; and only
// if Clay is the only one of the three on the card does it show clay@.
//
// Fallback (none of the three are members of the card) is Zandro, who's
// the default producer for Fame Crew.
//
// IDs come from the Crew Delivery board's member list, captured 2026-05-07.
// They're stable across username/display-name changes - the IDs only
// change if the underlying Trello account is deleted, which won't happen
// silently.

export type Producer = {
  id: string;
  username: string;
  firstName: string;
  email: string;
};

export const PRODUCERS: Producer[] = [
  {
    id: "699eb48d1713e5124649613a",
    username: "zandrollano2",
    firstName: "Zandro",
    email: "zandro@fame.so",
  },
  {
    id: "57f743fe5fbefb4643dfaec1",
    username: "tomhuntio",
    firstName: "Tom",
    email: "tom@fame.so",
  },
  {
    id: "59e0d5e4cf771e72885353a7",
    username: "clayborboran",
    firstName: "Clay",
    email: "clay@fame.so",
  },
];

export const DEFAULT_PRODUCER: Producer = PRODUCERS[0]; // Zandro

export function pickProducer(memberIds: readonly string[] | undefined): Producer {
  if (!memberIds || memberIds.length === 0) return DEFAULT_PRODUCER;
  const set = new Set(memberIds);
  for (const p of PRODUCERS) {
    if (set.has(p.id)) return p;
  }
  return DEFAULT_PRODUCER;
}
