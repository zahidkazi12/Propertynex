import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ProfileForm } from "@/components/dashboard/ProfileForm";
import type { SafeUser } from "@/types";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/dashboard/profile");

  const safeUser: SafeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    image: user.image,
    createdAt: user.createdAt.toISOString(),
  };

  return (
    <div
      className="mx-auto max-w-4xl animate-fade-in"
      style={{ animationFillMode: "both" }}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan">
        Account
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
        My Profile
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
        Manage your personal details. Your email and phone number are what
        password-reset passcodes are sent to, so keep them current.
      </p>
      <div className="mt-7">
        <ProfileForm user={safeUser} />
      </div>
    </div>
  );
}
