import { useState } from "react";
import cut from "../assets/cut_out.svg";
import { supabase } from "../lib/supabaseClient";

function Waitlist(){
    const [email, setEmail] = useState("");
    const [status, setStatus] = useState("idle"); // idle | loading | success | error
    const [message, setMessage] = useState("");

    async function handleSubmit(e){
        e.preventDefault();
        setStatus("loading");
        setMessage("");

        const { error } = await supabase
            .from("waitlist")
            .insert({ email });

        if (error) {
            // 23505 = unique_violation (email already on the list)
            if (error.code === "23505") {
                setStatus("success");
                setMessage("You're already on the list — thanks!");
            } else {
                setStatus("error");
                setMessage("Something went wrong. Please try again.");
            }
            return;
        }

        setStatus("success");
        setMessage("You're on the list! We'll be in touch.");
        setEmail("");
    }

    return(
        <section className="wait-list">
            <div className="wait-card" style={{ backgroundImage: `url(${cut})` }}>
                <h2>Be First to LorelAI</h2>
                <p>Join the waitlist for early access.</p>
                <form className="wait-form" onSubmit={handleSubmit}>
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
