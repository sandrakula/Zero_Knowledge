import { redirect } from "next/navigation";

/** Compatibility: the Knowledge Map is now a tab of the unified Learning hub. */
export default function MapRedirect() {
  redirect("/learning?tab=map");
}
