interface LoadingSkeletonProps {
  rows?: number;
  variant?: "card" | "hero";
}

export function LoadingSkeleton({ rows = 3, variant = "card" }: LoadingSkeletonProps) {
  const lineCount = variant === "hero" ? Math.max(rows, 4) : rows;

  return (
    <div className={variant === "hero" ? "loading-skeleton loading-skeleton--hero" : "loading-skeleton"}>
      {Array.from({ length: lineCount }).map((_, index) => (
        <span key={index} className="loading-skeleton__line" />
      ))}
    </div>
  );
}
