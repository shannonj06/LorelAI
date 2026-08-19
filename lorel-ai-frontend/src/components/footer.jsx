import logo from "../assets/lorelai_logo_transparent.svg";

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-brand">
        <div className="footer-logo">
          <img src={logo} alt="LorelAI" />
        </div>

        <p className="footer-description">
          AI experts built only from books you can trust, cited to every source.
        </p>
      </div>
    </footer>
  );
}

export default Footer;
