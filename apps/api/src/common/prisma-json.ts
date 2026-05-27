import type { Prisma } from "@prisma/client";

export function jsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function optionalJsonInput<T>(value: T | undefined): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : jsonInput(value);
}

export function jsonOutput<T>(value: unknown): T {
  return value as T;
}

export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function optionalIso(value: Date | string | null | undefined): string | undefined {
  if (value == null) return undefined;
  return iso(value);
}
