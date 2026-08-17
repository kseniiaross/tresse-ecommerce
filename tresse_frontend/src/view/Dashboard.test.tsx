import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Dashboard from "./Dashboard";

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

function renderDashboard() {
	return render(
		<MemoryRouter>
			<Dashboard />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	mockedApi.get.mockResolvedValue({
		data: {
			first_name: "",
			last_name: "",
			email: "",
			address_line1: "",
			apartment: "",
			city: "",
			state: "",
			postal_code: "",
			country: "",
		},
	});
});

describe("Dashboard - initial state", () => {
	it("prefills form from localStorage 'user' when no saved profile exists", async () => {
		localStorage.setItem(
			"user",
			JSON.stringify({
				email: "anna@example.com",
				first_name: "Anna",
				last_name: "Smith",
			}),
		);

		renderDashboard();

		expect(await screen.findByDisplayValue("Anna")).toBeInTheDocument();
		expect(screen.getByDisplayValue("Smith")).toBeInTheDocument();
		expect(screen.getByDisplayValue("anna@example.com")).toBeInTheDocument();
	});

	it("prefills form from saved profile in localStorage over defaults", async () => {
		localStorage.setItem(
			"tresse_profile_v1",
			JSON.stringify({
				firstName: "Saved",
				lastName: "Name",
				email: "saved@example.com",
				addressLine1: "123 Main St",
				apartment: "",
				city: "Kyiv",
				state: "",
				postalCode: "01001",
				country: "UA",
			}),
		);

		renderDashboard();

		expect(await screen.findByDisplayValue("Saved")).toBeInTheDocument();
		expect(screen.getByDisplayValue("123 Main St")).toBeInTheDocument();
		expect(screen.getByDisplayValue("Kyiv")).toBeInTheDocument();
	});

	it("merges server profile data into empty local fields without overwriting existing ones", async () => {
		localStorage.setItem(
			"tresse_profile_v1",
			JSON.stringify({
				firstName: "Local",
				lastName: "",
				email: "",
				addressLine1: "",
				apartment: "",
				city: "",
				state: "",
				postalCode: "",
				country: "",
			}),
		);

		mockedApi.get.mockResolvedValue({
			data: {
				first_name: "ServerFirst",
				last_name: "ServerLast",
				email: "server@example.com",
				address_line1: "",
				apartment: "",
				city: "",
				state: "",
				postal_code: "",
				country: "",
			},
		});

		renderDashboard();

		// локальное непустое поле сохраняется, пустые заполняются с сервера
		expect(await screen.findByDisplayValue("Local")).toBeInTheDocument();
		expect(screen.getByDisplayValue("ServerLast")).toBeInTheDocument();
		expect(screen.getByDisplayValue("server@example.com")).toBeInTheDocument();
	});
});

