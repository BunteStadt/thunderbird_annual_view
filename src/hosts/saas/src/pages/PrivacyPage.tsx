import privacyContent from "../legal/privacy";

export function PrivacyPage() {
    return (
        <main className="page-width legal-page">
            <p className="kicker">Legal</p>
            <h1>{privacyContent.title}</h1>
            <p className="legal-intro">{privacyContent.intro}</p>
            {privacyContent.sections.map(([heading, body]) => <section key={heading}><h2>{heading}</h2><p>{body}</p></section>)}
        </main>
    );
}