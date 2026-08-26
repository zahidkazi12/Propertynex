import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignupForm } from "@/components/auth/SignupForm";

export const metadata: Metadata = {
  title: "Sign Up — PROPERTYNEX",
};

export default function SignupPage() {
  return (
    <AuthShell
      imageSrc="https://images.unsplash.com/photo-1560518883-ce09059eeffa?q=80&w=1600&auto=format&fit=crop"
      imageAlt="Contemporary apartment building exterior"
      panelTitle="Find. Invest. Belong."
      panelSubtitle="Create your PROPERTYNEX account to save properties, connect with agents, and more."
    >
      <SignupForm />
    </AuthShell>
  );
}
