import { listAll } from "../lib/storage";

async function main() {
  const list = (await listAll())
    .slice()
    .sort((a, b) => b.shootNumber.localeCompare(a.shootNumber));
  console.log(`Total: ${list.length}\nTop 15 by shoot number desc:`);
  for (const s of list.slice(0, 15)) {
    console.log(
      `  ${s.shootNumber}  ${s.clientName.padEnd(30)}  list=${(s.trelloListName ?? "?").padEnd(22)}  cardId=${s.cardId}  slug=${s.slug}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
