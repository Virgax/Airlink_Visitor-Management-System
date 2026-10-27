"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Share2 } from "lucide-react";
import { Icon } from "@/components/Icon";

type Labels = { copy: string; copied: string; share: string; open: string };

/** Copy / share buttons for the visitor link. Uses the Web Share API when the browser has it. */
export function ShareLink({ url, title, labels }: { url: string; title: string; labels: Labels }) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (insecure context); the input below stays selectable.
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title, url });
    } catch {
      // user cancelled
    }
  };

  return (
    <div className="space-y-2">
      <input readOnly value={url} className="input font-mono text-sm" aria-label={labels.copy} data-testid="visitor-link" />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="btn-secondary text-sm" aria-live="polite">
          <Icon icon={copied ? Check : Copy} /> {copied ? labels.copied : labels.copy}
        </button>
        {canShare ? (
          <button type="button" onClick={share} className="btn-secondary text-sm">
            <Icon icon={Share2} /> {labels.share}
          </button>
        ) : null}
        <a href={url} target="_blank" rel="noreferrer" className="btn-secondary text-sm">
          <Icon icon={ExternalLink} /> {labels.open}
        </a>
      </div>
    </div>
  );
}
