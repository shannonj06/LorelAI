import { useWaitlist } from "../lib/useWaitlist";
import { Link } from "../lib/router";
import LiveDemo from "./live_demo";

function HomePage({ demoInputRef }) {
  const { email, setEmail, status, message, submit } = useWaitlist();

  return (
    <section className="hero" id="waitlist">
      <div className="hero-content">
        <span className="hero-pill">
          <i className="hero-pill__pulse" />
          retrieval-grounded AI · licensed book corpus
        </span>

        <h1>
          The parenting AI that
          <br />
          <span>can't make things up.</span>
        </h1>


        <p className="hero-lede">
          Ask anything about raising your kid. Every answer is generated only
          from licensed, expert-authored books — and cited back to the page it
          came from.
        </p>

        <form className="wait-form hero-form" onSubmit={submit}>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={status === "loading"}
            aria-label="Email for the waitlist"
          />
          <button type="submit" disabled={status === "loading"}>
            {status === "loading" ? "Joining..." : "Join Waitlist"}
          </button>
        </form>
        {message && (
          <p className={`wait-message wait-message--${status}`}>{message}</p>
        )}

        <p className="hero-subtitle">
          FREE TO JOIN · CITED TO THE PAGE · LICENSED SOURCES ONLY
        </p>
        <p className="hero-try">
          Don&rsquo;t want to wait? <Link to="/try">Try it now, free →</Link>
        </p>
      </div>

      <div className="hero-demo">
        <LiveDemo inputRef={demoInputRef} />
        <p className="hero-demo__caption">
          Live, not a recording: ask the real answer engine. Retrieval, grounded
          generation and the citation check all run before you see a word.
        </p>
      </div>
    </section>
  );
}

export default HomePage;