describe("Dashboard - save profile", () => {
	it("saves to localStorage immediately and calls the API", async () => {
		const user = userEvent.setup();
		renderDashboard();

		const firstNameInput = await screen.findByLabelText(/first name/i);
		await user.clear(firstNameInput);
		await user.type(firstNameInput, "Updated");

		await user.click(screen.getByRole("button", { name: /save changes/i }));

		await waitFor(() => {
			expect(mockedApi.put).toHaveBeenCalledWith(
				"/accounts/profile/",
				expect.objectContaining({ first_name: "Updated" }),
			);
		});

		const stored = JSON.parse(
			localStorage.getItem("tresse_profile_v1") || "{}",
		);
		expect(stored.firstName).toBe("Updated");

		expect(await screen.findByText("Saved.")).toBeInTheDocument();
	});

	it("shows a validation error for an invalid email and does not call the API", async () => {
		const user = userEvent.setup();
		renderDashboard();

		const emailInput = await screen.findByLabelText(/email/i);
		await user.clear(emailInput);
		await user.type(emailInput, "not-an-email");

		await user.click(screen.getByRole("button", { name: /save changes/i }));

		expect(
			await screen.findByText("Please enter a valid email address."),
		).toBeInTheDocument();
		expect(mockedApi.put).not.toHaveBeenCalled();
	});

	it("shows a local-save fallback message when the API call fails", async () => {
		mockedApi.put.mockRejectedValueOnce(new Error("network error"));
		const user = userEvent.setup();
		renderDashboard();

		await screen.findByLabelText(/first name/i);
		await user.click(screen.getByRole("button", { name: /save changes/i }));

		expect(
			await screen.findByText("Saved locally. (Server sync failed.)"),
		).toBeInTheDocument();
	});

	it("resets the form to defaults when Reset is clicked", async () => {
		localStorage.setItem(
			"tresse_profile_v1",
			JSON.stringify({
				firstName: "WillBeReset",
				lastName: "",
				email: "",
				addressLine1: "",
				apartment: "",
				city: "",
				state: "",
				postalCode: "",
				country: "",
			}),
		);
		const user = userEvent.setup();
		renderDashboard();

		await screen.findByDisplayValue("WillBeReset");
		await user.click(screen.getByRole("button", { name: /^reset$/i }));

		await waitFor(() => {
			expect(screen.queryByDisplayValue("WillBeReset")).not.toBeInTheDocument();
		});
	});
});

describe("Dashboard - delete account modal", () => {
	it("opens the delete confirmation modal", async () => {
		const user = userEvent.setup();
		renderDashboard();

		await screen.findByLabelText(/first name/i);
		await user.click(screen.getByRole("button", { name: /delete account/i }));

		expect(
			await screen.findByRole("dialog", { name: /are you sure/i }),
		).toBeInTheDocument();
	});

	it("closes the modal when Cancel is clicked", async () => {
		const user = userEvent.setup();
		renderDashboard();

		await screen.findByLabelText(/first name/i);
		await user.click(screen.getByRole("button", { name: /delete account/i }));
		await screen.findByRole("dialog");

		await user.click(screen.getByRole("button", { name: /cancel/i }));

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		});
	});

	it("closes the modal on Escape key press", async () => {
		const user = userEvent.setup();
		renderDashboard();

		await screen.findByLabelText(/first name/i);
		await user.click(screen.getByRole("button", { name: /delete account/i }));
		await screen.findByRole("dialog");

		await user.keyboard("{Escape}");

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		});
	});

	it("deletes the account, clears auth storage, and shows confirmation", async () => {
		mockedApi.post.mockResolvedValueOnce({ data: {} });
		localStorage.setItem("access", "fake-token");
		localStorage.setItem("refresh", "fake-refresh");
		localStorage.setItem("user", JSON.stringify({ email: "a@example.com" }));

		const user = userEvent.setup();
		renderDashboard();

		await screen.findByLabelText(/first name/i);
		await user.click(screen.getByRole("button", { name: /delete account/i }));
		await screen.findByRole("dialog");

		await user.click(screen.getByRole("button", { name: /yes, delete/i }));

		expect(mockedApi.post).toHaveBeenCalledWith("/accounts/delete-account/", {
			confirm: true,
		});

		expect(
			await screen.findByText(/deletion request was submitted/i),
		).toBeInTheDocument();

		expect(localStorage.getItem("access")).toBeNull();
		expect(localStorage.getItem("refresh")).toBeNull();
		expect(localStorage.getItem("user")).toBeNull();
	});

	it("shows an error message when delete fails", async () => {
		mockedApi.post.mockRejectedValueOnce(new Error("server error"));
		const user = userEvent.setup();
		renderDashboard();

		await screen.findByLabelText(/first name/i);
		await user.click(screen.getByRole("button", { name: /delete account/i }));
		await screen.findByRole("dialog");

		await user.click(screen.getByRole("button", { name: /yes, delete/i }));

		expect(
			await screen.findByText("Delete failed. Please try again later."),
		).toBeInTheDocument();
	});
});
