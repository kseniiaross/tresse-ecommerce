import { isAxiosError } from "axios";
import type {
	LoginRequest,
	RegisterRequest,
	ResponseData,
} from "../types/auth";
import api from "./axiosInstance";

const FIELDS_TO_CHECK = [
	"email",
	"password",
	"current_password",
	"new_password",
	"confirm_password",
] as const;

function getErrorMessage(error: unknown, fallback: string): string {
	if (!isAxiosError(error)) return fallback;

	const data = error.response?.data;

	if (typeof data === "object" && data !== null) {
		const record = data as Record<string, unknown>;

		// DRF: detail might be string OR string[]
		const detail = record.detail;
		if (typeof detail === "string" && detail.trim()) {
			return detail.trim();
		}
		if (
			Array.isArray(detail) &&
			typeof detail[0] === "string" &&
			detail[0].trim()
		) {
			return detail[0].trim();
		}

		const nonField = record.non_field_errors;
		if (
			Array.isArray(nonField) &&
			typeof nonField[0] === "string" &&
			nonField[0].trim()
		) {
			return nonField[0].trim();
		}

		for (const key of FIELDS_TO_CHECK) {
			const value = record[key];

			if (typeof value === "string" && value.trim()) {
				return value.trim();
			}

			if (
				Array.isArray(value) &&
				typeof value[0] === "string" &&
				value[0].trim()
			) {
				return value[0].trim();
			}
		}
	}

	if (typeof error.message === "string" && error.message.trim()) {
		return error.message.trim();
	}

	return fallback;
}

// -------------------- AUTH --------------------

export async function loginUser(data: LoginRequest): Promise<ResponseData> {
	try {
		const response = await api.post<ResponseData>("/accounts/token/", {
			email: data.email,
			password: data.password,
		});
		return response.data;
	} catch (error: unknown) {
		throw new Error(getErrorMessage(error, "Login failed"));
	}
}

export async function registerUser(
	data: RegisterRequest,
): Promise<ResponseData> {
	try {
		const response = await api.post<ResponseData>("/accounts/register/", data);
		return response.data;
	} catch (error: unknown) {
		throw new Error(getErrorMessage(error, "Registration failed"));
	}
}

// -------------------- ACCOUNT RESTORE --------------------

/**
 * Request account restore email (generic response, no user existence leak)
 * Backend: POST /api/accounts/restore/request/
 */
export async function requestAccountRestore(
	email: string,
): Promise<{ message: string }> {
	try {
		const response = await api.post<{ message: string }>(
			"/accounts/restore/request/",
			{
				email: email.trim().toLowerCase(),
			},
		);
		return response.data;
	} catch (error: unknown) {
		throw new Error(getErrorMessage(error, "Restore request failed"));
	}
}

/**
 * Confirm account restore (activate + optionally set new password)
 * Backend: POST /api/accounts/restore/confirm/
 */
export async function confirmAccountRestore(params: {
	uidb64: string;
	token: string;
	new_password: string;
}): Promise<{ message: string }> {
	try {
		const response = await api.post<{ message: string }>(
			"/accounts/restore/confirm/",
			{
				uidb64: params.uidb64,
				token: params.token,
				new_password: params.new_password,
			},
		);
		return response.data;
	} catch (error: unknown) {
		throw new Error(getErrorMessage(error, "Restore confirmation failed"));
	}
}
