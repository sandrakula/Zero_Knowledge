import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  const userId = await getSessionUserId();
  redirect(userId ? "/home" : "/login");
}
