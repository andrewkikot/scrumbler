/** Two stacked cards with a gold pip — drawn on a 16×16 grid, like a tile. */
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="pixel-art"
      role="img"
      aria-label="Scrumbler"
    >
      <rect x="0" y="4" width="11" height="12" fill="var(--color-outline)" />
      <rect x="1" y="5" width="9" height="10" fill="var(--color-teal)" />
      <rect x="2" y="7" width="3" height="1" fill="var(--color-teal-deep)" />
      <rect x="2" y="9" width="5" height="1" fill="var(--color-teal-deep)" />

      <rect x="5" y="0" width="11" height="13" fill="var(--color-outline)" />
      <rect x="6" y="1" width="9" height="11" fill="var(--color-ink)" />
      <rect x="9" y="5" width="3" height="3" fill="var(--color-gold)" />
      <rect x="10" y="4" width="1" height="1" fill="var(--color-gold)" />
      <rect x="10" y="8" width="1" height="1" fill="var(--color-gold)" />
      <rect x="7" y="2" width="1" height="1" fill="var(--color-gold-deep)" />
      <rect x="13" y="10" width="1" height="1" fill="var(--color-gold-deep)" />
    </svg>
  );
}
