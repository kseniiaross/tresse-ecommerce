import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./axiosInstance", () => ({
	default: {
		post: vi.fn(),
	},
}));

import {
	confirmAccountRestore,
	loginUser,
	registerUser,
	requestAccountRestore,
} from "./auth";
import api from "./axiosInstance";

const mockedApi = api as unknown as {
	post: ReturnType<typeof vi.fn>;
};

function makeAxiosError(data: unknown, message = "Request failed") {
	const err = new AxiosError(message);
	err.response = {
		data,
		status: 400,
		statusText: "Bad Request",
		headers: {},
		config: {} as any,
	};
	return err;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("loginUser", () => {
	it("posts email and password and returns data on success", async () => {
		mockedApi.post.mockResolvedValueOnce({ data: { access: "token123" } });

		const result = await loginUser({
			email: "a@example.com",
			password: "pass123",
		});

		expect(mockedApi.post).toHaveBeenCalledWith("/accounts/token/", {
			email: "a@example.com",
			password: "pass123",
		});
		expect(result).toEqual({ access: "token123" });
	});

	it("throws with DRF detail string on failure", async () => {
		mockedApi.post.mockRejectedValueOnce(
			makeAxiosError({ detail: "Invalid credentials" }),
		);

		await expect(
			loginUser({ email: "a@example.com", password: "wrong" }),
		).rejects.toThrow("Invalid credentials");
	});

	it("throws with fallback message for non-axios errors", async () => {
		mockedApi.post.mockRejectedValueOnce(new Error("network error"));

		await expect(
			loginUser({ email: "a@example.com", password: "x" }),
		).rejects.toThrow("Login failed");
	});
});

describe("registerUser", () => {
	it("posts the full payload and returns data on success", async () => {
		const payload = {
			email: "a@example.com",
			password: "pass123",
			phone_number: "123",
			first_name: "A",
			last_name: "B",
		};
		mockedApi.post.mockResolvedValueOnce({ data: { id: 1 } });

		const result = await registerUser(payload as any);

		expect(mockedApi.post).toHaveBeenCalledWith("/accounts/register/", payload);
		expect(result).toEqual({ id: 1 });
	});

	it("throws with field-level error message on failure", async () => {
		mockedApi.post.mockRejectedValueOnce(
			makeAxiosError({ email: ["User with this email already exists."] }),
		);

		await expect(
			registerUser({ email: "dup@example.com" } as any),
		).rejects.toThrow("User with this email already exists.");
	});
});

describe("requestAccountRestore", () => {
	it("normalizes email to lowercase and trimmed", async () => {
		mockedApi.post.mockResolvedValueOnce({ data: { message: "ok" } });

		await requestAccountRestore("  Anna@EXAMPLE.com  ");

		expect(mockedApi.post).toHaveBeenCalledWith("/accounts/restore/request/", {
			email: "anna@example.com",
		});
	});
});

describe("confirmAccountRestore", () => {
	it("posts uidb64, token, and new_password", async () => {
		mockedApi.post.mockResolvedValueOnce({ data: { message: "restored" } });

		const result = await confirmAccountRestore({
			uidb64: "MTU",
			token: "abc-token",
			new_password: "NewPass123",
		});

		expect(mockedApi.post).toHaveBeenCalledWith("/accounts/restore/confirm/", {
			uidb64: "MTU",
			token: "abc-token",
			new_password: "NewPass123",
		});
		expect(result).toEqual({ message: "restored" });
	});

	it("throws restore-specific fallback message on generic failure", async () => {
		mockedApi.post.mockRejectedValueOnce(new AxiosError("boom"));

		await expect(
			confirmAccountRestore({ uidb64: "x", token: "y", new_password: "z" }),
		).rejects.toThrow("boom");
	});
});

describe("getErrorMessage priority order (via loginUser)", () => {
	it("prefers detail string over non_field_errors", async () => {
		mockedApi.post.mockRejectedValueOnce(
			makeAxiosError({
				detail: "Detail message",
				non_field_errors: ["Non field message"],
			}),
		);
		await expect(
			loginUser({ email: "a", password: "b" } as any),
		).rejects.toThrow("Detail message");
	});

	it("prefers detail array first element over field errors", async () => {
		mockedApi.post.mockRejectedValueOnce(
			makeAxiosError({ detail: ["First detail", "Second detail"] }),
		);
		await expect(
			loginUser({ email: "a", password: "b" } as any),
		).rejects.toThrow("First detail");
	});

	it("falls back to non_field_errors when no detail", async () => {
		mockedApi.post.mockRejectedValueOnce(
			makeAxiosError({ non_field_errors: ["Field-less error"] }),
		);
		await expect(
			loginUser({ email: "a", password: "b" } as any),
		).rejects.toThrow("Field-less error");
	});

	it("falls back to a known field error (password) when no detail/non_field_errors", async () => {
		mockedApi.post.mockRejectedValueOnce(
			makeAxiosError({ password: ["This field is required."] }),
		);
		await expect(
			loginUser({ email: "a", password: "b" } as any),
		).rejects.toThrow("This field is required.");
	});

	it("uses provided fallback message when response data and message are empty", async () => {
		const err = makeAxiosError({}, "");
		mockedApi.post.mockRejectedValueOnce(err);
		await expect(
			loginUser({ email: "a", password: "b" } as any),
		).rejects.toThrow("Login failed");
	});
});
