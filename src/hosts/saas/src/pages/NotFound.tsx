import type { Navigate } from "../components/Link";

export function NotFound({ navigate }: { navigate: Navigate }) {
    return <main className="status-page page-width"><h1>That page is not here.</h1><button className="button button-primary" onClick={() => navigate("/")}>Return home</button></main>;
}