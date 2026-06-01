// scripts/verify-zero-retention.ts
//
// Auditoría automatizada de la política zero-retention de FocusFlow.
//
// Garantías que verifica:
//   1. Ningún briefings.summary parece contener cabeceras raw de email.
//   2. No hay tablas con nombres sugerentes de "email"/"message" en public
//      (whitelist: gmail_integrations).
//   3. No hay columnas bytea/xml expuestas en public.
//   4. Las queues que cargan email content tienen removeOnComplete acotado.
//   5. Static grep: ninguna referencia a `snippet`/`bodyText` fuera de la
//      capa de serialización explícitamente marcada con `// OK: zero-retention`.
//
// Uso:  pnpm verify:zero-retention
// Sale 0 si todo OK; 1 con mensaje claro si falla algún check.
//
// NO modifica datos. NO escribe en ningún sitio.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";

import {
  buildGmailInboxSyncQueue,
  buildGenerateBriefingQueue,
  buildSendBriefingEmailQueue,
  QUEUE_NAMES,
} from "@/jobs/queues";

import { Redis } from "ioredis";

interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

const ROOT = resolve(__dirname, "..");
const SRC_DIR = resolve(ROOT, "src");

function loadEnv(): void {
  process.loadEnvFile(resolve(ROOT, ".env.test"));
}

function fmt(r: CheckResult): string {
  const tag = r.ok ? "PASS" : "FAIL";
  return `[${tag}] ${r.name}${r.detail ? `\n       ${r.detail}` : ""}`;
}

async function checkBriefingsContent(client: Client): Promise<CheckResult> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id
     FROM briefings
     WHERE summary ~* '(^|\\n)from:\\s' OR summary ~* '(^|\\n)subject:\\s' OR summary ~* 'x-mailer'
     LIMIT 5`,
  );
  if (rows.length > 0) {
    return {
      name: "briefings.summary no contiene cabeceras raw de email",
      ok: false,
      detail: `Encontradas ${rows.length} filas con patrones tipo "From:"/"Subject:"/"X-Mailer". IDs: ${rows.map((r) => r.id).join(", ")}`,
    };
  }
  return { name: "briefings.summary no contiene cabeceras raw de email", ok: true };
}

async function checkEmailContentTables(client: Client): Promise<CheckResult> {
  const ALLOWLIST = new Set(["gmail_integrations"]);
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND (table_name ILIKE '%email%' OR table_name ILIKE '%message%')`,
  );
  const offenders = rows.filter((r) => !ALLOWLIST.has(r.table_name));
  if (offenders.length > 0) {
    return {
      name: "no hay tablas que sugieran almacenamiento de emails/mensajes",
      ok: false,
      detail: `Tablas inesperadas: ${offenders.map((r) => r.table_name).join(", ")}`,
    };
  }
  return { name: "no hay tablas que sugieran almacenamiento de emails/mensajes", ok: true };
}

