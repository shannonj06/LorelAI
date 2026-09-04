import { useEffect, useState } from "react";
import book1 from "../assets/lorelaimg1.jpg";
import book2 from "../assets/lorelaimg2.jpg";
import book3 from "../assets/lorelaimg3.jpg";

const BOOKS = [
  { title: "The Whole-Brain Child", author: "Siegel & Bryson", img: book1 },
  { title: "No-Drama Discipline", author: "Siegel & Bryson", img: book2 },
  {
    title: "How to Talk So Kids Will Listen & Listen So Kids Will Talk",
    author: "Faber & Mazlish",
    img: book3,
  },
];

const demoQuestions = [
  {
    id: 1,
    question:
      "My child gets completely overwhelmed by their emotions. How can I help them calm down?",
    answer:
      "When your child is overwhelmed, focus first on helping them feel safe and understood. Connecting with their emotions before trying to reason with them can help them calm down and become more receptive to guidance.",
    sources: ["The Whole-Brain Child"],
  },
  {
    id: 2,
    question:
      "My 5-year-old has tantrums whenever I say no. How should I handle them without giving in?",
    answer:
      "Try to stay calm and connect with your child emotionally while still maintaining the boundary. Discipline does not have to mean punishment. Once your child is calmer, you can redirect the moment toward understanding what happened and making a better choice next time.",
    sources: ["No-Drama Discipline"],
  },
  {
    id: 3,
    question:
      "How can I get my child to listen without yelling or repeating myself?",
    answer:
      "Instead of immediately giving commands or raising your voice, try describing what you see or what needs to be done in a clear, simple way. Acknowledging your child's feelings can also make them more willing to listen and cooperate.",
    sources: [
      "How to Talk So Kids Will Listen & Listen So Kids Will Talk",
    ],
  },
];

function SmokeMirrors({ onBack }) {
  const [selectedBooks, setSelectedBooks] = useState([]);

  function toggleBook(title) {
    setSelectedBooks((prev) =>
      prev.includes(title)
        ? prev.filter((t) => t !== title)
        : [...prev, title]
    );
  }

  return (
    <section className="smoke">
      <div className="smoke-inner">
        <button type="button" className="back-link" onClick={onBack}>
          ← Back home
        </button>

        <p className="small-heading">Interactive demo</p>
        <h1 className="big_heading">See how LorelAi answers</h1>
        <p className="section-lede">
          Build your library, then ask a question. Every answer is grounded in
          expert-authored books — and cited back to the one it came from.
        </p>

        <SelectBooks selectedBooks={selectedBooks} toggleBook={toggleBook} />
        <ChatBot />
      </div>
    </section>
  );
}

function StepHeader({ number, title, hint }) {
  return (
    <div className="smoke-step__head">
      <span className="smoke-step__num">{number}</span>
      <div>
        <h2 className="smoke-step__title">{title}</h2>
        <p className="smoke-step__hint">{hint}</p>
      </div>
    </div>
  );
}

function SelectBooks({ selectedBooks, toggleBook }) {
  return (
    <div className="smoke-step">
      <StepHeader
        number="1"
        title="Build your library"
        hint="Select all the books so LorelAi can cite any of them in its answers."
      />

      <div className="smoke-books">
        {BOOKS.map((book) => {
          const active = selectedBooks.includes(book.title);
          return (
            <button
              key={book.title}
              type="button"
              className={`smoke-book${active ? " is-selected" : ""}`}
              onClick={() => toggleBook(book.title)}
              aria-pressed={active}
            >
              <span className="smoke-book__cover">
                <img src={book.img} alt={book.title} />
                <span className="smoke-book__check">✓</span>
              </span>
              <span className="smoke-book__title">{book.title}</span>
              <span className="smoke-book__author">{book.author}</span>
            </button>
          );
        })}
      </div>

      <p className="smoke-books__status">
        {selectedBooks.length > 0
          ? `Library ready — ${selectedBooks.length} book${
              selectedBooks.length > 1 ? "s" : ""
            } added.`
          : "No books selected yet."}
      </p>
    </div>
  );
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function ChatBot() {
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [typed, setTyped] = useState(0);

  const answer = selectedQuestion?.answer ?? "";
  const isTyping = selectedQuestion !== null && typed < answer.length;

  // Pick a prompt: reset the stream to the top (or straight to the full
  // answer for anyone who asked for reduced motion).
  function askQuestion(question) {
    setSelectedQuestion(question);
    setTyped(prefersReducedMotion() ? question.answer.length : 0);
  }

  // Reveal the answer one character at a time, like a chat streaming in.
  useEffect(() => {
    if (!isTyping) return;
    const tick = setTimeout(() => setTyped((n) => n + 1), 18);
    return () => clearTimeout(tick);
  }, [isTyping, typed]);

  return (
    <div className="smoke-step">
      <StepHeader
        number="2"
        title="Ask LorelAi"
        hint="Pick a question to see a grounded, cited answer."
      />

      <div className="smoke-prompts">
        {demoQuestions.map((q) => (
          <button
            key={q.id}
            type="button"
            className={`smoke-prompt${
              selectedQuestion?.id === q.id ? " is-active" : ""
            }`}
            onClick={() => askQuestion(q)}
          >
            {q.question}
          </button>
        ))}
      </div>

      <div className="ai-demo smoke-chat">
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
          {selectedQuestion ? (
            <div className="smoke-chat__thread" key={selectedQuestion.id}>
              <div className="ai-demo__row ai-demo__row--user">
                <span className="ai-demo__who">you</span>
                <p className="ai-demo__bubble">{selectedQuestion.question}</p>
              </div>

              <div className="ai-demo__row ai-demo__row--ai">
                <span className="ai-demo__who ai-demo__who--ai">lorelai</span>
                <p className="ai-demo__bubble ai-demo__bubble--ai">
                  {answer.slice(0, typed)}
                  {isTyping && <span className="ai-demo__caret" />}
                </p>
              </div>

              {!isTyping && (
                <div className="smoke-chat__sources">
                  <span className="smoke-chat__sources-label">Cited from</span>
                  {selectedQuestion.sources.map((source) => (
                    <span key={source} className="ai-demo__cite">
                      {source}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="smoke-chat__empty">
              Select a question above to generate a response.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default SmokeMirrors;
