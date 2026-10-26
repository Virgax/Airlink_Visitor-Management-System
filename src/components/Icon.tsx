import type { LucideIcon, LucideProps } from "lucide-react";

/** Single entry point for icons (Lucide). Never use emojis in the UI. */
export function Icon({ icon: I, label, ...props }: { icon: LucideIcon; label?: string } & LucideProps) {
  return <I aria-hidden={label ? undefined : true} aria-label={label} role={label ? "img" : undefined} size={18} strokeWidth={1.75} {...props} />;
}
