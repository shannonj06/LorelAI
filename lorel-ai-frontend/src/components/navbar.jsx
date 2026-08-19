import logo from "../assets/lorelai_logo_transparent.svg";

function Navbar(){
    function scrollToWaitlist(){
        const section = document.getElementById("waitlist");
        if (!section) return;
        section.scrollIntoView({ behavior: "smooth", block: "start" });
        // Drop the cursor into the email field once we're there.
        section.querySelector("input")?.focus({ preventScroll: true });
    }

    return(
        <nav className="navbar">
            <div className="logo">
                <img src={logo} alt="LorelAI"/>
            </div>
            <div className="nav-links">
                <button onClick={scrollToWaitlist}>Join Waitlist</button>
            </div>
        </nav>
    );
}
export default Navbar
