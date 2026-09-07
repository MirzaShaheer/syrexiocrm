/**
 * Reserves the shape of a list so nothing jumps when the data lands. The rows
 * match the real row height, which is what keeps layout shift at zero.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="h-5 w-56 animate-pulse rounded-sm bg-surface" />
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card h-[62px] animate-pulse" />
        ))}
      </div>
      <div className="mt-8 border-t border-line">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-line py-2.5"
          >
            <div className="h-[18px] w-[58px] animate-pulse rounded-sm bg-surface" />
            <div className="flex-1">
              <div className="h-3.5 w-2/5 animate-pulse rounded-sm bg-surface" />
              <div className="mt-1.5 h-3 w-1/4 animate-pulse rounded-sm bg-surface" />
            </div>
            <div className="h-3.5 w-[46px] animate-pulse rounded-sm bg-surface" />
          </div>
        ))}
      </div>
    </div>
  );
}
