/* Architectural guarantees, not traction numbers — each one is enforced by the
   pipeline rather than promised in copy. */
const GUARANTEES = [
  {
    stat: "100%",
    label: "of shipped claims cited",
    detail: "An answer with an uncited claim never renders.",
  },
  {
    stat: "0",
    label: "unlicensed pages indexed",
    detail: "Ingest is gated on a signed publisher agreement.",
  },
  {
    stat: "page",
    label: "level citation granularity",
    detail: "Book, chapter, and page — not a title dropped at the end.",
  },
  {
    stat: "closed",
    label: "book generation",
    detail: "The model writes from retrieved text, never from training recall.",
  },
];

function Guarantees() {
  return (
    <section className="guarantees">
      <ul className="guarantee-grid">
        {GUARANTEES.map((item) => (
          <li className="guarantee" key={item.label}>
            <span className="guarantee__stat">{item.stat}</span>
            <span className="guarantee__label">{item.label}</span>
            <p className="guarantee__detail">{item.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default Guarantees;
