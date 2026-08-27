/* Side-by-side of the same parenting question through a general assistant and
   through LorelAI — the fastest way to show why the AI here is different. */
const ROWS = [
  {
    label: "Where the answer comes from",
    generic: "Whatever the model absorbed in training. Unknown, unlicensed, unauditable.",
    lorel: "A passage retrieved from a book the publisher licensed to us.",
  },
  {
    label: "What happens at the edge of knowledge",
    generic: "It fills the gap with something plausible.",
    lorel: "It says the corpus doesn't cover this, and shows what it did find.",
  },
  {
    label: "Can a parent check it",
    generic: "No source, or a source that doesn't exist.",
    lorel: "Book, chapter, and page beside every claim.",
  },
  {
    label: "What the author gets",
    generic: "Their work used, uncredited, unpaid.",
    lorel: "Attribution on every answer and a licensing relationship behind it.",
  },
];

function Difference() {
  return (
    <section className="difference" id="difference">
      <p className="small-heading">why it's different</p>
      <h1 className="big_heading">Same question. Two very different systems.</h1>

      <div className="diff-grid">
        <div className="diff-col diff-col--label" aria-hidden="true" />
        <div className="diff-col diff-col--head diff-col--generic">
          <span className="diff-head__kicker">general assistant</span>
          <span className="diff-head__title">Answers from memory</span>
        </div>
        <div className="diff-col diff-col--head diff-col--lorel">
          <span className="diff-head__kicker">lorelai</span>
          <span className="diff-head__title">Answers from a page</span>
        </div>

        {ROWS.map((row) => (
          <div className="diff-row" key={row.label}>
            <p className="diff-row__label">{row.label}</p>
            <p className="diff-row__cell diff-row__cell--generic">
              <span className="diff-mark diff-mark--x">✕</span>
              {row.generic}
            </p>
            <p className="diff-row__cell diff-row__cell--lorel">
              <span className="diff-mark diff-mark--check">✓</span>
              {row.lorel}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default Difference;
