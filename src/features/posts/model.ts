export const POST_TYPES = [
  "event",
  "offer",
  "request",
  "trip",
  "recommendation",
  "announcement",
  "discussion",
] as const;
export const STATUSES = ["open", "fulfilled", "cancelled", "archived"] as const;
export type PostType = (typeof POST_TYPES)[number];
export type PostRow = {
  id: string;
  author_id: string;
  category_id: string;
  post_type: PostType;
  title: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
  availability: string;
  conditions: string;
  location: string;
  ride_coordination_enabled: boolean;
};
export type Category = { id: string; name: string; active: boolean };
export type EventRow = {
  post_id: string;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  location: string;
  status: string;
};
export type FormState = { error: string };
export function label(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
export function formatDate(
  value: string,
  zone = "Pacific/Auckland",
  time = false,
) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    ...(time ? { timeStyle: "short" as const } : {}),
  };
  try {
    return new Intl.DateTimeFormat("en-NZ", {
      ...options,
      timeZone: zone,
    }).format(date);
  } catch {
    return (
      new Intl.DateTimeFormat("en-NZ", { ...options, timeZone: "UTC" }).format(
        date,
      ) + " UTC"
    );
  }
}
