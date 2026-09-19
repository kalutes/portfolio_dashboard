import test from "node:test";
import assert from "node:assert/strict";
import {
  authConfigured,
  passwordMatches,
  createSession,
  validSession,
  sessionLifetime,
  createLoginLimiter,
} from "../lib/auth/session";
import { proxy } from "../proxy";
import { NextRequest } from "next/server";

test("password, session expiry, tampering, rotation and fail-closed configuration", () => {
  const password = process.env.DASHBOARD_PASSWORD;
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  try {
    delete process.env.DASHBOARD_PASSWORD;
    delete process.env.DASHBOARD_SESSION_SECRET;
    assert.equal(authConfigured(), false);
    assert.equal(passwordMatches(""), false);
    assert.equal(validSession("anything"), false);
    process.env.DASHBOARD_PASSWORD = "test-only-password";
    process.env.DASHBOARD_SESSION_SECRET = "a".repeat(64);
    assert.equal(passwordMatches("test-only-password"), true);
    assert.equal(passwordMatches("wrong"), false);
    const now = Date.now();
    const token = createSession(now);
    assert.equal(validSession(token, now), true);
    assert.equal(validSession(token, now + sessionLifetime * 1000), false);
    assert.equal(validSession(token.slice(0, -2) + "xx", now), false);
    const [expiry, nonce, sig] = token.split(".");
    assert.equal(
      validSession(`${Number(expiry) - 1}.${nonce}.${sig}`, now),
      false,
    );
    for (const path of ["/", "/manual", "/?\u005frsc=1"]) {
      assert.equal(
        proxy(new NextRequest(`http://localhost${path}`)).status,
        303,
      );
      assert.equal(
        proxy(
          new NextRequest(`http://localhost${path}`, {
            headers: { cookie: `portfolio_session=${token}` },
          }),
        ).status,
        200,
      );
    }
    assert.equal(
      proxy(new NextRequest("http://localhost/api/history")).status,
      401,
    );
    assert.equal(
      proxy(new NextRequest("http://localhost/manual", { method: "POST" }))
        .status,
      303,
    );
    assert.equal(
      proxy(new NextRequest("http://localhost/api/health")).status,
      200,
    );
    process.env.DASHBOARD_PASSWORD = "changed";
    assert.equal(validSession(token, now), false);
    process.env.DASHBOARD_PASSWORD = "test-only-password";
    process.env.DASHBOARD_SESSION_SECRET = "b".repeat(64);
    assert.equal(validSession(token, now), false);
    process.env.DASHBOARD_SESSION_SECRET = "short";
    assert.equal(authConfigured(), false);
  } finally {
    if (password === undefined) delete process.env.DASHBOARD_PASSWORD;
    else process.env.DASHBOARD_PASSWORD = password;
    if (secret === undefined) delete process.env.DASHBOARD_SESSION_SECRET;
    else process.env.DASHBOARD_SESSION_SECRET = secret;
  }
});
test("login attempts are limited and recover after the window", () => {
  const allow = createLoginLimiter(2, 1000);
  assert.equal(allow(100), true);
  assert.equal(allow(200), true);
  assert.equal(allow(300), false);
  assert.equal(allow(1100), true);
});
