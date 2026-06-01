import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  getServerContainer,
  sessionCookieName,
} from "@/presentation/trpc/context";

export async function GET(): Promise<Response> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(sessionCookieName())?.value ?? null;
  if (!sessionId) {
    return NextResponse.redirect(new URL("/login", absoluteOrigin()));
  }

  const container = getServerContainer();
  try {
    const { user } = await container.getCurrentUser.execute({ sessionId });
    const { authorizeUrl } = await container.beginGmailConnection.execute({
      userId: user.id,
    });
    return NextResponse.redirect(authorizeUrl);
  } catch {
    return NextResponse.redirect(new URL("/login", absoluteOrigin()));
  }
}

function absoluteOrigin(): string {
  return process.env.APP_ORIGIN ?? "http://localhost:3030";
}
