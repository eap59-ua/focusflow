import { cookies } from "next/headers";
import Link from "next/link";

import {
  getServerContainer,
  sessionCookieName,
} from "@/presentation/trpc/context";

import { LogoutButton } from "./LogoutButton";

async function getCurrentDisplayName(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(sessionCookieName())?.value ?? null;
  if (!sessionId) return null;
  try {
    const { user } = await getServerContainer().getCurrentUser.execute({
      sessionId,
    });
    return user.displayName;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const displayName = await getCurrentDisplayName();

  if (displayName) {
    return (
      <main className="mx-auto mt-16 max-w-md px-4">
        <h1 className="text-3xl font-semibold">Hola, {displayName}</h1>
        <p className="mt-2 text-sm text-neutral-600">
          FocusFlow — Morning briefing diario desde tu bandeja de Gmail.
        </p>
        <div className="mt-6">
          <LogoutButton />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto mt-16 max-w-md px-4">
      <h1 className="text-3xl font-semibold">FocusFlow</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Morning briefing diario desde tu bandeja de Gmail. MVP en construcción.
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/login"
          className="rounded bg-black px-4 py-2 text-white"
        >
          Iniciar sesión
        </Link>
        <Link
          href="/register"
          className="rounded border border-neutral-300 px-4 py-2"
        >
          Crear cuenta
        </Link>
      </div>
    </main>
  );
}
