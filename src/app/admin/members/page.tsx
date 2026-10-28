import { redirect } from "next/navigation";

/** Users and roles moved into the merged "Personas" screen. */
export default function MembersRedirect() {
  redirect("/admin/people");
}
