export const fmtDate = (val) => {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d)) return String(val);
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"2-digit", year:"numeric" });
};
export const fmtDateTime = (val) => {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d)) return String(val);
  return d.toLocaleDateString("en-GB",{ day:"2-digit",month:"2-digit",year:"numeric" }) +
    " " + d.toLocaleTimeString("en-GB",{ hour:"2-digit",minute:"2-digit" });
};
export const fmtCurrency = (val) => val == null ? "" : `$${Number(val).toFixed(2)}`;
export const fmtBool     = (val) => val ? "Yes" : "No";
export const fmtList     = (arr, key = null) => {
  if (!Array.isArray(arr) || !arr.length) return "";
  return arr.map((i) => key ? i?.[key] : i).filter(Boolean).join(", ");
};
export const fmtTruncate = (val, max = 100) => {
  if (val == null) return "";
  const s = String(val);
  return s.length > max ? s.slice(0, max) + "…" : s;
};