async function checkBlobColumns(client: Client): Promise<CheckResult> {
  const { rows } = await client.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND data_type IN ('bytea', 'xml')`,
  );
  if (rows.length > 0) {
    return {
      name: "no hay columnas bytea/xml en public",
      ok: false,
      detail: rows.map((r) => `${r.table_name}.${r.column_name} (${r.data_type})`).join(", "),
    };
  }
  return { name: "no hay columnas bytea/xml en public", ok: true };
}

async function checkQueueRemoveConfig(redis: Redis): Promise<CheckResult> {
  const queues = [
    { name: QUEUE_NAMES.GMAIL_INBOX_SYNC, q: buildGmailInboxSyncQueue(redis) },
    { name: QUEUE_NAMES.GENERATE_BRIEFING, q: buildGenerateBriefingQueue(redis) },
    { name: QUEUE_NAMES.SEND_BRIEFING_EMAIL, q: buildSendBriefingEmailQueue(redis) },
  ];
  const offenders: string[] = [];
  try {
    for (const { name, q } of queues) {
      const opts = q.opts.defaultJobOptions;
      const removeOnComplete = opts?.removeOnComplete as
        | { age?: number; count?: number }
        | boolean
        | undefined;
      const removeOnFail = opts?.removeOnFail as
        | { age?: number; count?: number }
        | boolean
        | undefined;
      if (
        !removeOnComplete ||
        typeof removeOnComplete !== "object" ||
        typeof removeOnComplete.age !== "number"
      ) {
        offenders.push(`${name}: removeOnComplete no es { age, count }`);
      }
      if (!removeOnFail || typeof removeOnFail !== "object") {
        offenders.push(`${name}: removeOnFail no es objeto con age`);
      }
    }
  } finally {
    await Promise.all(queues.map(({ q }) => q.close()));
  }
  if (offenders.length > 0) {
    return {
      name: "queues con email content tienen removeOnComplete/Fail acotado",
      ok: false,
      detail: offenders.join("\n       "),
    };
  }
  return { name: "queues con email content tienen removeOnComplete/Fail acotado", ok: true };
}

interface StaticGrepRule {
  readonly description: string;
  readonly dir: string;
  readonly pattern: RegExp;
  readonly allowMarker?: string;
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkFiles(full, out);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function runStaticGrep(rule: StaticGrepRule): CheckResult {
  const files = walkFiles(rule.dir);
  const offenders: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (rule.pattern.test(line)) {
        if (rule.allowMarker && line.includes(rule.allowMarker)) return;
        offenders.push(`${file.replace(ROOT, ".")}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  if (offenders.length > 0) {
    return {
      name: rule.description,
      ok: false,
      detail: offenders.slice(0, 10).join("\n       ") + (offenders.length > 10 ? `\n       (+${offenders.length - 10} más)` : ""),
    };
  }
  return { name: rule.description, ok: true };
}

async function main(): Promise<void> {
  loadEnv();
  const dbUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;

  console.log("=== verify-zero-retention ===\n");
  const results: CheckResult[] = [];
  const record = (r: CheckResult): void => {
    results.push(r);
    console.log(fmt(r));
  };

  // 1) Static checks (sin red).
  record(
    runStaticGrep({
      description: "no se referencian snippet/bodyText desde adapters Prisma",
      dir: resolve(SRC_DIR, "infrastructure", "adapters", "prisma"),
      pattern: /\b(snippet|bodyText)\b/,
    }),
  );
  record(
    runStaticGrep({
      description: "src/jobs/ solo referencia snippet/bodyText con // OK: zero-retention",
      dir: resolve(SRC_DIR, "jobs"),
      pattern: /\b(snippet|bodyText)\b/,
      allowMarker: "// OK: zero-retention",
    }),
  );

  // 2) DB checks.
  if (!dbUrl) {
    record({ name: "checks de DB", ok: false, detail: "DATABASE_URL no definida (revisa .env.test)." });
  } else {
    const client = new Client({ connectionString: dbUrl });
    try {
      await client.connect();
      record(await checkBriefingsContent(client));
      record(await checkEmailContentTables(client));
      record(await checkBlobColumns(client));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      record({ name: "checks de DB", ok: false, detail: `No se pudo conectar a ${dbUrl}: ${msg}. ¿docker compose up -d?` });
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  // 3) Runtime queue config.
  if (!redisUrl) {
    record({ name: "queues con email content tienen removeOnComplete/Fail acotado", ok: false, detail: "REDIS_URL no definida." });
  } else {
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
    try {
      await redis.connect();
      record(await checkQueueRemoveConfig(redis));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      record({ name: "queues con email content tienen removeOnComplete/Fail acotado", ok: false, detail: `No se pudo conectar a Redis ${redisUrl}: ${msg}.` });
    } finally {
      redis.disconnect();
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} de ${results.length} check(s) FALLARON. Política zero-retention en riesgo.`);
    process.exit(1);
  }
  console.log(`\nTodos los ${results.length} checks PASSED.`);
}

main().catch((err: unknown) => {
  console.error("[verify-zero-retention] error inesperado:", err);
  process.exit(1);
});
