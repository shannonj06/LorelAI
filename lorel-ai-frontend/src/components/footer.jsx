import logo from "../assets/lorelai_logo_transparent.svg";

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
        <a href="#how-it-works">How it works</a>
        <a href="#difference">Why it's different</a>
        <a href="#waitlist">Join the waitlist</a>
      </div>

      <div className="footer-column">
        <h3>For publishers</h3>
        <a href="#waitlist">License your catalog</a>
      </div>
    </footer>
  );
}

export default Footer;
