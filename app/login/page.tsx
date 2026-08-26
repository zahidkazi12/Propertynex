import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Log In — PROPERTYNEX",
};

export default function LoginPage() {
  return (
    <AuthShell
      imageSrc="https://images.unsplash.com/photo-1512917774080-9991f1c4c750?q=80&w=1600&auto=format&fit=crop"
      imageAlt="Bright modern living room interior"
      panelTitle="Pick up right where you left off."
      panelSubtitle="Your saved searches, favorites, and conversations are waiting."
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
