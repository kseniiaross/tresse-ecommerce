import type { User } from "./user";

/**
 * Frontend form shape (UI)
 */
export interface LoginFormData {
	email: string;
	password: string;
}

/**
 * API payload for login.
 * Same as LoginFormData, but kept as a named type for clarity.
 */
export type LoginRequest = LoginFormData;

/**
 * Frontend form shape (UI)
 */
export interface RegisterFormData {
	first_name: string;
	last_name: string;
	phone_number: string;
	email: string;
	password: string;
}

/**
 * API payload for register.
 * Same as RegisterFormData, but kept as a named type for clarity.
 */
export type RegisterRequest = RegisterFormData;

/**
 * API response from backend after login/register.
 * NOTE: access = access token, refresh = refresh token.
 */
export interface ResponseData {
	access: string;
	refresh: string;
	user: User;
}

/**
 * Global auth state in Redux.
 * NOTE: token here means ACCESS token.
 */
export interface AuthState {
	token: string | null; // access token
	user: User | null;
	isLoggedIn: boolean;
}
