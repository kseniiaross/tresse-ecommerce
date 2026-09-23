import axios from "axios";
import {
	getAccessToken,
	getRefreshToken,
	setAccessToken,
	setRefreshToken,
} from "../types/token";

const rawEnv =
	import.meta.env.VITE_API_URL ||
	import.meta.env.VITE_BACKEND_URL ||
	"http://127.0.0.1:8000";

const normalized = String(rawEnv).trim().replace(/\/+$/, "");

const baseURL = normalized.endsWith("/api") ? normalized : `${normalized}/api`;

const axiosInstance = axios.create({
	baseURL,
	withCredentials: false,
});

axiosInstance.interceptors.request.use((config) => {
	const token = getAccessToken();
	if (token) {
		config.headers = config.headers ?? {};
		config.headers.Authorization = `Bearer ${token}`;
	}
	return config;
});

// Endpoints that must NOT trigger global unauthorized handling (public auth flows)
const NO_AUTH = [
	"/token/",
	"/token/refresh/",
	"/accounts/login/",
	"/accounts/register/",
	"/accounts/restore/request/",
	"/accounts/restore/confirm/",
];

let onUnauthorized: (() => void) | null = null;

export const setOnUnauthorized = (cb: (() => void) | null) => {
	onUnauthorized = cb;
};

/* ================= Refresh logic =================
 *
 * On a 401 for a request that isn't one of the public NO_AUTH auth flows,
 * try once to refresh the access token and replay the original request
 * before giving up. The backend has ROTATE_REFRESH_TOKENS and
 * BLACKLIST_AFTER_ROTATION enabled — the refresh token used here is
 * blacklisted the moment it's used, so the rotated refresh token in the
 * response must be stored too, or the *next* refresh will fail.
 *
 * The refresh call itself goes through the plain `axios` module rather than
 * `axiosInstance`, so it never runs through these same interceptors (no risk
 * of it recursively triggering another 401/refresh cycle).
 */

type RefreshResponse = { access: string; refresh?: string };

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

function enqueueRefresh(cb: (token: string | null) => void) {
	refreshQueue.push(cb);
}

function resolveQueue(token: string | null) {
	for (const cb of refreshQueue) cb(token);
	refreshQueue = [];
}

async function refreshAccessToken(): Promise<string> {
	const refresh = getRefreshToken();
	if (!refresh) throw new Error("No refresh token");

	const resp = await axios.post<RefreshResponse>(
		`${baseURL}/accounts/token/refresh/`,
		{ refresh },
	);
	const access = resp.data?.access;

	if (!access) throw new Error("No access token in refresh response");

	setAccessToken(access);

	if (resp.data?.refresh) {
		setRefreshToken(resp.data.refresh);
	}

	return access;
}

axiosInstance.interceptors.response.use(
	(resp) => resp,
	async (err) => {
		const status = err?.response?.status;
		const originalRequest = err?.config;
		const url = String(originalRequest?.url || "");
		const isNoAuthRoute = NO_AUTH.some((p) => url.startsWith(p));

		if (status !== 401 || isNoAuthRoute || !originalRequest) {
			return Promise.reject(err);
		}

		const req = originalRequest as typeof originalRequest & {
			_retry?: boolean;
		};

		if (req._retry) {
			onUnauthorized?.();
			return Promise.reject(err);
		}

		req._retry = true;

		if (isRefreshing) {
			return new Promise((resolve, reject) => {
				enqueueRefresh((token) => {
					if (!token) {
						reject(err);
						return;
					}
					req.headers = req.headers ?? {};
					req.headers.Authorization = `Bearer ${token}`;
					resolve(axiosInstance(req));
				});
			});
		}

		isRefreshing = true;

		try {
			const newAccess = await refreshAccessToken();
			resolveQueue(newAccess);

			req.headers = req.headers ?? {};
			req.headers.Authorization = `Bearer ${newAccess}`;
			return await axiosInstance(req);
		} catch {
			resolveQueue(null);
			onUnauthorized?.();
			return Promise.reject(err);
		} finally {
			isRefreshing = false;
		}
	},
);

// Derives media/static root from API base URL (strip trailing /api)
export const getMediaRoot = () => {
	const b = String(axiosInstance.defaults.baseURL || "").replace(/\/$/, "");
	return b.endsWith("/api") ? b.slice(0, -4) : b;
};

export default axiosInstance;
