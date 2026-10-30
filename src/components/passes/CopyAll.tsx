"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Icon } from "@/components/Icon";

/** A read-only block of text (e.g. every link of a group) with a copy button. */
export function CopyAll({ text, labels }: { text: string; labels: { copy: string; copied: string } }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable: the textarea stays selectable */
    }
  };
  return (
    <div className="space-y-2">
      <textarea readOnly value={text} rows={Math.min(8, text.split("\n").length)} className="input font-mono text-xs" data-testid="group-links" />
      <button type="button" onClick={copy} className="btn-secondary text-sm" aria-live="polite">
        <Icon icon={copied ? Check : Copy} /> {copied ? labels.copied : labels.copy}
      </button>
    </div>
  );
}
