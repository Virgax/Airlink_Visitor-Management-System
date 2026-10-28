"use client";

import { Printer } from "lucide-react";
import { Icon } from "@/components/Icon";

/** `window.print()` as a client component (no inline handlers: the CSP uses a nonce). */
export function PrintButton({ label, className = "btn-primary" }: { label: string; className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`${className} print-hidden`}>
      <Icon icon={Printer} /> {label}
    </button>
  );
}
