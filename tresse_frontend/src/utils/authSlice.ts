import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AuthState } from "../types/auth";
import {
	AUTH_STORAGE_KEYS,
	clearAuthStorage,
	getAccessToken,
	removeRefreshToken,
	setAccessToken,
	setRefreshToken,
} from "../types/token";
import type { User } from "../types/user";

const isBrowser =
	typeof window !== "undefined" && typeof localStorage !== "undefined";

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

function toPositiveInt(v: unknown): number | null {
	const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
	if (!Number.isFinite(n)) return null;
	const i = Math.trunc(n);
	return i > 0 ? i : null;
}

function normalizeUser(input: unknown): User | null {
	if (!isRecord(input)) return null;

	const id = toPositiveInt(input.id);
	const email = input.email;

	if (id === null) return null;
	if (typeof email !== "string") return null;

	const safeEmail = email.trim().toLowerCase();
	if (!safeEmail.includes("@")) return null;

	const first =
		typeof input.first_name === "string"
			? input.first_name
			: typeof input.firstName === "string"
				? input.firstName
				: "";

	const last =
		typeof input.last_name === "string"
			? input.last_name
			: typeof input.lastName === "string"
				? input.lastName
				: "";

	return {
		id,
		email: safeEmail,
		first_name: first,
		last_name: last,
	};
}

/**
 * We keep user parsing here because it's UI/Redux state related,
 * but all token storage is delegated to token utils (single source of truth).
 */
function readStoredUser(): User | null {
	if (!isBrowser) return null;

	try {
		const raw = localStorage.getItem(AUTH_STORAGE_KEYS.USER_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		return normalizeUser(parsed);
	} catch {
		return null;
	}
}

function writeStoredUser(user: User): void {
	if (!isBrowser) return;
	try {
		localStorage.setItem(AUTH_STORAGE_KEYS.USER_KEY, JSON.stringify(user));
	} catch {}
}

const initialToken = getAccessToken();
const initialUser = readStoredUser();

const initialState: AuthState = {
	token: initialToken,
	user: initialUser,
	isLoggedIn: Boolean(initialToken && initialUser),
};

const authSlice = createSlice({
	name: "auth",
	initialState,
	reducers: {
		setCredentials: (
			state,
			action: PayloadAction<{ token: string; user: User; refresh?: string }>,
		) => {
			const { token, user, refresh } = action.payload;

			const safeUser = normalizeUser(user);
			const safeToken = typeof token === "string" ? token.trim() : "";
			const safeRefresh = typeof refresh === "string" ? refresh.trim() : "";

			// invalid payload => hard reset
			if (!safeUser || !safeToken) {
				state.token = null;
				state.user = null;
				state.isLoggedIn = false;

				clearAuthStorage();
				return;
			}

			// Redux state
			state.token = safeToken;
			state.user = safeUser;
			state.isLoggedIn = true;

			// Token storage (single source of truth)
			setAccessToken(safeToken);

			if (safeRefresh) {
				setRefreshToken(safeRefresh);
			} else {
				removeRefreshToken();
			}

			// User storage (UI)
			writeStoredUser(safeUser);

			// Cleanup legacy keys
			if (isBrowser) {
				localStorage.removeItem("token");
				localStorage.removeItem("access_token");
			}
		},

		logout: (state) => {
			state.token = null;
			state.user = null;
			state.isLoggedIn = false;

			clearAuthStorage();
		},
	},
});

export const { setCredentials, logout } = authSlice.actions;
export default authSlice.reducer;
