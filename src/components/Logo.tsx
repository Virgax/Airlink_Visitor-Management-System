/**
 * Airlink Dominican Republic wordmark, drawn as inline SVG so it follows the theme:
 * black letters in light mode, white in dark mode, red chevron always.
 */
export function Logo({ className = "h-8", tagline = true, title = "Airlink Dominican Republic" }: { className?: string; tagline?: boolean; title?: string }) {
  return (
    <svg viewBox="0 0 520 150" className={className} role="img" aria-label={title} style={{ color: "var(--logo)" }}>
      <title>{title}</title>
      <text x="6" y="106" fontFamily="'Arial Rounded MT Bold', 'Nunito', 'Helvetica Neue', Arial, sans-serif" fontSize="110" fontWeight="900" letterSpacing="-4" textLength="356" lengthAdjust="spacingAndGlyphs" fill="currentColor">
        airlin
      </text>
      {/* k: black stem + red chevron */}
      <rect x="372" y="22" width="24" height="84" fill="currentColor" />
      <polygon points="404,64 448,22 486,22 442,64 486,106 448,106" fill="var(--brand-red)" />
      {tagline ? (
        <text x="8" y="140" fontFamily="'Helvetica Neue', Arial, sans-serif" fontSize="20" fontWeight="500" letterSpacing="5" textLength="476" lengthAdjust="spacingAndGlyphs" fill="currentColor">
          DOMINICAN REPUBLIC
        </text>
      ) : null}
    </svg>
  );
}

/** Square mark for icons and tight spaces: red chevron on black. */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="12" fill="#111111" />
      <rect x="14" y="14" width="8" height="36" fill="#ffffff" />
      <polygon points="26,32 42,14 54,14 36,32 54,50 42,50" fill="#e4262b" />
    </svg>
  );
}
