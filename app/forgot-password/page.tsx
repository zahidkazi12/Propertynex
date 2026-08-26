import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { ForgotPasswordFlow } from "@/components/auth/ForgotPasswordFlow";

export const metadata: Metadata = {
  title: "Reset Password — PROPERTYNEX",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      imageSrc="https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?q=80&w=1600&auto=format&fit=crop"
      imageAlt="Modern home entryway"
      panelTitle="Security, without the hassle."
      panelSubtitle="We verify it's really you with a one-time passcode sent to the email or mobile number on your account. It expires in minutes and works only once."
    >
      <ForgotPasswordFlow />
    </AuthShell>
  );
}
