import { useState } from "react";
import { supabase } from "./supabaseClient";

// Shared waitlist-signup logic used by every "Join Waitlist" form.
export function useWaitlist(){
    const [email, setEmail] = useState("");
    const [status, setStatus] = useState("idle"); // idle | loading | success | error
    const [message, setMessage] = useState("");

    async function submit(e){
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

    return { email, setEmail, status, message, submit };
}
