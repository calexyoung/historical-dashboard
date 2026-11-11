import { redirect } from "next/navigation";
import { releaseForRequest } from "@/lib/release/server";

/**
 * Until the Overview exists (M22), the front door is the Explorer. This is a route, not a
 * next.config redirect, so the proxy still runs first and a refused Release answers 503 here too.
 */
export default async function Home() {
  await releaseForRequest();
  redirect("/explore");
}
