// Server components — one per Section kind in the parsed brief. Pure
// view, no client state. The 'prose' fallback handles any section whose
// title didn't match the typed-section map (e.g. producer renamed
// "Project Overview" to "Project Background" — we still render it).

import type {
  CrewMember,
  LinkCard,
  LinkValue,
  ProseBlock,
  ScheduleRow,
  Section,
} from "@/lib/parse-brief";

export function SectionCard({ section, num }: { section: Section; num: number }) {
  return (
    <section className="brief-section">
      <h2>
        <span className="brief-num">{num}</span> {section.title}
      </h2>
      <SectionBody section={section} />
    </section>
  );
}

function SectionBody({ section }: { section: Section }) {
  switch (section.kind) {
    case "overview":
      return <OverviewBody fields={section.fields} />;
    case "objectives":
      return <ProseBody blocks={section.blocks} />;
    case "production":
      return (
        <ProductionBody
          schedule={section.schedule}
          equipment={section.equipment}
          deliverables={section.deliverables}
        />
      );
    case "crew":
      return <CrewBody members={section.members} />;
    case "comms":
      return <CommsBody links={section.links} />;
    case "prose":
      return <ProseBody blocks={section.blocks} />;
  }
}

// ---------- Overview ----------

function OverviewBody({ fields }: { fields: Record<string, string | LinkValue> }) {
  const entries = Object.entries(fields);
  if (entries.length === 0) return null;
  return (
    <dl className="brief-fields">
      {entries.map(([label, value]) => (
        <FieldRow key={label} label={label} value={value} />
      ))}
    </dl>
  );
}

function FieldRow({ label, value }: { label: string; value: string | LinkValue }) {
  const rendered = isLink(value) ? (
    <a href={value.url} target="_blank" rel="noopener">
      {value.text}
    </a>
  ) : (
    value
  );
  return (
    <>
      <dt>{label}</dt>
      <dd>{rendered}</dd>
    </>
  );
}

function isLink(v: string | LinkValue): v is LinkValue {
  return typeof v === "object" && v !== null && "url" in v;
}

// ---------- Prose (objectives / fallback) ----------

function ProseBody({ blocks }: { blocks: ProseBlock[] }) {
  if (blocks.length === 0) return null;
  // Group consecutive bulleted blocks into one <ul> tree, rebuilding the
  // Doc's nestingLevel hierarchy. Non-bulleted blocks render as <p>.
  type BulletNode = { html: string; children: BulletNode[] };
  type Group =
    | { kind: "ul"; tree: BulletNode[] }
    | { kind: "p"; block: ProseBlock };

  const groups: Group[] = [];
  // Stack tracks the current insertion parent at each level. Index 0 is
  // the virtual root (the top-level <ul>); index i holds the most-recent
  // node at level i so that a new node at level i+1 becomes its child.
  let stack: BulletNode[] = [];

  for (const b of blocks) {
    if (!b.bullet) {
      stack = [];
      groups.push({ kind: "p", block: b });
      continue;
    }
    const last = groups[groups.length - 1];
    if (!last || last.kind !== "ul") {
      groups.push({ kind: "ul", tree: [] });
      stack = [];
    }
    const current = groups[groups.length - 1] as Extract<Group, { kind: "ul" }>;
    const node: BulletNode = { html: b.html, children: [] };
    const level = Math.max(0, b.level ?? 0);

    // If the Doc jumps multiple levels at once (rare; usually only when
    // the producer indented without a parent line first), clamp to the
    // deepest existing level + 1 so we don't lose the item.
    const insertAt = Math.min(level, stack.length);
    if (insertAt === 0) {
      current.tree.push(node);
    } else {
      stack[insertAt - 1].children.push(node);
    }
    stack = [...stack.slice(0, insertAt), node];
  }

  return (
    <div className="brief-prose">
      {groups.map((g, i) =>
        g.kind === "ul" ? (
          <BulletList key={i} nodes={g.tree} />
        ) : (
          <p key={i} dangerouslySetInnerHTML={{ __html: g.block.html }} />
        ),
      )}
    </div>
  );
}

