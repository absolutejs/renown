// Authoritative serialized-copy issuance. Subject/variant selection is deterministic
// from commit provenance; serial assignment and supply enforcement happen atomically
// inside PostgreSQL's issue_pet_copy() function.
import { and, eq, sql } from "drizzle-orm";
import {
  CARD_RECIPE_VERSION, CARD_SET, CARD_VARIANTS, cardCopyToken, cardPrintingId, cardSeedPrefix,
  cardSubjectIndex, chooseCardVariant, generate, serialPermutation, type CardVariant,
} from "../../../core/procgen.ts";
import { petSubjects, wildSeedSources } from "../../../db/schema.ts";
import { gameDb } from "./sync.ts";

export type IssuedPet = {
  seed: string;
  provenanceSeed: string;
  printingId: string;
  serialNumber: number;
  printRun: number;
  created: boolean;
};

type IssueRow = {
  out_pet_seed: string;
  out_serial_number: number;
  out_print_run: number;
  out_printing_id: string;
  out_created: boolean;
};

const issueOne = async (playerId: string, githubLogin: string, provenanceSeed: string, subjects: { id: string; setId: string; subjectSeed: string; name: string }[]): Promise<IssuedPet | null> => {
  // Exhausted short runs retry another deterministic subject/variant. The final
  // attempts use the effectively inexhaustible base run, so a valid pull is never lost.
  for (let attempt = 0; attempt < 16; attempt++) {
    const subject = subjects[cardSubjectIndex(provenanceSeed, subjects.length, attempt)];
    if (!subject) return null;
    const variant: CardVariant = attempt < 12 ? chooseCardVariant(provenanceSeed, attempt) : "base";
    const printRun = CARD_VARIANTS[variant].printRun;
    const printingId = cardPrintingId(subject.setId, subject.subjectSeed, variant);
    const permutation = serialPermutation(printingId, printRun);
    const copyToken = cardCopyToken(playerId, provenanceSeed);
    const result = await gameDb.execute(sql`select * from issue_pet_copy(
      ${playerId}, ${githubLogin}, ${provenanceSeed}, ${subject.id}, ${subject.subjectSeed}, ${subject.name},
      ${subject.setId}, ${variant}, ${printingId}, ${printRun}, ${permutation.offset}, ${permutation.step}, ${CARD_VARIANTS[variant].finish},
      ${CARD_RECIPE_VERSION}, ${cardSeedPrefix(subject.setId, subject.subjectSeed, variant)}, ${copyToken}
    )`);
    const row = (result.rows as unknown as IssueRow[])[0];
    if (!row) continue; // this printing sold out between selection and allocation
    const issued: IssuedPet = {
      seed: row.out_pet_seed,
      provenanceSeed,
      printingId: row.out_printing_id,
      serialNumber: Number(row.out_serial_number),
      printRun: Number(row.out_print_run),
      created: row.out_created,
    };
    if (issued.created) {
      const pet = generate(issued.seed);
      await gameDb.update(wildSeedSources).set({
        name: pet.name, tier: pet.tier, rarityScore: pet.score, size: pet.sizeN,
        species: pet.traits.species, aura: pet.traits.aura, oneOfOne: pet.oneOfOne,
        recipeVersion: pet.card?.recipeVersion ?? CARD_RECIPE_VERSION,
        mutation: pet.copyTraits?.mutation ?? "Standard", colorway: pet.copyTraits?.colorway ?? "Original",
        material: pet.copyTraits?.material ?? "Standard", copyPattern: pet.copyTraits?.copyPattern ?? "None",
      }).where(and(eq(wildSeedSources.playerId, playerId), eq(wildSeedSources.petSeed, issued.seed)));
    }
    return issued;
  }
  return null;
};

export const issuePetCopies = async ({ playerId, githubLogin, provenanceSeeds }: {
  playerId: string; githubLogin: string; provenanceSeeds: string[];
}): Promise<IssuedPet[]> => {
  const subjects = await gameDb.select({ id: petSubjects.id, setId: petSubjects.setId, subjectSeed: petSubjects.subjectSeed, name: petSubjects.name })
    .from(petSubjects).where(eq(petSubjects.setId, CARD_SET)).orderBy(petSubjects.slotNumber);
  if (subjects.length === 0) throw new Error(`pet catalog has no subjects; run db/migrate-serialized-pets.ts`);
  const unique = [...new Set(provenanceSeeds.filter(Boolean))];
  const out: IssuedPet[] = [];
  for (const provenanceSeed of unique) {
    const issued = await issueOne(playerId, githubLogin, provenanceSeed, subjects);
    if (issued) out.push(issued);
  }
  return out;
};
