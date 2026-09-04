import { useState } from "react";
import Navbar from "./components/navbar";
import HomePage from "./components/home_page";
import Guarantees from "./components/guarantees";
import Pipeline from "./components/pipeline";
import PaperPage from "./components/paper_page";
import Difference from "./components/difference";
import Footer from "./components/footer";
import SmokeMirrors from "./components/smoke_mirrors";

function App() {
  const [page, setPage] = useState("home");

  if (page === "smoke") {
    return (
      <>
        <Navbar />
        <SmokeMirrors onBack={() => setPage("home")} />
        <Footer />
      </>
    );
  }

  return (
    <>
      <Navbar />
      <HomePage onOpenSmokeMirrors={() => setPage("smoke")} />
      <Guarantees />
      <Pipeline />
      <PaperPage />
      <Difference />
      <Footer />
    </>
  );
}

export default App;
