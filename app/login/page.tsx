import { redirect } from "next/navigation";
import { isSignedIn } from "@/lib/auth/require-session";
import { authConfigured } from "@/lib/auth/session";
import LoginForm from "./form";

export default async function LoginPage() {
  if (await isSignedIn()) redirect("/");
  return (
    <main id="main" className="login-page">
      <section className="account login-card">
        <h1>Portfolio</h1>
        <p className="muted">Enter your password to continue.</p>
        {authConfigured() ? (
          <LoginForm />
        ) : (
          <p className="notice error" role="alert">
            Sign-in is not configured. Set DASHBOARD_PASSWORD and
            DASHBOARD_SESSION_SECRET on the server.
          </p>
        )}
      </section>
    </main>
  );
}
