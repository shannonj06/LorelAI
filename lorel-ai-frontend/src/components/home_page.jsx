import book from "../assets/home_book.svg";

function HomePage(){
    return(
        <section className="hero">
            <div className="hero-content">
                <h1>Talk to Books
                <br />
                You Can <span>Trust.</span>
                </h1>
                <p className="hero-subtitle">
                    FREE TO JOIN * CITED TO THE PAGE * LICENSED SOURCES ONLY
                </p>
                <div className="hero-buttons">
                    <button className="hero-button">Join Waitlist</button>
                    <img src={book} className="hero-book" alt="" />
                    <button className="hero-button">Watch Demo</button>
                </div>
            </div>
        </section>
    );
}
export default HomePage;
