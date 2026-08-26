import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import type { SafeUser } from "@/types";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // This is the authoritative check. Middleware only looked for the
  // presence of a cookie; this verifies that cookie's token actually maps
  // to a live, unexpired Session document in the database before anything
  // in the dashboard renders.
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?redirectTo=/dashboard");
  }

  const safeUser: SafeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    image: user.image,
    createdAt: user.createdAt.toISOString(),
  };

  return <DashboardShell user={safeUser}>{children}</DashboardShell>;
}
