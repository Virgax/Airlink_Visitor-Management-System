"use client";

import { Printer } from "lucide-react";
import { Icon } from "@/components/Icon";

/** `window.print()` without inline handlers (CSP). */
export function PrintButton({ label, className = "btn-secondary" }: { label: string; className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      <Icon icon={Printer} /> {label}
    </button>
  );
}
