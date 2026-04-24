import { execSync } from "node:child_process";

import { Client } from "pg";

export async function setup(): Promise<void> {
  process.loadEnvFile(".env.test");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL no está definida en .env.test");
  }

  const parsed = new URL(dbUrl);
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!dbName) {
    throw new Error(`No se pudo extraer el nombre de BD de ${dbUrl}`);
  }

  const adminUrl = new URL(dbUrl);
  adminUrl.pathname = "/postgres";

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already exists")) {
      throw err;
    }
  } finally {
    await admin.end();
  }

  execSync("pnpm prisma migrate deploy", {
    env: { ...process.env },
    stdio: "inherit",
  });
}
