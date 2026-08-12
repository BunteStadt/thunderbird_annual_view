import { SignIn } from "@clerk/react";

export function LoginPage() {
    const next = new URLSearchParams(globalThis.location.search).get("next") ?? "/app";
    return <main className="auth-page page-width"><section className="auth-panel"><SignIn routing="hash" forceRedirectUrl={next} signUpForceRedirectUrl={next} /></section></main>;
}