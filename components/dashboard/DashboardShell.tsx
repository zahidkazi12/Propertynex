"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { AmbientBackground } from "@/components/layout/AmbientBackground";
import type { SafeUser } from "@/types";

export function DashboardShell({
  user,
  children,
}: {
  user: SafeUser;
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    // `min-h-dvh` rather than `min-h-screen`: on mobile browsers `100vh` includes
    // the collapsing address bar, which leaves a dead strip at the bottom.
    <div className="relative flex min-h-dvh">
      <AmbientBackground />

      <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      {/* `min-w-0` stops a wide child (long email, future data table) from
          forcing the whole shell wider than the viewport. */}
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <Topbar user={user} onMenuClick={() => setMobileNavOpen(true)} />
        <main
          id="main-content"
          className="flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
