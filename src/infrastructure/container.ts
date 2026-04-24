/**
 * Composition root. Los adapters concretos se construyen aquí y se exponen
 * a la capa de presentación. Los use cases reciben sus puertos por inyección,
 * nunca importan adapters directamente.
 */
export const container = {} as const;

export type Container = typeof container;
