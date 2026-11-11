import { BASE_PATH } from "@/lib/config";
import { parseThemeChoice, safeReturnPath, themeCookie } from "@/lib/theme";

/**
 * The theme control's form posts here, so it works with JavaScript off: remember the choice (or
 * forget it, for Auto) and send the reader back to the page they were on.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Expected a form.\n", { status: 400 });
  }
  const choice = parseThemeChoice(form.get("theme"));
  if (!choice) return new Response("theme must be auto, light or dark.\n", { status: 400 });
  return new Response(null, {
    status: 303,
    headers: {
      Location: safeReturnPath(form.get("return"), BASE_PATH),
      "Set-Cookie": themeCookie(choice, BASE_PATH),
      "Cache-Control": "no-store",
    },
  });
}
