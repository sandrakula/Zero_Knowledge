import { redirect } from "next/navigation";

/** Compatibility: Progress is now a tab of the unified Learning hub. */
export default function ProgressRedirect() {
  redirect("/learning?tab=progress");
}
