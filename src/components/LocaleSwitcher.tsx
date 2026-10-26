import { setLocaleAction } from "@/app/actions";

export function LocaleSwitcher({ current, label }: { current: string; label: string }) {
  return (
    <form action={setLocaleAction}>
      <label className="sr-only" htmlFor="locale-select">{label}</label>
      <select
        id="locale-select"
        name="locale"
        defaultValue={current}
        className="input w-auto py-2 text-sm"
        // Submit on change without client JS wiring: a tiny inline handler is not CSP-friendly, so use a button fallback.
      >
        <option value="es">ES</option>
        <option value="en">EN</option>
      </select>
      <button type="submit" className="btn-secondary ml-1 px-2 py-2 text-sm">OK</button>
    </form>
  );
}
