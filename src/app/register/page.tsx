"use client";

import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import { useState } from "react";

import type { AppRouter } from "@/presentation/trpc/routers/_app";

function makeTrpcClient() {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: "/api/trpc" })],
  });
}

type Status = "idle" | "loading" | "success" | "error";

export default function RegisterPage() {
  const [trpc] = useState(() => makeTrpcClient());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setMessage("");
    try {
      const user = await trpc.auth.register.mutate({
        email,
        password,
        displayName,
      });
      setMessage(`Cuenta creada para ${user.email}`);
      setStatus("success");
    } catch (err) {
      if (err instanceof TRPCClientError) {
        setMessage(err.message);
      } else {
        setMessage("Error inesperado");
      }
      setStatus("error");
    }
  }

  return (
    <main className="mx-auto mt-16 max-w-sm px-4">
      <h1 className="mb-6 text-2xl font-semibold">Crear cuenta FocusFlow</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Contraseña (mín. 8)</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Nombre a mostrar</span>
          <input
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="rounded border border-neutral-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={status === "loading"}
          className="rounded bg-black py-2 text-white disabled:opacity-50"
        >
          {status === "loading" ? "Creando..." : "Crear cuenta"}
        </button>
        {message && (
          <p
            className={
              status === "error"
                ? "text-red-600"
                : status === "success"
                  ? "text-green-600"
                  : ""
            }
          >
            {message}
          </p>
        )}
      </form>
    </main>
  );
}
