import logo from "../assets/lorelai_logo_transparent.svg";

function Navbar(){
    return(
        <nav className="navbar">
            <div className="logo">
                <img src={logo} alt=""/>
                <span>LorelAI</span>
            </div>
            <div className="nav-links">
                <button>Join Waitlist</button>
            </div>
        </nav>
    );
}
export default Navbar