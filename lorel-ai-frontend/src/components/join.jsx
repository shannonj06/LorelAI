import cut from "../assets/cut_out.svg";

function Waitlist(){
    return(
        <section className="wait-list">
            <div className="wait-card" style={{ backgroundImage: `url(${cut})` }}>
                <h2>Be First to LorelAI</h2>
                <p>Join the waitlist for early access.</p>
                <form className="wait-form" onSubmit={(e) => e.preventDefault()}>
                    <input type="email" placeholder="you@example.com" />
                    <button type="submit">Join Waitlist</button>
                </form>
            </div>
        </section>
    );
}

export default Waitlist;
