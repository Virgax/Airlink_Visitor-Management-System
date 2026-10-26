"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Icon } from "@/components/Icon";

type Theme = "light" | "dark";

function readTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" ? "dark" : "light";
}

export function ThemeToggle({ label }: { label: string }) {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => setTheme(readTheme()), []);
  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode */
    }
    setTheme(next);
  };
  return (
    <button type="button" onClick={toggle} className="btn-secondary px-2 py-2" aria-label={label} title={label}>
      <Icon icon={theme === "dark" ? Sun : Moon} />
    </button>
  );
}
