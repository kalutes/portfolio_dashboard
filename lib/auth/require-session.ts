import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookie, validSession } from "./session";

export async function isSignedIn() {
  return validSession((await cookies()).get(sessionCookie)?.value);
}
export async function requireSession() {
  if (!(await isSignedIn())) redirect("/login");
}
