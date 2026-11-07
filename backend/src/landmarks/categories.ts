import type { LandmarkCategory } from "@prisma/client";

export interface CategoryDefinition {
  slug: string;
  label: string;
  value: LandmarkCategory;
}

// Spec LANDMARK_DISCOVERY_SPEC.md §9.8: final slugs aligned with the approved
// LandmarkCategory enum (ADR-003/M01-T02), approved during M01-T05 planning.
export const CATEGORY_DEFINITIONS: readonly CategoryDefinition[] = [
  { slug: "arch", label: "Natural Arch", value: "ARCH" },
  { slug: "bald", label: "Mountain Bald", value: "BALD" },
  { slug: "falls", label: "Waterfall", value: "FALLS" },
  { slug: "lake", label: "Lake", value: "LAKE" },
  { slug: "other", label: "Other Natural Feature", value: "OTHER" },
  { slug: "peak", label: "Mountain Peak", value: "PEAK" },
  { slug: "rock", label: "Rock Formation", value: "ROCK" },
  { slug: "sink", label: "Sinkhole", value: "SINK" },
];

const SLUG_TO_VALUE = new Map(CATEGORY_DEFINITIONS.map((c) => [c.slug, c.value]));
const VALUE_TO_SLUG = new Map(CATEGORY_DEFINITIONS.map((c) => [c.value, c.slug]));

export function isCategorySlug(slug: string): boolean {
  return SLUG_TO_VALUE.has(slug);
}

export function categorySlugToValue(slug: string): LandmarkCategory {
  const value = SLUG_TO_VALUE.get(slug);
  if (!value) throw new Error(`Unknown category slug: ${slug}`);
  return value;
}

export function categoryValueToSlug(value: string): string {
  const slug = VALUE_TO_SLUG.get(value as LandmarkCategory);
  if (!slug) throw new Error(`Unknown category value: ${value}`);
  return slug;
}
