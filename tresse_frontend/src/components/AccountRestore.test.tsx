import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AccountRestore from "./AccountRestore";

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

function renderAccountRestore(uidb64 = "MTU", token = "valid-token") {
	return render(
		<MemoryRouter initialEntries={[`/account/restore/${uidb64}/${token}`]}>
			<Routes>
				<Route
					path="/account/restore/:uidb64/:token"
					element={<AccountRestore />}
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

describe("AccountRestore - missing link params", () => {
	it("shows an invalid-link message when uidb64 or token is missing from the URL", () => {
		render(
			<MemoryRouter initialEntries={["/account/restore"]}>
				<AccountRestore />
			</MemoryRouter>,
		);

		expect(
			screen.getByText("This restore link is invalid or incomplete."),
		).toBeInTheDocument();
	});
});

describe("AccountRestore - form validation", () => {
	it("shows validation errors when submitting an empty form", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderAccountRestore();

		await user.click(screen.getByRole("button", { name: /restore account/i }));

		expect(
			await screen.findByText("Password must be at least 8 characters"),
		).toBeInTheDocument();
		expect(
			screen.getByText("Please confirm your password"),
		).toBeInTheDocument();
		expect(mockedApi.post).not.toHaveBeenCalled();
	});

	it("shows a min-length error for a short password", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderAccountRestore();

		await user.type(screen.getByLabelText("New Password"), "short");
		await user.click(screen.getByRole("button", { name: /restore account/i }));

		expect(
			await screen.findByText("Password must be at least 8 characters"),
		).toBeInTheDocument();
		expect(mockedApi.post).not.toHaveBeenCalled();
	});

	it("shows a mismatch error when the passwords don't match", async () => {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderAccountRestore();

		await user.type(screen.getByLabelText("New Password"), "NewStrongPass123");
		await user.type(
			screen.getByLabelText("Confirm Password"),
			"SomethingElse123",
		);
		await user.click(screen.getByRole("button", { name: /restore account/i }));

		expect(
			await screen.findByText("Passwords do not match"),
		).toBeInTheDocument();
		expect(mockedApi.post).not.toHaveBeenCalled();
	});
});

describe("AccountRestore - submission", () => {
	it("submits uidb64, token, and new_password to the restore-confirm endpoint", async () => {
		mockedApi.post.mockResolvedValueOnce({ data: {} });
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

		renderAccountRestore("MTU", "valid-token");

		await user.type(screen.getByLabelText("New Password"), "NewStrongPass123");
		await user.type(
			screen.getByLabelText("Confirm Password"),
			"NewStrongPass123",
		);
		await user.click(screen.getByRole("button", { name: /restore account/i }));

		await waitFor(() => {
			expect(mockedApi.post).toHaveBeenCalledWith(
				"/accounts/restore/confirm/",
				{
					uidb64: "MTU",
					token: "valid-token",
					new_password: "NewStrongPass123",
				},
			);
		});
	});

	it("shows a success message and redirects after successful restore", async () => {
		mockedApi.post.mockResolvedValueOnce({ data: {} });
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

		renderAccountRestore();

		await user.type(screen.getByLabelText("New Password"), "NewStrongPass123");
		await user.type(
			screen.getByLabelText("Confirm Password"),
			"NewStrongPass123",
		);
		await user.click(screen.getByRole("button", { name: /restore account/i }));

		expect(
			await screen.findByText("Account restored successfully."),
		).toBeInTheDocument();

		await vi.advanceTimersByTimeAsync(600);

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith(
				"/login-choice?next=%2Fdashboard",
				{ replace: true },
			);
		});
	});

	it("shows a server error message when the token is invalid or expired", async () => {
		mockedApi.post.mockRejectedValueOnce({
			isAxiosError: true,
			response: { data: { detail: "This link is invalid or has expired." } },
		});
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

		renderAccountRestore();

		await user.type(screen.getByLabelText("New Password"), "NewStrongPass123");
		await user.type(
			screen.getByLabelText("Confirm Password"),
			"NewStrongPass123",
		);
		await user.click(screen.getByRole("button", { name: /restore account/i }));

		expect(
			await screen.findByText("This link is invalid or has expired."),
		).toBeInTheDocument();
		expect(mockNavigate).not.toHaveBeenCalled();
	});
});
