import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { AmbientBackground } from "@/components/layout/AmbientBackground";
import { Hero } from "@/components/landing/Hero";
import { IntentActions } from "@/components/landing/IntentActions";
import { WhatIsSection } from "@/components/landing/WhatIsSection";
import { FeatureCards } from "@/components/landing/FeatureCards";
import { WhySection } from "@/components/landing/WhySection";
import { FinalCta } from "@/components/landing/FinalCta";

export default function LandingPage() {
  return (
    <>
      <AmbientBackground />
      <Navbar />
      <main id="main-content">
        <Hero />
        {/* Directly under the hero: the visitor knows what this is, so the next
            thing they need is where to go. Ahead of the explanatory sections, not
            after them. */}
        <IntentActions />
        <WhatIsSection />
        <FeatureCards />
        <WhySection />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