function BulletList({
  nodes,
}: {
  nodes: { html: string; children: { html: string; children: unknown[] }[] }[];
}) {
  return (
    <ul>
      {nodes.map((n, i) => (
        <li key={i}>
          {/* HTML produced by lib/doc-walker.renderRichText — escapes
              text + emits only <strong>/<em>/<a target=_blank>. */}
          <span dangerouslySetInnerHTML={{ __html: n.html }} />
          {n.children.length > 0 && (
            <BulletList
              nodes={
                n.children as {
                  html: string;
                  children: { html: string; children: unknown[] }[];
                }[]
              }
            />
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------- Production ----------

function ProductionBody({
  schedule,
  equipment,
  deliverables,
}: {
  schedule: ScheduleRow[];
  equipment: Record<string, string>;
  deliverables: ProseBlock[];
}) {
  const hasSchedule = schedule.length > 0;
  const equipEntries = Object.entries(equipment);
  const hasEquipment = equipEntries.length > 0;
  const hasDeliverables = deliverables.length > 0;

  return (
    <>
      {hasSchedule && (
        <>
          <div className="brief-subhead">Confirmed Schedule</div>
          <div className="brief-schedule">
            {schedule.map((row, i) => (
              <ScheduleRowFragment key={i} row={row} />
            ))}
          </div>
        </>
      )}
      {hasEquipment && (
        <>
          <div className="brief-subhead">Equipment</div>
          <dl className="brief-fields">
            {equipEntries.map(([k, v]) => (
              <FieldRow key={k} label={k} value={v} />
            ))}
          </dl>
        </>
      )}
      {hasDeliverables && (
        <>
          <div className="brief-subhead">Deliverables</div>
          <ProseBody blocks={deliverables} />
        </>
      )}
    </>
  );
}

function ScheduleRowFragment({ row }: { row: ScheduleRow }) {
  return (
    <>
      <div className="brief-time">{row.time}</div>
      <div className="brief-what">{row.what}</div>
    </>
  );
}

// ---------- Crew ----------

function CrewBody({ members }: { members: CrewMember[] }) {
  if (members.length === 0) return null;
  return (
    <div>
      {members.map((m, i) => (
        <CrewCard key={i} member={m} />
      ))}
    </div>
  );
}

function CrewCard({ member }: { member: CrewMember }) {
  const initials = member.name
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const contact = renderContact(member.contact);
  return (
    <div className="brief-crew-card">
      {member.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="brief-crew-photo"
          src={member.photoUrl}
          alt={member.name}
        />
      ) : (
        <div className="brief-crew-avatar">{initials || "—"}</div>
      )}
      <div>
        <div className="brief-crew-name">{member.name}</div>
        {member.bio && <div className="brief-crew-bio">{member.bio}</div>}
        {member.vetted && (
          <div className="brief-crew-vetted">Vetted by Fame</div>
        )}
        {contact && <div className="brief-crew-contact">{contact}</div>}
      </div>
    </div>
  );
}

function renderContact(c: CrewMember["contact"]): React.ReactNode {
  if (!c) return null;
  if (typeof c === "string") return c;
  return (
    <a href={c.url} target="_blank" rel="noopener">
      {c.text || c.url}
    </a>
  );
}

// ---------- Comms (link cards) ----------

function CommsBody({ links }: { links: LinkCard[] }) {
  if (links.length === 0) return null;
  return (
    <div>
      {links.map((link, i) => (
        <a
          key={i}
          className="brief-link-card"
          href={link.url}
          target="_blank"
          rel="noopener"
        >
          <div>
            {link.label && <div className="brief-link-label">{link.label}</div>}
            <div className="brief-link-url">{stripHttp(link.url)}</div>
          </div>
          <div className="brief-link-arrow">→</div>
        </a>
      ))}
    </div>
  );
}

function stripHttp(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
