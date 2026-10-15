import { Temporal } from "@js-temporal/polyfill";
export const postTypes = [
  "event",
  "offer",
  "request",
  "trip",
  "recommendation",
  "announcement",
  "discussion",
];
export function eventInstant(value: string, zone: string): string | null {
  if (!value.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Use YYYY-MM-DDTHH:mm for event dates.");
  return Temporal.PlainDateTime.from(value)
    .toZonedDateTime(zone, { disambiguation: "reject" })
    .toInstant()
    .toString();
}
export function localEventTime(value: string | null, zone: string): string {
  return value
    ? Temporal.Instant.from(value)
        .toZonedDateTimeISO(zone)
        .toPlainDateTime()
        .toString({ smallestUnit: "minute" })
    : "";
}
export function positiveCapacity(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > 2147483647
  )
    throw new Error("Capacity must be a positive whole number.");
  return number;
}
