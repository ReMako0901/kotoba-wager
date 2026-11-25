export function GenerationSkeleton({ complete = false }: { complete?: boolean }) {
  return <div className="generation-skeleton" role="status" aria-label="物語を書き換え中" aria-busy={!complete}>
    {!complete && <span className="spinner" aria-hidden="true" />}<div className="skeleton-ink" aria-hidden="true" />
  </div>;
}
