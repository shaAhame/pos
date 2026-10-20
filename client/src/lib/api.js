import axios from "axios";

const TOKEN_KEY = "pos.token";
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

export const api = axios.create({ baseURL: "/api", timeout: 15000 });

api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

// Anyone can subscribe to "logged out by the server" (expired/disabled).
const listeners = new Set();
export const onUnauthorized = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const url = err.config?.url || "";
    if (err.response?.status === 401 && !url.startsWith("/auth/login") && !url.startsWith("/auth/setup") && getToken()) {
      setToken(null);
      listeners.forEach((fn) => fn(err.response.data?.message));
    }
    return Promise.reject(err);
  }
);

// A readable message for any failed request.
export const errorMessage = (err, fallback = "Something went wrong") => {
  if (!err) return fallback;
  if (!err.response) return "Can't reach the server. Check the connection.";
  return err.response.data?.message || err.response.data?.error || fallback;
};

// True when the request failed because we're offline / the server or database is down.
export const isConnectionError = (err) =>
  !err.response || err.response.status === 503 || err.response.status === 502 || err.response.status === 504;

export const downloadFile = async (url, params, filename) => {
  const res = await api.get(url, { params, responseType: "blob" });
  const href = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = href; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
};
