import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  getServerContainer,
  sessionCookieName,
} from "@/presentation/trpc/context";
import { OAuthStateMismatchError } from "@/domain/gmail-integration/errors/OAuthStateMismatchError";

function absoluteOrigin(): string {
  return process.env.APP_ORIGIN ?? "http://localhost:3030";
}

function settingsRedirect(query: string): Response {
  return NextResponse.redirect(new URL(`/settings${query}`, absoluteOrigin()));
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return settingsRedirect("?error=oauth_denied");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return settingsRedirect("?error=invalid_state");
  }

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(sessionCookieName())?.value ?? null;
  if (!sessionId) {
    return NextResponse.redirect(new URL("/login", absoluteOrigin()));
  }

  const container = getServerContainer();
  let userId: string;
  try {
    const { user } = await container.getCurrentUser.execute({ sessionId });
    userId = user.id;
  } catch {
    return NextResponse.redirect(new URL("/login", absoluteOrigin()));
  }

  try {
    await container.completeGmailConnection.execute({ userId, code, state });
    return settingsRedirect("?connected=1");
  } catch (err) {
    if (err instanceof OAuthStateMismatchError) {
      return settingsRedirect("?error=invalid_state");
    }
    return settingsRedirect("?error=exchange_failed");
  }
}
