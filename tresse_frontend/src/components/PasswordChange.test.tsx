import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PasswordChange from "./PasswordChange";

vi.mock("../api/axiosInstance", () => ({
	default: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

import api from "../api/axiosInstance";

const mockedApi = api as unknown as {
	get: ReturnType<typeof vi.fn>;
	post: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
	vi.clearAllMocks();
});

function fillAndSubmit(current: string, newPassword: string, confirm: string) {
	const user = userEvent.setup();
	return (async () => {
		if (current) {
			await user.type(screen.getByLabelText("Current Password"), current);
		}
		if (newPassword) {
			await user.type(screen.getByLabelText("New Password"), newPassword);
		}
		if (confirm) {
			await user.type(screen.getByLabelText("Confirm New Password"), confirm);
		}
		await user.click(screen.getByRole("button", { name: /change password/i }));
	})();
}

describe("PasswordChange - rendering", () => {
	it("renders the form fields and submit button", () => {
		render(<PasswordChange />);

		expect(screen.getByLabelText("Current Password")).toBeInTheDocument();
		expect(screen.getByLabelText("New Password")).toBeInTheDocument();
		expect(screen.getByLabelText("Confirm New Password")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Change Password" }),
		).toBeInTheDocument();
	});
});

describe("PasswordChange - validation", () => {
	it("shows a min-length error for a new password under 8 characters", async () => {
		render(<PasswordChange />);

		await fillAndSubmit("oldpass", "short", "short");

		expect(
			await screen.findByText("Password must be at least 8 characters."),
		).toBeInTheDocument();
		expect(mockedApi.post).not.toHaveBeenCalled();
	});

	it("shows a mismatch error when new and confirm passwords differ", async () => {
		render(<PasswordChange />);

		await fillAndSubmit("oldpass", "NewStrongPass123", "SomethingElse123");

		expect(
			await screen.findByText("Passwords do not match."),
		).toBeInTheDocument();
		expect(mockedApi.post).not.toHaveBeenCalled();
	});
});

describe("PasswordChange - submission", () => {
	it("submits current_password, new_password, and confirm_password to the change-password endpoint", async () => {
		mockedApi.post.mockResolvedValueOnce({ data: {} });
		render(<PasswordChange />);

		await fillAndSubmit("oldpass123", "NewStrongPass123", "NewStrongPass123");

		await waitFor(() => {
			expect(mockedApi.post).toHaveBeenCalledWith(
				"/accounts/change-password/",
				{
					current_password: "oldpass123",
					new_password: "NewStrongPass123",
					confirm_password: "NewStrongPass123",
				},
			);
		});
	});

	it("shows a success message and clears the fields after a successful change", async () => {
		mockedApi.post.mockResolvedValueOnce({ data: {} });
		render(<PasswordChange />);

		await fillAndSubmit("oldpass123", "NewStrongPass123", "NewStrongPass123");

		expect(
			await screen.findByText("Password changed successfully."),
		).toBeInTheDocument();

		expect(screen.getByLabelText("Current Password")).toHaveValue("");
		expect(screen.getByLabelText("New Password")).toHaveValue("");
		expect(screen.getByLabelText("Confirm New Password")).toHaveValue("");
	});

	it("shows a server error message when the current password is incorrect", async () => {
		mockedApi.post.mockRejectedValueOnce({
			response: { data: { detail: "Current password is incorrect." } },
		});
		render(<PasswordChange />);

		await fillAndSubmit("wrongpass", "NewStrongPass123", "NewStrongPass123");

		expect(
			await screen.findByText("Current password is incorrect."),
		).toBeInTheDocument();
	});

	it("shows a field-specific error when the API returns one without a detail message", async () => {
		mockedApi.post.mockRejectedValueOnce({
			response: {
				data: { current_password: ["This field is required."] },
			},
		});
		render(<PasswordChange />);

		await fillAndSubmit("oldpass123", "NewStrongPass123", "NewStrongPass123");

		expect(
			await screen.findByText("This field is required."),
		).toBeInTheDocument();
	});
});
