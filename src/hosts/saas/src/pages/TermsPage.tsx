import termsContent from "../legal/terms";

export function TermsPage() {
    return (
        <main className="page-width legal-page">
            <p className="kicker">Legal</p>
            <h1>{termsContent.title}</h1>
            <p className="legal-intro">{termsContent.intro}</p>
            {termsContent.sections.map(([heading, body]) => <section key={heading}><h2>{heading}</h2><p>{body}</p></section>)}
        </main>
    );
}