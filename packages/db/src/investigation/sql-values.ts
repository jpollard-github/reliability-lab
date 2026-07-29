/** Shared conversion and escaping at the raw PostgreSQL read-model boundary. */
import { sql, type SQL } from "drizzle-orm";

export function inValues(column: SQL, values: string[]): SQL {
  return sql`${column} IN (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

export function numberValue(value: number | string | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

export function nullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

export function isoValue(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
