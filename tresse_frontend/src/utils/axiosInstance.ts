import axios, {
	type AxiosError,
	AxiosHeaders,
	type InternalAxiosRequestConfig,
} from "axios";
import {
	clearTokens,
	getAccessToken,
	getRefreshToken,
	setAccessToken,
} from "../types/token";

const rawEnv =
	import.meta.env.VITE_API_URL ||
	import.meta.env.VITE_BACKEND_URL ||
	"http://127.0.0.1:8000";

const normalized = String(rawEnv).replace(/\/+$/, "");
const baseURL = normalized.endsWith("/api") ? normalized : `${normalized}/api`;

const axiosInstance = axios.create({
	baseURL,
	withCredentials: false,
});

const NO_AUTH = [
	"/accounts/token/",
	"/accounts/token/refresh/",
	"/accounts/login/",
	"/accounts/register/",
];

let onUnauthorized: (() => void) | null = null;

export const setOnUnauthorized = (cb: (() => void) | null) => {
	onUnauthorized = cb;
};

function isNoAuthRequest(config: InternalAxiosRequestConfig): boolean {
	const url = String(config.url || "");
	return NO_AUTH.some((p) => url.startsWith(p) || url.includes(p));
}

function setAuthHeader(config: InternalAxiosRequestConfig, token: string) {
	config.headers = AxiosHeaders.from(config.headers);
	config.headers.set("Authorization", `Bearer ${token}`);
}

/* ================= Request interceptor ================= */

axiosInstance.interceptors.request.use((config) => {
	if (isNoAuthRequest(config)) return config;

	const token = getAccessToken();
	if (token) setAuthHeader(config, token);

	return config;
});

/* ================= Refresh logic ================= */

type RefreshResponse = { access: string };

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

function enqueueRefresh(cb: (token: string | null) => void) {
	refreshQueue.push(cb);
}

function resolveQueue(token: string | null) {
	refreshQueue.forEach((cb) => {
		cb(token);
	});
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
	return access;
}

/* ================= Response interceptor ================= */

axiosInstance.interceptors.response.use(
	(resp) => resp,
	async (error: AxiosError) => {
		const status = error.response?.status;
		const originalRequest = error.config;

		if (!originalRequest) return Promise.reject(error);

		const url = String(originalRequest.url || "");
		const isNoAuthRoute = NO_AUTH.some(
			(p) => url.startsWith(p) || url.includes(p),
		);

		if (status !== 401 || isNoAuthRoute) {
			return Promise.reject(error);
		}

		const req = originalRequest as InternalAxiosRequestConfig & {
			_retry?: boolean;
		};

		if (req._retry) {
			clearTokens();
			onUnauthorized?.();
			return Promise.reject(error);
		}

		req._retry = true;

		try {
			if (isRefreshing) {
				return await new Promise((resolve, reject) => {
					enqueueRefresh((token) => {
						if (!token) {
							clearTokens();
							onUnauthorized?.();
							reject(error);
							return;
						}

						setAuthHeader(req, token);
						resolve(axiosInstance(req));
					});
				});
			}

			isRefreshing = true;

			const newAccess = await refreshAccessToken();
			resolveQueue(newAccess);

			setAuthHeader(req, newAccess);
			return axiosInstance(req);
		} catch {
			resolveQueue(null);
			clearTokens();
			onUnauthorized?.();
			return Promise.reject(error);
		} finally {
			isRefreshing = false;
		}
	},
);

export const getMediaRoot = () => {
	const b = String(axiosInstance.defaults.baseURL || "").replace(/\/$/, "");
	return b.endsWith("/api") ? b.slice(0, -4) : b;
};

export default axiosInstance;
