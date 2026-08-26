import Link from "next/link";
import { Home } from "lucide-react";
import { AmbientBackground } from "@/components/layout/AmbientBackground";
import { Logo } from "@/components/layout/Logo";

export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 text-center">
      <AmbientBackground />

      <main id="main-content" className="relative">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <p className="text-[5rem] font-extrabold leading-none text-white/[0.07] sm:text-[7rem]">
          404
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Page not found
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-slate-400">
          This listing doesn&apos;t exist — or hasn&apos;t been built yet.
        </p>
        <Link href="/" className="btn-primary mt-8 inline-flex">
          <Home className="h-4 w-4" aria-hidden="true" />
          Back to home
        </Link>
      </main>
    </div>
  );
}
