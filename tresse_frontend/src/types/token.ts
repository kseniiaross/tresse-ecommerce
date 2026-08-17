/**
 * We centralize ALL token + auth-storage operations here (single source of truth).
 * This prevents state desync between Redux authSlice and axios interceptors.
 */

const ACCESS_KEY = "access";
const REFRESH_KEY = "refresh";
const USER_KEY = "user";

/**
 * Safe guards for environments where window/localStorage may be unavailable
 * (tests, SSR, prerender, etc.). Prevents runtime crashes.
 */
const isBrowser =
	typeof window !== "undefined" && typeof localStorage !== "undefined";

/**
 * We dispatch an event whenever auth storage changes, so UI can react if needed
 * (optional listener use-case). This does not affect backend behavior.
 */
const AUTH_EVENT = "tresse:authChanged";

function notifyAuthChanged(): void {
	if (!isBrowser) return;
	window.dispatchEvent(new CustomEvent(AUTH_EVENT));
}

function safeGet(key: string): string | null {
	if (!isBrowser) return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function safeSet(key: string, value: string): void {
	if (!isBrowser) return;
	try {
		localStorage.setItem(key, value);
	} catch {}
}

function safeRemove(key: string): void {
	if (!isBrowser) return;
	try {
		localStorage.removeItem(key);
	} catch {}
}

/** Access token */
export function getAccessToken(): string | null {
	return safeGet(ACCESS_KEY);
}

export function setAccessToken(token: string): void {
	const t = typeof token === "string" ? token.trim() : "";
	if (!t) return;

	safeSet(ACCESS_KEY, t);
	notifyAuthChanged();
}

export function removeAccessToken(): void {
	safeRemove(ACCESS_KEY);
	notifyAuthChanged();
}

/** Refresh token */
export function getRefreshToken(): string | null {
	return safeGet(REFRESH_KEY);
}

export function setRefreshToken(token: string): void {
	const t = typeof token === "string" ? token.trim() : "";
	if (!t) return;

	safeSet(REFRESH_KEY, t);
	notifyAuthChanged();
}

export function removeRefreshToken(): void {
	safeRemove(REFRESH_KEY);
	notifyAuthChanged();
}

/** Simple "am I authenticated?" helper (token exists) */
export function isAuthenticated(): boolean {
	return Boolean(getAccessToken());
}

/**
 * We also remove legacy keys to avoid conflicts with old deployments.
 */
export function clearTokens(): void {
	safeRemove(ACCESS_KEY);
	safeRemove(REFRESH_KEY);

	// legacy cleanup
	safeRemove("token");
	safeRemove("access_token");

	notifyAuthChanged();
}

/**
 * UI logout should wipe everything related to auth.
 */
export function clearAuthStorage(): void {
	clearTokens();
	safeRemove(USER_KEY);
	notifyAuthChanged();
}

export const AUTH_STORAGE_KEYS = {
	ACCESS_KEY,
	REFRESH_KEY,
	USER_KEY,
	AUTH_EVENT,
} as const;
