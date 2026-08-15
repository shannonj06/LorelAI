import cut from "../assets/cut_out.svg";
import { useWaitlist } from "../lib/useWaitlist";

function Waitlist(){
    const { email, setEmail, status, message, submit } = useWaitlist();

    return(
        <section className="wait-list">
            <div className="wait-card" style={{ backgroundImage: `url(${cut})` }}>
                <h2>Be First to LorelAI</h2>
                <p>Join the waitlist for early access.</p>
                <form className="wait-form" onSubmit={submit}>
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
            </div>
        </section>
    );
}

export default Waitlist;
