export interface LoadingStateProps {
  label?: string;
}

/** Announces a loading condition to assistive technology without stealing focus (spec §8 "Loading"). */
export function LoadingState({ label = "Loading…" }: LoadingStateProps) {
  return (
    <p role="status" aria-live="polite">
      {label}
    </p>
  );
}
