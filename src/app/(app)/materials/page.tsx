import { redirect } from "next/navigation";

/** Compatibility: Materials are now a tab of the unified Learning hub. */
export default function MaterialsRedirect() {
  redirect("/learning?tab=materials");
}
