// Type-safe pet look registry. The schema for each look is code-first (not a free-form
// string in request/DB shape), so look IDs are compile-time checked across
// frontend + backend + procgen. Rendering math stays in procgen, while this file
// owns the canonical, user-facing look catalog.

export const PET_LOOK_IDS = ["legacy", "volumetric"] as const;
export type PetLookId = (typeof PET_LOOK_IDS)[number];
export const DEFAULT_PET_LOOK_ID: PetLookId = "legacy";

export type PetLook = {
  readonly id: PetLookId;
  readonly name: string;
  readonly description: string;
  readonly experimental: boolean;
};

export const PET_LOOKS: Record<PetLookId, PetLook> = {
  legacy: {
    id: "legacy",
    name: "Legacy",
    description: "Existing silhouette extrusion in a single depth layer (status-quo visual).",
    experimental: false,
  },
  volumetric: {
    id: "volumetric",
    name: "Volumetric",
    description: "Body stretched across multiple depth layers for a real 3D silhouette.",
    experimental: true,
  },
} as const;

export const allPetLooks = () => Object.values(PET_LOOKS);
export const isPetLookId = (value: unknown): value is PetLookId => typeof value === "string" && value in PET_LOOKS;

export const resolvePetLookId = (value: unknown, fallback: string | undefined = DEFAULT_PET_LOOK_ID): PetLookId =>
  isPetLookId(value) ? value : isPetLookId(fallback) ? fallback : DEFAULT_PET_LOOK_ID;

