import { getJson } from "./client";
import type { Category } from "./types";

export function getCategories(): Promise<Category[]> {
  return getJson<Category[]>("/api/v1/categories");
}
