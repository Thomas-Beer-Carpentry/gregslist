export function publicHttpsUrl(value: string | undefined): string | null {
  if (!value || value.includes("YOUR_")) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    if (
      url.hostname === "localhost" ||
      /^(127\.|0\.|169\.254\.|10\.|192\.168\.)/.test(url.hostname)
    )
      return null;
    if (
      !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) ||
      /(^|\.)(localhost|local|test|invalid|example|internal)$/i.test(
        url.hostname,
      )
    )
      return null;
    if (url.pathname !== "/") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isPublishableKey(value: string | undefined): boolean {
  if (!value || value.includes("YOUR_") || value.startsWith("sb_secret_"))
    return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(value)) return true;
  try {
    const payload = JSON.parse(
      atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return payload.role === "anon" && value.split(".").length === 3;
  } catch {
    return false;
  }
}

/** Accept only this deployment's public, non-authentication browser routes. */
export function trustedWebUrl(origin: string, path: string): string {
  if (
    !origin ||
    !/^\/(invite|recover|admin|privacy|account-deletion)(\?|$|#)/.test(path)
  )
    throw new Error("Unsupported browser destination");
  const target = new URL(path, origin);
  if (target.origin !== origin)
    throw new Error("Unsupported browser destination");
  return target.href;
}

export function friendlyError(message: string): string {
  const allowed = [
    "Not enough seats",
    "A passenger already",
    "An active mutually",
    "Your partner must",
    "Booking changed",
    "Capacity cannot",
    "Only the driver",
    "Only the passenger",
    "This ride",
    "Ride coordination is closed",
    "Drivers cannot",
    "Inactive rides",
    "Completed reservations",
    "Operation key",
    "Confirm event cancellation",
    "Completed events cannot",
    "Cancel or complete an upcoming",
    "Withdraw active rides",
    "Confirm closing the associated ride",
  ];
  return allowed.some((prefix) => message.startsWith(prefix)) &&
    message.length < 400
    ? message
    : "The change could not be completed. Refresh and check your details and permissions.";
}
