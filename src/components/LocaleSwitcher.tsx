import { setLocaleAction } from "@/app/actions";

export function LocaleSwitcher({ current, label }: { current: string; label: string }) {
  return (
    <form action={setLocaleAction} className="flex items-center gap-1">
      <label className="sr-only" htmlFor="locale-select">{label}</label>
      {/* No inline onChange handler (CSP); the small OK button submits. */}
      <select id="locale-select" name="locale" defaultValue={current} className="input w-auto py-2 text-sm">
        <option value="es">ES</option>
        <option value="en">EN</option>
      </select>
      <button type="submit" className="btn-secondary ml-1 px-2 py-2 text-sm">OK</button>
    </form>
  );
}
