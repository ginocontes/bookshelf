export function Stars({ rating, size = 18 }: { rating?: number; size?: number }) {
  if (rating == null) return null;
  return (
    <span className="stars" role="img" aria-label={`${rating} out of 5 stars`} style={{ fontSize: size }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, rating - i));
        return (
          <span key={i} className="star">
            <span className="star-empty">★</span>
            <span className="star-full" style={{ width: `${fill * 100}%` }}>
              ★
            </span>
          </span>
        );
      })}
    </span>
  );
}
