import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../types/token", () => ({
	getAccessToken: vi.fn(() => null),
	setAccessToken: vi.fn(),
	setRefreshToken: vi.fn(),
	removeRefreshToken: vi.fn(),
	clearAuthStorage: vi.fn(),
	AUTH_STORAGE_KEYS: { USER_KEY: "auth_user" },
}));

import {
	clearAuthStorage,
	removeRefreshToken,
	setAccessToken,
	setRefreshToken,
} from "../types/token";
import reducer, { logout, setCredentials } from "./authSlice";

const mockedSetAccessToken = setAccessToken as unknown as ReturnType<
	typeof vi.fn
>;
const mockedSetRefreshToken = setRefreshToken as unknown as ReturnType<
	typeof vi.fn
>;
const mockedRemoveRefreshToken = removeRefreshToken as unknown as ReturnType<
	typeof vi.fn
>;
const mockedClearAuthStorage = clearAuthStorage as unknown as ReturnType<
	typeof vi.fn
>;

const validUser = {
	id: 1,
	email: "anna@example.com",
	first_name: "Anna",
	last_name: "Smith",
};

function loggedOutState() {
	return { token: null, user: null, isLoggedIn: false };
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
});

describe("setCredentials", () => {
	it("logs the user in with valid token and user", () => {
		const state = reducer(
			loggedOutState(),
			setCredentials({ token: "abc123", user: validUser as any }),
		);
		expect(state.isLoggedIn).toBe(true);
		expect(state.token).toBe("abc123");
		expect(state.user?.email).toBe("anna@example.com");
	});

	it("trims and lowercases the email", () => {
		const state = reducer(
			loggedOutState(),
			setCredentials({
				token: "abc123",
				user: { ...validUser, email: "  Anna@EXAMPLE.com  " } as any,
			}),
		);
		expect(state.user?.email).toBe("anna@example.com");
	});

	it("accepts camelCase firstName/lastName as fallback", () => {
		const state = reducer(
			loggedOutState(),
			setCredentials({
				token: "abc123",
				user: {
					id: 1,
					email: "a@example.com",
					firstName: "Anna",
					lastName: "Smith",
				} as any,
			}),
		);
		expect(state.user?.first_name).toBe("Anna");
		expect(state.user?.last_name).toBe("Smith");
	});

	it("calls setAccessToken with the trimmed token", () => {
		reducer(
			loggedOutState(),
			setCredentials({ token: "  abc123  ", user: validUser as any }),
		);
		expect(mockedSetAccessToken).toHaveBeenCalledWith("abc123");
	});

	it("calls setRefreshToken when refresh token provided", () => {
		reducer(
			loggedOutState(),
			setCredentials({
				token: "abc123",
				user: validUser as any,
				refresh: "refresh-token",
			}),
		);
		expect(mockedSetRefreshToken).toHaveBeenCalledWith("refresh-token");
		expect(mockedRemoveRefreshToken).not.toHaveBeenCalled();
	});

	it("calls removeRefreshToken when no refresh token provided", () => {
		reducer(
			loggedOutState(),
			setCredentials({ token: "abc123", user: validUser as any }),
		);
		expect(mockedRemoveRefreshToken).toHaveBeenCalled();
	});

	it("resets state and clears storage when user is invalid (missing id)", () => {
		const state = reducer(
			loggedOutState(),
			setCredentials({
				token: "abc123",
				user: { email: "a@example.com" } as any,
			}),
		);
		expect(state.isLoggedIn).toBe(false);
		expect(state.token).toBeNull();
		expect(state.user).toBeNull();
		expect(mockedClearAuthStorage).toHaveBeenCalled();
	});

	it('resets state when email is missing "@"', () => {
		const state = reducer(
			loggedOutState(),
			setCredentials({
				token: "abc123",
				user: { ...validUser, email: "not-an-email" } as any,
			}),
		);
		expect(state.isLoggedIn).toBe(false);
		expect(mockedClearAuthStorage).toHaveBeenCalled();
	});

	it("resets state when token is empty string", () => {
		const state = reducer(
			loggedOutState(),
			setCredentials({ token: "   ", user: validUser as any }),
		);
		expect(state.isLoggedIn).toBe(false);
		expect(state.token).toBeNull();
	});

	it("does not call setAccessToken when payload is invalid", () => {
		reducer(
			loggedOutState(),
			setCredentials({ token: "", user: validUser as any }),
		);
		expect(mockedSetAccessToken).not.toHaveBeenCalled();
	});
});

describe("logout", () => {
	it("resets state to logged out", () => {
		const loggedInState = {
			token: "abc123",
			user: validUser as any,
			isLoggedIn: true,
		};
		const state = reducer(loggedInState, logout());
		expect(state.token).toBeNull();
		expect(state.user).toBeNull();
		expect(state.isLoggedIn).toBe(false);
	});

	it("calls clearAuthStorage", () => {
		reducer(
			{ token: "abc123", user: validUser as any, isLoggedIn: true },
			logout(),
		);
		expect(mockedClearAuthStorage).toHaveBeenCalled();
	});
});
