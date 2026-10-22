import { NextResponse } from "next/server";
import {
  clearWebPassword,
  getWebAuthStatus,
  setWebPassword,
  setWebPasswordEnabled,
  validatePassword,
} from "@/bin/web-auth-store.js";
import { hasJsonContentType } from "@/lib/request-security";
import type { WebAccessStatus } from "@/lib/api-types";

/**
 * The password lock, as the settings panel drives it.
 *
 * Every request here has already passed `proxy.ts` — the host allow-list, the
 * cross-site rejection, and (once the lock is on) Basic Auth — so the route
 * itself only has to police the payload. Recovery is deliberately *not* here:
 * it is the one endpoint that answers without credentials, and it lives in
 * `./recovery`.
 */

export const dynamic = "force-dynamic";

type WebAccessAction = "set-password" | "enable" | "disable" | "clear";

const ACTIONS = new Set<WebAccessAction>(["set-password", "enable", "disable", "clear"]);

/**
 * Classify `validatePassword`'s rejection into the stable code the UI translates.
 *
 * The wording is owned by `bin/web-auth-store.js`, which the launcher shares, so
 * this matches its messages instead of restating the limits here: the length
 * limits travel back as `count`, and `error` keeps the original text for a code
 * the UI does not know.
 * @param message rejection message returned by `validatePassword`
 * @returns code plus the length limit when the message carries one
 */
function passwordError(message: string): { code: string; count?: number } | undefined {
  if (message === "A password is required.") return { code: "passwordRequired" };
  if (message.startsWith("The password must be at least")) return { code: "passwordTooShort", count: passwordLimit(message) };
  if (message.startsWith("The password must be at most")) return { code: "passwordTooLong", count: passwordLimit(message) };
  if (message === "The password cannot be only whitespace.") return { code: "passwordWhitespace" };
  return undefined;
}

/** The limit `validatePassword` quotes ("… at least 8 characters long."). */
function passwordLimit(message: string): number | undefined {
  const limit = Number(message.match(/\d+/)?.[0]);
  return Number.isFinite(limit) ? limit : undefined;
}

function statusResponse(status: WebAccessStatus) {
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return statusResponse(getWebAuthStatus());
}

export async function PUT(req: Request) {
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Expected a JSON body", code: "invalidBody" }, { status: 415 });
  }

  let body: { action?: unknown; password?: unknown };
  try {
    body = await req.json() as { action?: unknown; password?: unknown };
  } catch {
    return NextResponse.json({ error: "Expected a JSON body", code: "invalidBody" }, { status: 400 });
  }

  const action = body.action;
  if (typeof action !== "string" || !ACTIONS.has(action as WebAccessAction)) {
    return NextResponse.json({ error: "Unknown action", code: "unknownAction" }, { status: 400 });
  }

  // `OMP_WEB_PASSWORD` overrides the stored credential, so editing the store
  // while it is set would change nothing a user could observe.
  if (getWebAuthStatus().managedByEnvironment) {
    return NextResponse.json(
      {
        error: "Password access is managed by the OMP_WEB_PASSWORD environment variable. Unset it to manage the password here.",
        code: "environmentManaged",
      },
      { status: 409 },
    );
  }

  try {
    switch (action as WebAccessAction) {
      case "set-password": {
        const invalid = validatePassword(body.password);
        if (invalid) {
          const classified = passwordError(invalid);
          return NextResponse.json(
            { error: invalid, ...(classified ?? {}) },
            { status: 400 },
          );
        }
        return statusResponse(setWebPassword(body.password));
      }
      case "enable":
        return statusResponse(setWebPasswordEnabled(true));
      case "disable":
        return statusResponse(setWebPasswordEnabled(false));
      case "clear":
        return statusResponse(clearWebPassword());
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      message === "Set a password before enabling password access."
        ? { error: message, code: "passwordRequiredForEnable" }
        : { error: message },
      { status: 400 },
    );
  }
}
