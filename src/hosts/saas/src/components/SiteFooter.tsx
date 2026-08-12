import { SiGithub, SiThunderbird } from "react-icons/si";
import { Link, type Navigate } from "./Link";

export function SiteFooter({ navigate }: { navigate: Navigate }) {
    return (
        <footer className="site-footer">
            <div className="page-width footer-grid">
                <div className="footer-brand">
                    <strong>Year View</strong>
                    <span>Made with ❤️ in Germany</span>
                </div>
                <nav aria-label="Footer navigation">
                    <Link to="/demo" navigate={navigate}>Demo</Link>
                    <Link to="/pricing" navigate={navigate}>Pricing</Link>
                    <Link to="/login" navigate={navigate}>Sign in</Link>
                    <a href="https://github.com/BunteStadt/thunderbird_annual_view" target="_blank" rel="noreferrer"><SiGithub aria-hidden="true" /> GitHub</a>
                    <a href="https://services.addons.thunderbird.net/De/thunderbird/addon/calendar-annual-view/" target="_blank" rel="noreferrer"><SiThunderbird aria-hidden="true" /> Thunderbird</a>
                    <Link to="/privacy" navigate={navigate}>Privacy</Link>
                    <Link to="/terms" navigate={navigate}>Terms</Link>
                    <Link to="/imprint" navigate={navigate}>Imprint</Link>
                </nav>
            </div>
        </footer>
    );
}