import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  getServerContainer,
  sessionCookieName,
} from "@/presentation/trpc/context";

const FLASH_ERRORS: Record<string, string> = {
  oauth_denied: "Cancelaste la autorización en Google. Puedes intentarlo de nuevo cuando quieras.",
  invalid_state:
    "La sesión OAuth no coincide o expiró. Por favor, vuelve a iniciar la conexión.",
  exchange_failed:
    "No se pudieron obtener los tokens de Google. Inténtalo de nuevo en unos minutos.",
};

interface SettingsPageProps {
  searchParams: Promise<{ connected?: string; error?: string }>;
}

async function loadCurrentUser(): Promise<{ id: string; displayName: string } | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(sessionCookieName())?.value ?? null;
  if (!sessionId) return null;
  try {
    const { user } = await getServerContainer().getCurrentUser.execute({
      sessionId,
    });
    return { id: user.id, displayName: user.displayName };
  } catch {
    return null;
  }
}

async function disconnectGmailAction(): Promise<void> {
  "use server";
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(sessionCookieName())?.value ?? null;
  if (!sessionId) {
    redirect("/login");
  }
  const container = getServerContainer();
  try {
    const { user } = await container.getCurrentUser.execute({ sessionId });
    await container.disconnectGmail.execute({ userId: user.id });
  } catch {
    redirect("/login");
  }
  revalidatePath("/settings");
  redirect("/settings");
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const me = await loadCurrentUser();
  if (!me) {
    redirect("/login");
  }

  const { connected, error } = await searchParams;
  const status = await getServerContainer().getGmailStatus.execute({
    userId: me.id,
  });

  return (
    <main className="mx-auto mt-16 max-w-md px-4">
      <h1 className="text-3xl font-semibold">Ajustes</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Conecta tu Gmail para que FocusFlow pueda generar el briefing diario.
      </p>

      {connected === "1" && (
        <p className="mt-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Gmail conectado correctamente.
        </p>
      )}
      {error && FLASH_ERRORS[error] && (
        <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {FLASH_ERRORS[error]}
        </p>
      )}

      <section className="mt-8 rounded border border-neutral-200 p-4">
        <h2 className="text-lg font-medium">Gmail</h2>
        {status.connected ? (
          <>
            <p className="mt-2 text-sm text-neutral-700">
              Conectado: <strong>{status.googleAccountEmail}</strong>
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Conectado el{" "}
              {status.connectedAt.toLocaleString("es-ES", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
            <form action={disconnectGmailAction} className="mt-4">
              <button
                type="submit"
                className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
              >
                Desconectar
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-neutral-700">Gmail no conectado.</p>
            <a
              href="/settings/gmail/connect"
              className="mt-4 inline-block rounded bg-black px-4 py-2 text-sm text-white"
            >
              Conectar Gmail
            </a>
          </>
        )}
      </section>
    </main>
  );
}
