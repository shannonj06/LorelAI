import book from "../assets/home_book.svg";
import { useWaitlist } from "../lib/useWaitlist";

function HomePage(){
    const { email, setEmail, status, message, submit } = useWaitlist();

    return(
        <section className="hero" id="waitlist">
            <div className="hero-content">
                <h1>Talk to Books
                <br />
                You Can <span>Trust.</span>
                </h1>
                <p className="hero-subtitle">
                    FREE TO JOIN * CITED TO THE PAGE * LICENSED SOURCES ONLY
                </p>
                <form className="wait-form hero-form" onSubmit={submit}>
                    <input
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={status === "loading"}
                    />
                    <button type="submit" disabled={status === "loading"}>
                        {status === "loading" ? "Joining..." : "Join Waitlist"}
                    </button>
                </form>
                {message && (
                    <p className={`wait-message wait-message--${status}`}>{message}</p>
                )}
                <div className="hero-buttons">
                    <img src={book} className="hero-book" alt="" />
                </div>
            </div>
        </section>
    );
}
export default HomePage;
