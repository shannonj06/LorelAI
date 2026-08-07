import airplane from "../assets/paper-airplane.svg";

function Navbar(){
    return(
        <nav className="navbar">
            <div className="logo">
                <img src={airplane} alt=""/>
                <span>LorelAI</span>
            </div>
            <div className="nav-links">
                <a href="#">Product</a>
                <a href="#">Pricing</a>
                <a href="#">How it works</a>
                <button>Join Waitlist</button>
            </div>
        </nav>
    );
}
export default Navbar