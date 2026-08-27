/* The part investors ask about second: what actually happens between the
   question and the answer, and which of those steps is hard to copy. */
const STAGES = [
  {
    id: "01",
    name: "License",
    detail:
      "A publisher agreement is signed before a single page is ingested. No license, no corpus.",
    moat: true,
  },
  {
    id: "02",
    name: "Ingest",
    detail:
      "Each book is parsed into passages that keep their chapter and page anchors intact.",
  },
  {
    id: "03",
    name: "Embed",
    detail:
      "Passages are embedded into a per-title vector index built for page-level recall.",
  },
  {
    id: "04",
    name: "Retrieve",
    detail:
      "A parent's question is matched against that index and the top passages are pulled.",
  },
  {
    id: "05",
    name: "Ground",
    detail:
      "The model writes from the retrieved passages only — it is never asked to recall on its own.",
    moat: true,
  },
  {
    id: "06",
    name: "Verify",
    detail:
      "Every claim is checked back against a passage. Anything uncited is stripped before display.",
    moat: true,
  },
];

function Pipeline() {
  return (
    <section className="pipeline" id="how-it-works">
      <p className="small-heading">under the hood</p>
      <h1 className="big_heading">
        A retrieval pipeline, not a chatbot wrapper.
      </h1>
      <p className="section-lede">
        General models answer from memory and guess when memory runs out. LorelAI
        never asks the model to remember anything — it retrieves the licensed
        page first, then makes the model write from it.
      </p>

      <ol className="pipeline-track">
        {STAGES.map((stage) => (
          <li
            key={stage.id}
            className={`pipeline-node${stage.moat ? " is-moat" : ""}`}
          >
            <span className="pipeline-node__id">{stage.id}</span>
            <h3 className="pipeline-node__name">{stage.name}</h3>
            <p className="pipeline-node__detail">{stage.detail}</p>
            {stage.moat && <span className="pipeline-node__tag">moat</span>}
          </li>
        ))}
      </ol>

      <p className="pipeline-footnote">
        Steps marked <span className="pipeline-node__tag is-inline">moat</span>{" "}
        are the ones a competitor can't ship by swapping in a bigger model.
      </p>
    </section>
  );
}

export default Pipeline;
