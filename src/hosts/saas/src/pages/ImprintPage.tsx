import imprintContent from "../legal/imprint";

export function ImprintPage() {
    return (
        <main className="page-width legal-page imprint-page">
            <p className="kicker">Legal</p>
            <h1>{imprintContent.title}</h1>
            <p className="legal-intro">{imprintContent.intro}</p>
            {imprintContent.sections.map(([heading, body]) => <section key={heading}><h2>{heading}</h2><p>{body}</p></section>)}
        </main>
    );
}