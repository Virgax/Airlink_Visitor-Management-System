import { redirect } from "next/navigation";

/** The directory moved into the merged "Personas" screen. */
export default async function EmployeesRedirect({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  redirect(sp.q ? `/admin/people?tab=hosts&q=${encodeURIComponent(sp.q)}` : "/admin/people?tab=hosts");
}
