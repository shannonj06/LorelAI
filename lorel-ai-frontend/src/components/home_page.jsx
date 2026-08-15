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
                <form className="wait-form hero-form" onSubmit={(e) => e.preventDefault()}>
                    <input type="email" placeholder="you@example.com" />
                    <button type="submit">Join Waitlist</button>
                </form>
                <div className="hero-buttons">
                    <img src={book} className="hero-book" alt="" />
                </div>
            </div>
        </section>
    );
}
export default HomePage;
