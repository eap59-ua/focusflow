"use client";

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AppRouter } from "@/presentation/trpc/routers/_app";

function makeTrpcClient() {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: "/api/trpc" })],
  });
}

export function LogoutButton() {
  const router = useRouter();
  const [trpc] = useState(() => makeTrpcClient());
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await trpc.auth.logout.mutate();
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="rounded border border-neutral-300 px-4 py-2 disabled:opacity-50"
    >
      {loading ? "Cerrando sesión..." : "Cerrar sesión"}
    </button>
  );
}
