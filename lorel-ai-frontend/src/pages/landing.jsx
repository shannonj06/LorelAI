import { useEffect, useRef } from "react";

import Difference from "../components/difference";
import Footer from "../components/footer";
import Guarantees from "../components/guarantees";
import HomePage from "../components/home_page";
import Navbar from "../components/navbar";
import PaperPage from "../components/paper_page";
import Pipeline from "../components/pipeline";
import TryBand from "../components/try_band";
import { useRouter } from "../lib/router";

export default function Landing() {
  const { hash } = useRouter();
  const demoInput = useRef(null);

  // Arriving at "/#section" from another page: scroll there once the page has rendered
  useEffect(() => {
    if (!hash) return undefined;
    const timer = setTimeout(() => {
      const target = document.getElementById(hash.slice(1));
      target?.scrollIntoView({ behavior: "smooth", block: hash === "#demo" ? "center" : "start" });
      if (hash === "#demo") demoInput.current?.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(timer);
  }, [hash]);

  return (
    <>
      <Navbar onFocusDemo={() => setTimeout(() => demoInput.current?.focus({ preventScroll: true }), 350)} />
      <HomePage demoInputRef={demoInput} />
      <Guarantees />
      <Pipeline />
      <PaperPage />
      <Difference />
      <TryBand />
      <Footer />
    </>
  );
}
