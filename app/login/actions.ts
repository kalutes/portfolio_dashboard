"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  allowLoginAttempt,
  authConfigured,
  passwordMatches,
  createSession,
  sessionCookie,
  cookieOptions,
} from "@/lib/auth/session";

export async function login(_previous: { error: string }, data: FormData) {
  if (!authConfigured())
    return {
      error:
        "Sign-in is not configured. Set the dashboard password and session secret on the server.",
    };
  if (!allowLoginAttempt())
    return { error: "Too many attempts. Wait one minute and try again." };
  const password = data.get("password");
  if (typeof password !== "string" || !passwordMatches(password))
    return { error: "Incorrect password." };
  (await cookies()).set(sessionCookie, createSession(), cookieOptions());
  redirect("/");
}
export async function logout() {
  (await cookies()).set(sessionCookie, "", { ...cookieOptions(), maxAge: 0 });
  redirect("/login");
}
