export interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

/** Announces a failure via an alert role and offers an optional retry action (spec §8 "API error"). */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
