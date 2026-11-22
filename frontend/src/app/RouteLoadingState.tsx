interface RouteLoadingStateProps {
  readonly label: string;
}

export function RouteLoadingState({ label }: RouteLoadingStateProps) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      Loading {label}...
    </div>
  );
}
