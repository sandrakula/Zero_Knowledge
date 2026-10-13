import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { AuthForm } from "@/components/auth/auth-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const userId = await getSessionUserId();
  if (userId) redirect("/home");
  return <AuthForm mode="login" />;
}
