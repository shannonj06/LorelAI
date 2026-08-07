import paperAirplane from "../assets/paper-airplane.svg";

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-brand">
        <div className="footer-logo">
          <img src={paperAirplane} alt="" />
          <span>LorelAI</span>
        </div>

        <p className="footer-description">
          AI experts built only from books you can trust, cited to every source.
        </p>
      </div>

      <div className="footer-column">
        <h3>Product</h3>

        <a href="#how-it-works">How It Works</a>
        <a href="#product">Product</a>
        <a href="#pricing">Pricing</a>

        <h3 className="legal-heading">Legal</h3>

        <a href="#privacy">Privacy</a>
        <a href="#terms">Terms</a>
      </div>

      <div className="footer-column">
        <h3>Company</h3>

        <a href="#about">About</a>
        <a href="#team">The Team</a>
        <a href="#contact">Contact</a>
      </div>
    </footer>
  );
}

export default Footer;