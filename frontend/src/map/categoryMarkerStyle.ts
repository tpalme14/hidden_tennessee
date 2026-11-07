export interface CategoryStyle {
  color: string;
  label: string;
}

/**
 * Colorblind-safe (Okabe–Ito inspired) 8-color categorical palette. Color is
 * a secondary cue only: the category name is always shown as popup text too
 * (spec LANDMARK_DISCOVERY_SPEC.md §4.2: "color and marker shape alone must
 * not communicate category"). Slugs/labels match the approved M01-T05
 * category mapping.
 */
const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  arch: { color: "#E69F00", label: "Natural Arch" },
  bald: { color: "#56B4E9", label: "Mountain Bald" },
  falls: { color: "#009E73", label: "Waterfall" },
  lake: { color: "#0072B2", label: "Lake" },
  other: { color: "#999999", label: "Other Natural Feature" },
  peak: { color: "#D55E00", label: "Mountain Peak" },
  rock: { color: "#CC79A7", label: "Rock Formation" },
  sink: { color: "#F0E442", label: "Sinkhole" },
};

const FALLBACK_STYLE: CategoryStyle = { color: "#374151", label: "Landmark" };

export function categoryColor(slug: string): string {
  return (CATEGORY_STYLES[slug] ?? FALLBACK_STYLE).color;
}

export function categoryLabel(slug: string): string {
  return (CATEGORY_STYLES[slug] ?? FALLBACK_STYLE).label;
}
