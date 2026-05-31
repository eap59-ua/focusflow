/**
 * Decide si el proceso de workers debe quedarse en idle en vez de arrancar.
 *
 * Semántica (documentada en README §"Variables de entorno"): el scheduler está
 * habilitado por defecto. Sólo el valor explícito `SCHEDULER_ENABLED=false` lo
 * desactiva; cualquier otro valor (incluido sin setear) lo deja activo.
 *
 * Vive en su propio módulo (sin side-effects) para poder testearlo sin ejecutar
 * el entry point `start.ts`.
 */
export function isSchedulerDisabled(
  value: string | undefined = process.env.SCHEDULER_ENABLED,
): boolean {
  return value === "false";
}
