export interface EmptyStateProps {
  message: string;
}

/** Explains an empty result set rather than showing a blank area (spec §8 "No results"). */
export function EmptyState({ message }: EmptyStateProps) {
  return <p>{message}</p>;
}
