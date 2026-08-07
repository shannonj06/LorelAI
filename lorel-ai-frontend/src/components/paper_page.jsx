import paper from "../assets/paper.svg";
import response from "../assets/response_image.svg";
import info from "../assets/info2_img.svg";

function PaperPage(){
    return(
        <section className="paper-page">
            <p className="small-heading">how it works</p>
            <h1 className= "big_heading">Three steps to a source you can trust.</h1>
            <div className="paper-container">
                <img src={paper}/>
                 <div className="paper-text">
                    <div className="step">
                        <h3>Choose your books</h3>
                        <p>
                        Add titles from our licensed catalog, or request the ones your
                        work depends on.
                        </p>
                    </div>

                    <div className="step">
                        <h3>Ask in plain language</h3>
                        <p>
                        Chat like you would with the author, asking your questions
                        for your kids.
                        </p>
                    </div>

                    <div className="step">
                        <h3>Get cited answers</h3>
                        <p>
                        Every response links to the exact book, chapter, and page it came
                        from.
                        </p>
                    </div>
            </div>
            </div>
            <div className="info_page_1">
                <p className="small-heading">the product</p>
                <h1 className="big_heading">Answers with backup.</h1>
                <p>Ask anything. Get a clear answer — and the
                <br /> 
                    page it came from, right beside it.</p>
                <img src= {response}/>
            </div>
            <div className="info_page_2">
                <p className="small-heading">for publishers <br />
                                            and consumers</p>
                <h1 className="big_heading">Your books, your answers.</h1>
                <p>No Books enter without a license.
                <br /> 
                    Every answer names the source. So
                <br />
                    you can review reliable and
                <br />
                    credited support</p>
                <img src={info}/>
            </div>
        </section>
    );
}
export default PaperPage;