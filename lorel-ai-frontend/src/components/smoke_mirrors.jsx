import { useEffect, useState } from "react";
import book1 from "../assets/lorelaimg1.jpg";
import book2 from "../assets/lorelaimg2.jpg";
import book3 from "../assets/lorelaimg3.jpg";

const WHOLE_BRAIN = "The Whole-Brain Child";
const NO_DRAMA = "No-Drama Discipline";
const HOW_TO_TALK = "How to Talk So Kids Will Listen & Listen So Kids Will Talk";

const BOOKS = [
  { title: WHOLE_BRAIN, author: "Siegel & Bryson", img: book1 },
  { title: NO_DRAMA, author: "Siegel & Bryson", img: book2 },
  { title: HOW_TO_TALK, author: "Faber & Mazlish", img: book3 },
];

// Each question has a distinct, book-specific answer. Only the books a parent
// has "loaded" get cited, so 2 loaded books produce 2 answers, 3 produce 3.
const demoQuestions = [
  {
    id: 1,
    question:
      "My child gets completely overwhelmed by their emotions. How can I help them calm down?",
    answers: {
      [WHOLE_BRAIN]:
        "Big feelings mean the emotional right brain has taken over. Connect first — get down low, use a soothing tone, and reflect what they feel. Once they're calmer, engage the logical left brain by helping them name and retell what happened.",
      [NO_DRAMA]:
        "When emotions flood your child, the thinking part of their brain goes offline, so this isn't the moment to teach. Calm the storm first with warm, nonjudgmental connection; the lesson can wait until they're regulated enough to hear you.",
      [HOW_TO_TALK]:
        "Instead of dismissing or fixing the feeling, give it words: \"You seem really frustrated right now.\" Naming what a child feels — rather than arguing them out of it — helps them feel understood and begins to settle them.",
    },
  },
  {
    id: 2,
    question:
      "My 5-year-old has tantrums whenever I say no. How should I handle them without giving in?",
    answers: {
      [WHOLE_BRAIN]:
        "A tantrum is a downstairs-brain reaction, not a choice. Stay calm to keep your own upstairs brain online, acknowledge the want (\"You really wish you could have it\"), and hold the limit — engaging their thinking brain instead of matching their storm.",
      [NO_DRAMA]:
        "You can be kind and firm at once. Connect with the feeling behind the meltdown before you redirect, keep the boundary steady, and once they're calm, use the moment to teach a better way to handle disappointment. Discipline, not punishment.",
      [HOW_TO_TALK]:
        "Acknowledge the wish rather than the object: \"You wish you could have candy right now — a whole bowl of it!\" Granting the longing in fantasy often takes the heat out of the \"no\" in reality, while the limit itself stays in place.",
    },
  },
  {
    id: 3,
    question:
      "How can I get my child to listen without yelling or repeating myself?",
    answers: {
      [WHOLE_BRAIN]:
        "Yelling triggers your child's defensive downstairs brain and shuts down listening. Connect first with eye contact and a calm cue, then make one short, clear request so their upstairs brain can actually process it and cooperate.",
      [NO_DRAMA]:
        "Repeating yourself and raising your voice invites a power struggle. Get close, connect, and give a single calm, specific direction — cooperation grows out of a felt sense of connection, not volume.",
      [HOW_TO_TALK]:
        "Try describing the problem instead of commanding: \"I see toys all over the floor.\" Or offer a choice, or say it in a single word — \"Toys!\" Describing what you see invites a child to work out what to do, so you don't have to nag.",
    },
  },
];

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

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
          Build your library, then ask a question. LorelAi answers only from the
          books you've loaded — and cites each one it draws from.
        </p>

        <SelectBooks selectedBooks={selectedBooks} toggleBook={toggleBook} />
        <ChatBot selectedBooks={selectedBooks} />
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
        hint="Load the books you want LorelAi to draw from — each loaded book can be cited."
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
            } loaded.`
          : "No books loaded yet."}
      </p>
    </div>
  );
}

function ChatBot({ selectedBooks }) {
  const [selectedQuestion, setSelectedQuestion] = useState(null);

  // Loaded books, kept in the display order of the shelf.
  const loaded = BOOKS.filter((book) => selectedBooks.includes(book.title));

  return (
    <div className="smoke-step">
      <StepHeader
        number="2"
        title="Ask LorelAi"
        hint="Pick a question to see a grounded answer cited to each loaded book."
      />

      <div className="smoke-prompts">
        {demoQuestions.map((q) => (
          <button
            key={q.id}
            type="button"
            className={`smoke-prompt${
              selectedQuestion?.id === q.id ? " is-active" : ""
            }`}
            onClick={() => setSelectedQuestion(q)}
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
          {selectedBooks.length === 0 ? (
            <p className="smoke-chat__empty">
              Load at least one book in step 1 to start asking.
            </p>
          ) : !selectedQuestion ? (
            <p className="smoke-chat__empty">
              Select a question above to generate a response.
            </p>
          ) : (
            <AnswerStream
              // Remount (and restart the stream) whenever the question or the
              // set of loaded books changes.
              key={`${selectedQuestion.id}::${loaded
                .map((b) => b.title)
                .join("|")}`}
              question={selectedQuestion}
              books={loaded}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AnswerStream({ question, books }) {
  const answers = books.map((book) => ({
    book: book.title,
    text: question.answers[book.title],
  }));

  const reduced = prefersReducedMotion();
  // index = which answer is currently streaming; once it reaches answers.length
  // every answer is fully typed. Reduced motion jumps straight to the end.
  const [index, setIndex] = useState(reduced ? answers.length : 0);
  const [chars, setChars] = useState(0);

  useEffect(() => {
    if (index >= answers.length) return;
    const current = answers[index];
    if (chars < current.text.length) {
      const tick = setTimeout(() => setChars((n) => n + 1), 18);
      return () => clearTimeout(tick);
    }
    // Current answer finished — move to the next after a short beat.
    const next = setTimeout(() => {
      setIndex((i) => i + 1);
      setChars(0);
    }, 520);
    return () => clearTimeout(next);
  }, [answers, index, chars]);

  return (
    <div className="smoke-chat__thread">
      <div className="ai-demo__row ai-demo__row--user">
        <span className="ai-demo__who">you</span>
        <p className="ai-demo__bubble">{question.question}</p>
      </div>

      {answers.map((answer, i) => {
        if (i > index) return null; // not started yet
        const complete = i < index || chars >= answer.text.length;
        const shown = complete ? answer.text : answer.text.slice(0, chars);
        const typing = i === index && !complete;
        return (
          <div key={answer.book} className="ai-demo__row ai-demo__row--ai">
            <span className="ai-demo__who ai-demo__who--ai">lorelai</span>
            <p className="ai-demo__bubble ai-demo__bubble--ai">
              {shown}
              {typing && <span className="ai-demo__caret" />}
            </p>
            {complete && (
              <div className="smoke-chat__sources">
                <span className="smoke-chat__sources-label">Cited from</span>
                <span className="ai-demo__cite">{answer.book}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default SmokeMirrors;
