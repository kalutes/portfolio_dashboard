import "server-only";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const sessionCookie = "portfolio_session";
export const sessionLifetime = 30 * 24 * 60 * 60;

function settings() {
  const password = process.env.DASHBOARD_PASSWORD;
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  return password && secret && secret.length >= 32
    ? { password, secret }
    : null;
}
export function authConfigured() {
  return settings() !== null;
}
export function passwordMatches(candidate: string) {
  const config = settings();
  if (!config || candidate.length > 1024) return false;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(candidate), hash(config.password));
}
function signature(body: string) {
  const config = settings();
  if (!config) throw new Error("Dashboard authentication is not configured.");
  // Rotating either secret invalidates existing sessions.
  return createHmac("sha256", config.secret)
    .update(JSON.stringify([config.password, body]))
    .digest("hex");
}
export function createSession(now = Date.now()) {
  const body = `${Math.floor(now / 1000) + sessionLifetime}.${randomBytes(24).toString("hex")}`;
  return `${body}.${signature(body)}`;
}
export function validSession(token: string | undefined, now = Date.now()) {
  if (!authConfigured() || !token || token.length > 200) return false;
  const match = /^(\d{10})\.([a-f0-9]{48})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  const current = Math.floor(now / 1000);
  if (expires <= current || expires > current + sessionLifetime) return false;
  return timingSafeEqual(
    Buffer.from(match[3], "hex"),
    Buffer.from(signature(`${match[1]}.${match[2]}`), "hex"),
  );
}
export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure:
      process.env.AUTH_COOKIE_SECURE === "false"
        ? false
        : process.env.NODE_ENV === "production" ||
          process.env.AUTH_COOKIE_SECURE === "true",
    path: "/",
    maxAge: sessionLifetime,
  };
}

/** Single-process, global limit: no trust in client-supplied proxy/IP headers. */
export function createLoginLimiter(limit = 10, windowMs = 60_000) {
  let attempts = 0;
  let resetAt = 0;
  return (now = Date.now()) => {
    if (now >= resetAt) {
      attempts = 0;
      resetAt = now + windowMs;
    }
    if (attempts >= limit) return false;
    attempts++;
    return true;
  };
}
export const allowLoginAttempt = createLoginLimiter();
