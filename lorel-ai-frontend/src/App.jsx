import Navbar from "./components/navbar";
import HomePage from "./components/home_page";
import PaperPage from "./components/paper_page";
import Waitlist from "./components/join";
import Footer from "./components/footer";

function App() {
  return (
    <>
      <Navbar />
      <HomePage />
      <PaperPage />
      <Waitlist />
      <Footer />
    </>
  );
}

export default App;
