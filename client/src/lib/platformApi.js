// API client for the MacQuad platform admin area (separate login from shop staff).
import axios from "axios";

const KEY = "pos.platformToken";
export const getPlatformToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setPlatformToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* ignore */ } };

export const papi = axios.create({ baseURL: "/api/platform", timeout: 15000 });
papi.interceptors.request.use((c) => {
  const t = getPlatformToken();
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});
papi.interceptors.response.use((r) => r, (err) => {
  if (err.response?.status === 401 && !String(err.config?.url).includes("/login") && getPlatformToken()) {
    setPlatformToken(null);
    window.location.href = "/platform";
  }
  return Promise.reject(err);
});
