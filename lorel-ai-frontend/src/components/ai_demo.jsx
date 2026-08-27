import { useEffect, useMemo, useState } from "react";

/* A scripted run of the real answer loop: the parent's question, the passages
   retrieval pulls back, the grounded answer streaming in, and the citation
   check that runs before anything reaches the screen. */
const QUESTION =
  "My 4-year-old melts down at bedtime every single night. What do I do?";

const SOURCES = [
  {
    title: "The Whole-Brain Child",
    author: "Siegel & Bryson",
    loc: "ch. 3 · p. 78",
    score: 0.94,
  },
  {
    title: "How to Talk So Little Kids Will Listen",
    author: "Faber & King",
    loc: "ch. 2 · p. 41",
    score: 0.91,
  },
  {
    title: "No-Drama Discipline",
    author: "Siegel & Bryson",
    loc: "ch. 6 · p. 132",
    score: 0.87,
  },
];

const ANSWER = [
  {
    text: "A bedtime meltdown is usually a flooded downstairs brain, not defiance — the reasoning part of your child's brain is offline, so reasoning with it won't land.",
    cite: 0,
  },
  {
    text: "Connect before you redirect. Name the feeling out loud first: “You wish the day wasn't over.” Then hold the limit.",
    cite: 1,
  },
  {
    text: "Finish with a small, bounded choice so she gets some control back — pajamas first or teeth first. Same bedtime, her call.",
    cite: 2,
  },
];

/* Flatten the answer into word-level tokens so it can be revealed the way the
   model actually emits it, with each citation chip landing on its clause. */
const TOKENS = ANSWER.flatMap((chunk, chunkIndex) => {
  const words = chunk.text.split(" ").map((value) => ({
    type: "word",
    value,
    chunkIndex,
  }));
  return [...words, { type: "cite", value: chunk.cite, chunkIndex }];
});

const PHASES = ["typing", "retrieving", "answering", "verified"];

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.(MOTION_QUERY).matches)
  );
}

