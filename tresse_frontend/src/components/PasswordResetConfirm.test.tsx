import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PasswordResetConfirm from "./PasswordResetConfirm";

vi.mock("../api/axiosInstance", () => ({
	default: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
	const actual =
		await vi.importActual<typeof import("react-router-dom")>(
			"react-router-dom",
		);
	return {
		...actual,
		useNavigate: () => mockNavigate,
	};
});

import api from "../api/axiosInstance";

const mockedApi = api as unknown as {
	get: ReturnType<typeof vi.fn>;
	post: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
};

function renderPasswordResetConfirm(uidb64 = "MTU", token = "valid-token") {
	return render(
		<MemoryRouter initialEntries={[`/reset-password/${uidb64}/${token}`]}>
			<Routes>
				<Route
					path="/reset-password/:uidb64/:token"
					element={<PasswordResetConfirm />}
				/>
			</Routes>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
	vi.useRealTimers();
});

describe("PasswordResetConfirm - missing link params", () => {
	it("shows an invalid-link message when uidb64 or token is missing from the URL", () => {
		render(
			<MemoryRouter initialEntries={["/reset-password"]}>
				<PasswordResetConfirm />
			</MemoryRouter>,
		);

		expect(
			screen.getByText(
				"Invalid or missing reset link. Please request a new password reset email.",
				{ exact: false },
			),
		).toBeInTheDocument();
	});

	it("disables the form fields and submit button when the link is invalid", () => {
		render(
			<MemoryRouter initialEntries={["/reset-password"]}>
				<PasswordResetConfirm />
			</MemoryRouter>,
		);

		expect(screen.getByLabelText("New Password")).toBeDisabled();
		expect(screen.getByLabelText("Confirm Password")).toBeDisabled();
		expect(
			screen.getByRole("button", { name: "Change Password" }),
		).toBeDisabled();
	});
});

describe("PasswordResetConfirm - validation", () => {
	it("shows a min-length error for a password under 8 characters", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderPasswordResetConfirm();

		await user.type(screen.getByLabelText("New Password"), "short");
		await user.type(screen.getByLabelText("Confirm Password"), "short");
		await user.click(screen.getByRole("button", { name: "Change Password" }));

		expect(
			await screen.findByText("Password must be at least 8 characters."),
		).toBeInTheDocument();
		expect(mockedApi.post).not.toHaveBeenCalled();
	});

	it("shows a mismatch error when the passwords don't match", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderPasswordResetConfirm();

		await user.type(screen.getByLabelText("New Password"), "NewStrongPass123");
		await user.type(
			screen.getByLabelText("Confirm Password"),
			"SomethingElse123",
		);
		await user.click(screen.getByRole("button", { name: "Change Password" }));

		expect(
			await screen.findByText("Passwords do not match."),
		).toBeInTheDocument();
		expect(mockedApi.post).not.toHaveBeenCalled();
	});
});

describe("PasswordResetConfirm - submission", () => {
	it("submits uidb64, token, new_password, and confirm_password to the reset-confirm endpoint", async () => {
		mockedApi.post.mockResolvedValueOnce({ data: {} });
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

		renderPasswordResetConfirm("MTU", "valid-token");

		await user.type(screen.getByLabelText("New Password"), "NewStrongPass123");
		await user.type(
			screen.getByLabelText("Confirm Password"),
			"NewStrongPass123",
		);
		await user.click(screen.getByRole("button", { name: "Change Password" }));

		await waitFor(() => {
			expect(mockedApi.post).toHaveBeenCalledWith(
				"/accounts/reset-password/confirm/",
				{
					uidb64: "MTU",
					token: "valid-token",
					new_password: "NewStrongPass123",
					confirm_password: "NewStrongPass123",
				},
			);
		});
	});

	it("shows a success message and redirects to login-choice after a successful reset", async () => {
		mockedApi.post.mockResolvedValueOnce({ data: {} });
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

		renderPasswordResetConfirm();

		await user.type(screen.getByLabelText("New Password"), "NewStrongPass123");
		await user.type(
			screen.getByLabelText("Confirm Password"),
			"NewStrongPass123",
		);
		await user.click(screen.getByRole("button", { name: "Change Password" }));

		expect(
			await screen.findByText(
				"Password has been reset successfully. Redirecting to login…",
			),
		).toBeInTheDocument();

		await vi.advanceTimersByTimeAsync(900);

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith("/login-choice", {
				replace: true,
			});
		});
	});

	it("shows a server error message when the token is invalid or expired", async () => {
		mockedApi.post.mockRejectedValueOnce({
			response: { data: { detail: "This link is invalid or has expired." } },
		});
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

		renderPasswordResetConfirm();

		await user.type(screen.getByLabelText("New Password"), "NewStrongPass123");
		await user.type(
			screen.getByLabelText("Confirm Password"),
			"NewStrongPass123",
		);
		await user.click(screen.getByRole("button", { name: "Change Password" }));

		expect(
			await screen.findByText("This link is invalid or has expired."),
		).toBeInTheDocument();
		expect(mockNavigate).not.toHaveBeenCalled();
	});
});
