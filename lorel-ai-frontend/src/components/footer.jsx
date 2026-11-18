import logo from "../assets/lorelai_logo_transparent.svg";
import { Link } from "../lib/router";

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-brand">
        <div className="footer-logo">
          <img src={logo} alt="LorelAI" />
        </div>

        <p className="footer-description">
          Retrieval-grounded AI for parents. Built only from licensed books,
          cited to every page.
        </p>
      </div>

      <div className="footer-column">
        <h3>Product</h3>
        <Link to="/#how-it-works">How it works</Link>
        <Link to="/#difference">Why it's different</Link>
        <Link to="/#demo">Live demo</Link>
        <Link to="/try">Try it now</Link>
      </div>

      <div className="footer-column">
        <h3>Account</h3>
        <Link to="/try?mode=signin">Sign in</Link>
        <Link to="/try?mode=signup">Create an account</Link>
        <Link to="/#waitlist">Join the waitlist</Link>
      </div>

      <div className="footer-column">
        <h3>For publishers</h3>
        <Link to="/#waitlist">License your catalog</Link>
      </div>

      <p className="footer-legal">
        The demo library is four public-domain parenting books (1878–1916). Their
        advice reflects their era and is not medical guidance.
      </p>
    </footer>
  );
}

export default Footer;
