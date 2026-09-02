import paper from "../assets/paper_strip.svg";

function PaperPage() {
  return (
    <section className="paper-page">
      <p className="small-heading">what a parent does</p>
      <h1 className="big_heading">Three steps to an answer you can check.</h1>
      <div
        className="paper-container"
        style={{ backgroundImage: `url(${paper})` }}
      >
        <div className="paper-text">
          <div className="step">
            <h3>Pick the experts you trust</h3>
            <p>
              Choose titles from our licensed catalog. Those books — and only
              those books — become the corpus your AI answers from.
            </p>
          </div>

          <div className="step">
            <h3>Ask in plain language</h3>
            <p>
              Ask at 2am the way you'd ask the author. The model reads your
              question, not keywords, and pulls the passages that actually
              address it.
            </p>
          </div>

          <div className="step">
            <h3>Get the answer and the receipt</h3>
            <p>
              Every response arrives with the exact book, chapter, and page
              behind it — so you can read the source yourself in one tap.
            </p>
          </div>
        </div>
      </div>

      <div className="info_page_2">
        <p className="small-heading">
          for publishers <br />
          and parents
        </p>
        <h1 className="big_heading">Your books, your answers.</h1>
        <p>
          No book enters the index without a license. Every answer names the
          author it came from. Publishers get attribution and a revenue line
          instead of a scraped corpus.
        </p>
        <div className="license-card">
          <div className="license-item">
            <p className="license-eyebrow">protected</p>
            <h3>Licensed only</h3>
            <p className="license-detail">
              Books are cited, never reproduced wholesale or scraped.
            </p>
          </div>

          <div className="license-item">
            <p className="license-eyebrow">attributed</p>
            <h3>Named every time</h3>
            <p className="license-detail">
              Title, author, and page shown on every answer.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default PaperPage;