function AiDemo() {
  /* Anyone who asked for less motion gets the finished run instead of the
     animation — seeded here so the demo never starts and then snaps. */
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [phase, setPhase] = useState(() =>
    prefersReducedMotion() ? "verified" : "typing"
  );
  const [typed, setTyped] = useState(() =>
    prefersReducedMotion() ? QUESTION.length : 0
  );
  const [sourcesShown, setSourcesShown] = useState(() =>
    prefersReducedMotion() ? SOURCES.length : 0
  );
  const [tokensShown, setTokensShown] = useState(() =>
    prefersReducedMotion() ? TOKENS.length : 0
  );

  /* Honour the setting if it flips while the page is open. */
  useEffect(() => {
    const query = window.matchMedia?.(MOTION_QUERY);
    if (!query) return;
    const onChange = (event) => {
      setReducedMotion(event.matches);
      if (!event.matches) return;
      setPhase("verified");
      setTyped(QUESTION.length);
      setSourcesShown(SOURCES.length);
      setTokensShown(TOKENS.length);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  /* 1 — the parent types. */
  useEffect(() => {
    if (reducedMotion || phase !== "typing") return;
    if (typed >= QUESTION.length) {
      const done = setTimeout(() => setPhase("retrieving"), 420);
      return () => clearTimeout(done);
    }
    const tick = setTimeout(() => setTyped((n) => n + 1), 26);
    return () => clearTimeout(tick);
  }, [phase, typed, reducedMotion]);

  /* 2 — retrieval pulls passages out of the licensed index. */
  useEffect(() => {
    if (reducedMotion || phase !== "retrieving") return;
    if (sourcesShown >= SOURCES.length) {
      const done = setTimeout(() => setPhase("answering"), 620);
      return () => clearTimeout(done);
    }
    const tick = setTimeout(() => setSourcesShown((n) => n + 1), 460);
    return () => clearTimeout(tick);
  }, [phase, sourcesShown, reducedMotion]);

  /* 3 — the answer streams, grounded in exactly those passages. */
  useEffect(() => {
    if (reducedMotion || phase !== "answering") return;
    if (tokensShown >= TOKENS.length) {
      const done = setTimeout(() => setPhase("verified"), 340);
      return () => clearTimeout(done);
    }
    const next = TOKENS[tokensShown];
    const tick = setTimeout(
      () => setTokensShown((n) => n + 1),
      next.type === "cite" ? 220 : 42
    );
    return () => clearTimeout(tick);
  }, [phase, tokensShown, reducedMotion]);

  /* 4 — hold on the verified answer, then run it again. */
  useEffect(() => {
    if (reducedMotion || phase !== "verified") return;
    const restart = setTimeout(() => {
      setTyped(0);
      setSourcesShown(0);
      setTokensShown(0);
      setPhase("typing");
    }, 6800);
    return () => clearTimeout(restart);
  }, [phase, reducedMotion]);

  const phaseIndex = PHASES.indexOf(phase);
  const visibleTokens = useMemo(
    () => TOKENS.slice(0, tokensShown),
    [tokensShown]
  );

  return (
    <div className="ai-demo" aria-hidden="true">
      <div className="ai-demo__chrome">
        <span className="ai-demo__dot" />
        <span className="ai-demo__dot" />
        <span className="ai-demo__dot" />
        <span className="ai-demo__chrome-label">lorelai · answer engine</span>
        <span className="ai-demo__status">
          <i className="ai-demo__pulse" />
          grounded
        </span>
      </div>

      <div className="ai-demo__body">
        {/* The question */}
        <div className="ai-demo__row ai-demo__row--user">
          <span className="ai-demo__who">you</span>
          <p className="ai-demo__bubble">
            {QUESTION.slice(0, typed)}
            {phase === "typing" && <span className="ai-demo__caret" />}
          </p>
        </div>

        {/* Retrieval trace */}
        {phaseIndex >= 1 && (
          <div className="ai-demo__trace">
            <div className="ai-demo__trace-head">
              <span className="ai-demo__trace-label">
                retrieval · licensed index
              </span>
              <span className="ai-demo__trace-count">
                {sourcesShown}/{SOURCES.length} passages
              </span>
            </div>
            <ul className="ai-demo__sources">
              {SOURCES.map((source, index) => (
                <li
                  key={source.title}
                  className={`ai-demo__source${
                    index < sourcesShown ? " is-in" : ""
                  }`}
                >
                  <span className="ai-demo__source-meta">
                    <span className="ai-demo__source-title">{source.title}</span>
                    <span className="ai-demo__source-sub">
                      {source.author} — {source.loc}
                    </span>
                  </span>
                  <span className="ai-demo__score">
                    <span className="ai-demo__score-bar">
                      <span
                        className="ai-demo__score-fill"
                        style={{
                          width:
                            index < sourcesShown
                              ? `${source.score * 100}%`
                              : "0%",
                        }}
                      />
                    </span>
                    {source.score.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Grounded answer */}
        {phaseIndex >= 2 && (
          <div className="ai-demo__row ai-demo__row--ai">
            <span className="ai-demo__who ai-demo__who--ai">lorelai</span>
            <p className="ai-demo__bubble ai-demo__bubble--ai">
              {visibleTokens.map((token, index) =>
                token.type === "word" ? (
                  <span key={index}>{token.value} </span>
                ) : (
                  <span key={index} className="ai-demo__cite">
                    {SOURCES[token.value].title}, {SOURCES[token.value].loc}
                  </span>
                )
              )}
              {phase === "answering" && <span className="ai-demo__caret" />}
            </p>
          </div>
        )}

        {/* Guardrail receipt */}
        {phase === "verified" && (
          <div className="ai-demo__verify">
            <span className="ai-demo__check">✓</span>
            <span>
              3 claims checked · 3 cited to a page · 0 uncited claims shipped
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default AiDemo;
