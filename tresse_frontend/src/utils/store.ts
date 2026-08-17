const ACCESS_KEY = "access";
const REFRESH_KEY = "refresh";
const USER_KEY = "user";

const AUTH_EVENT = "tresse:authChanged";

function notifyAuthChanged() {
	window.dispatchEvent(new CustomEvent(AUTH_EVENT));
}

/** Access token */
export function getAccessToken(): string | null {
	return localStorage.getItem(ACCESS_KEY);
}

export function setAccessToken(token: string): void {
	localStorage.setItem(ACCESS_KEY, token);
	notifyAuthChanged();
}

export function removeAccessToken(): void {
	localStorage.removeItem(ACCESS_KEY);
	notifyAuthChanged();
}

/** Refresh token */
export function getRefreshToken(): string | null {
	return localStorage.getItem(REFRESH_KEY);
}

export function setRefreshToken(token: string): void {
	localStorage.setItem(REFRESH_KEY, token);
	notifyAuthChanged();
}

export function removeRefreshToken(): void {
	localStorage.removeItem(REFRESH_KEY);
	notifyAuthChanged();
}

export function isAuthenticated(): boolean {
	return Boolean(getAccessToken());
}

export function clearTokens(): void {
	localStorage.removeItem(ACCESS_KEY);
	localStorage.removeItem(REFRESH_KEY);

	localStorage.removeItem("token");
	localStorage.removeItem("access_token");

	notifyAuthChanged();
}

export function clearAuthStorage(): void {
	clearTokens();
	localStorage.removeItem(USER_KEY);
	notifyAuthChanged();
}
