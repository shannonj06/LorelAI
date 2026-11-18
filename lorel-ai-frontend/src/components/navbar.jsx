import logo from "../assets/lorelai_logo_transparent.svg";
import { useAuth } from "../lib/auth";
import { Link, useRouter } from "../lib/router";

function Navbar({ onFocusDemo }) {
  const { status } = useAuth();
  const { path, navigate } = useRouter();
  const onHome = path === "/";

  // On the landing page, section links scroll; elsewhere they navigate to "/#section"
  function goToSection(event, id) {
    if (!onHome) return;
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
  }

  function openDemo() {
    if (!onHome) {
      navigate("/#demo");
      return;
    }
    document.getElementById("demo")?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Drop the cursor into the question box once we're there.
    onFocusDemo?.();
  }

  return (
    <nav className="navbar">
      <Link to="/" className="logo" aria-label="LorelAI home">
        <img src={logo} alt="LorelAI" />
      </Link>
      <div className="nav-links">
        <Link to="/#how-it-works" onClick={(event) => goToSection(event, "how-it-works")}>
          How it works
        </Link>
        <Link to="/#difference" onClick={(event) => goToSection(event, "difference")}>
          Why it's different
        </Link>
        <button type="button" className="nav-demo" onClick={openDemo}>
          Live demo →
        </button>
        {status === "signedIn" ? (
          <Link className="nav-cta" to="/app">
            Open app →
          </Link>
        ) : (
          <Link className="nav-cta" to="/try">
            Try it now
          </Link>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
