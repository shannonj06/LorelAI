import cut from "../assets/cut_out.svg";
import { useAuth } from "../lib/auth";
import { Link } from "../lib/router";

/* Closing call to action, on the torn-paper card the waitlist used. */
function TryBand() {
  const { status } = useAuth();
  return (
    <section className="wait-list try-band">
      <div className="wait-card" style={{ backgroundImage: `url(${cut})` }}>
        <h2>Ask your first question tonight.</h2>
        <p>Free account · unlimited questions · save only the chats you want.</p>
        <div className="try-band__actions">
          {status === "signedIn" ? (
            <Link className="btn btn--primary btn--lg" to="/app">
              Open the app →
            </Link>
          ) : (
            <>
              <Link className="btn btn--primary btn--lg" to="/try?mode=signup">
                Try it now
              </Link>
              <Link className="btn btn--outline btn--lg" to="/try?mode=signin">
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default TryBand;
