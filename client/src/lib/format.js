export const dateTime = (d, tz) =>
  d ? new Date(d).toLocaleString("en-GB", { timeZone: tz, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
export const dateOnly = (d, tz) =>
  d ? new Date(d).toLocaleDateString("en-GB", { timeZone: tz, day: "2-digit", month: "short", year: "numeric" }) : "";
// YYYY-MM-DD for "today" in the shop's timezone.
export const todayISO = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
export const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const fullName = (u) => (u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "");
