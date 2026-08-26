import type { ReactNode } from "react";
import { AmbientBackground } from "@/components/layout/AmbientBackground";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

/**
 * The public page frame: ambient background, navbar, `main`, footer.
 *
 * Extracted once `/buy`, `/sell` and `/rent` joined the landing page in needing
 * exactly this arrangement. `id="main-content"` is the target of the skip link in
 * `app/layout.tsx`, so every page that uses this frame gets skip-to-content for
 * free — and cannot forget to.
 *
 * The landing page composes the same pieces directly rather than through this,
 * because it is the only page whose sections are ordered by hand and read more
 * clearly listed out.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <>
      <AmbientBackground />
      <Navbar />
      <main id="main-content">{children}</main>
      <Footer />
    </>
  );
}
