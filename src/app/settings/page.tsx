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
  briefing_invalid:
    "Hora o zona horaria no válidas. Revisa los valores e inténtalo de nuevo.",
};

const COMMON_TIMEZONES = [
  "Europe/Madrid",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Argentina/Buenos_Aires",
  "Asia/Tokyo",
  "Asia/Singapore",
  "UTC",
];

interface SettingsPageProps {
  searchParams: Promise<{
    connected?: string;
    error?: string;
    triggered?: string;
    saved?: string;
  }>;
}

interface CurrentUserSnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly briefingHour: number;
  readonly briefingTimezone: string;
  readonly briefingEnabled: boolean;
}

async function loadCurrentUser(): Promise<CurrentUserSnapshot | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(sessionCookieName())?.value ?? null;
  if (!sessionId) return null;
  try {
    const { user } = await getServerContainer().getCurrentUser.execute({
      sessionId,
    });
    return {
      id: user.id,
      displayName: user.displayName,
      briefingHour: user.briefingHour,
      briefingTimezone: user.briefingTimezone,
      briefingEnabled: user.briefingEnabled,
    };
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

async function updateBriefingAction(formData: FormData): Promise<void> {
  "use server";
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(sessionCookieName())?.value ?? null;
  if (!sessionId) {
    redirect("/login");
  }
  const container = getServerContainer();
  let userId: string;
  try {
    const { user } = await container.getCurrentUser.execute({ sessionId });
    userId = user.id;
  } catch {
    redirect("/login");
  }

  const hour = Number(formData.get("hour"));
  const timezone = String(formData.get("timezone") ?? "");
  const enabled = formData.get("enabled") === "on";

  try {
    await container.updateBriefingPreferences.execute({
      userId,
      hour,
      timezone,
      enabled,
    });
  } catch {
    redirect("/settings?error=briefing_invalid");
  }
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

async function triggerBriefingAction(): Promise<void> {
  "use server";
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(sessionCookieName())?.value ?? null;
  if (!sessionId) {
    redirect("/login");
  }
  const container = getServerContainer();
  try {
    const { user } = await container.getCurrentUser.execute({ sessionId });
    await container.triggerBriefingForUser.execute({ userId: user.id });
  } catch {
    redirect("/login");
  }
  redirect("/settings?triggered=1");
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const me = await loadCurrentUser();
  if (!me) {
    redirect("/login");
  }

  const { connected, error, triggered, saved } = await searchParams;
  const status = await getServerContainer().getGmailStatus.execute({
    userId: me.id,
  });

  return (
    <main className="mx-auto mt-16 max-w-md px-4">
      <h1 className="text-3xl font-semibold">Ajustes</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Conecta tu Gmail y elige cuándo recibir el briefing diario.
      </p>

      {connected === "1" && (
        <p className="mt-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Gmail conectado correctamente.
        </p>
      )}
      {triggered === "1" && (
        <p className="mt-4 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
          Briefing en cola. Lo recibirás en unos segundos.
        </p>
      )}
      {saved === "1" && (
        <p className="mt-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Preferencias guardadas.
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

      <section className="mt-8 rounded border border-neutral-200 p-4">
        <h2 className="text-lg font-medium">Briefing diario</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Hora local en la que quieres recibir el briefing matutino.
        </p>
        <form action={updateBriefingAction} className="mt-4 space-y-4">
          <div className="flex gap-4">
            <label className="flex flex-col text-sm">
              <span className="text-neutral-700">Hora</span>
              <input
                type="number"
                name="hour"
                min={0}
                max={23}
                defaultValue={me.briefingHour}
                className="mt-1 w-20 rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="text-neutral-700">Zona horaria</span>
              <select
                name="timezone"
                defaultValue={me.briefingTimezone}
                className="mt-1 rounded border border-neutral-300 px-2 py-1"
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={me.briefingEnabled}
            />
            Recibir briefing automáticamente cada día
          </label>
          <button
            type="submit"
            className="rounded bg-black px-4 py-2 text-sm text-white"
          >
            Guardar preferencias
          </button>
        </form>

        {status.connected && (
          <form action={triggerBriefingAction} className="mt-4">
            <button
              type="submit"
              className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
            >
              Generar uno ahora
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
