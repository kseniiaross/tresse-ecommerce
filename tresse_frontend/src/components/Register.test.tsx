import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import serverCartReducer from "../store/serverCartSlice";
import wishlistReducer from "../store/wishListSlice";
import authReducer from "../utils/authSlice";
import clientCartReducer from "../utils/cartSlice";
import Register from "./Register";

vi.mock("../api/auth", () => ({
	registerUser: vi.fn(),
}));

vi.mock("../api/axiosInstance", () => ({
	default: {
		get: vi.fn().mockResolvedValue({ data: { id: 1, items: [] } }),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

vi.mock("../types/token", () => ({
	getAccessToken: vi.fn(() => null),
	setAccessToken: vi.fn(),
	setRefreshToken: vi.fn(),
	removeRefreshToken: vi.fn(),
	clearAuthStorage: vi.fn(),
	AUTH_STORAGE_KEYS: { USER_KEY: "auth_user" },
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

import { registerUser } from "../api/auth";

const mockedRegisterUser = registerUser as unknown as ReturnType<typeof vi.fn>;

function renderRegister(initialPath = "/register") {
	const store = configureStore({
		reducer: {
			auth: authReducer,
			serverCart: serverCartReducer,
			wishlist: wishlistReducer,
			cart: clientCartReducer,
		},
	});

	return render(
		<Provider store={store}>
			<MemoryRouter initialEntries={[initialPath]}>
				<Register />
			</MemoryRouter>
		</Provider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
});

describe("Register form validation", () => {
	it("shows required-field errors when submitting an empty form", async () => {
		const user = userEvent.setup();
		renderRegister();

		await user.click(screen.getByRole("button", { name: /register/i }));

		expect(
			await screen.findByText("First name is required"),
		).toBeInTheDocument();
		expect(screen.getByText("Last name is required")).toBeInTheDocument();
		expect(screen.getByText("Enter a valid phone number")).toBeInTheDocument();
		expect(screen.getByText("Email is required")).toBeInTheDocument();
		expect(screen.getByText("Password is required")).toBeInTheDocument();

		expect(mockedRegisterUser).not.toHaveBeenCalled();
	});

	it("shows an invalid-email error for a malformed email", async () => {
		const user = userEvent.setup();
		renderRegister();

		await user.type(screen.getByLabelText(/email/i), "not-an-email");
		await user.click(screen.getByRole("button", { name: /register/i }));

		expect(await screen.findByText("Invalid email")).toBeInTheDocument();
	});

	it("shows a min-length error for a short password", async () => {
		const user = userEvent.setup();
		renderRegister();

		await user.type(screen.getByLabelText(/password/i), "short");
		await user.click(screen.getByRole("button", { name: /register/i }));

		expect(
			await screen.findByText("Password must be at least 8 characters"),
		).toBeInTheDocument();
	});

	it("shows an invalid phone number error for a malformed phone", async () => {
		const user = userEvent.setup();
		renderRegister();

		await user.type(screen.getByLabelText(/phone number/i), "abc");
		await user.click(screen.getByRole("button", { name: /register/i }));

		expect(
			await screen.findByText("Enter a valid phone number"),
		).toBeInTheDocument();
	});
});

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
	await user.type(screen.getByLabelText(/first name/i), "Anna");
	await user.type(screen.getByLabelText(/last name/i), "Smith");
	await user.type(screen.getByLabelText(/phone number/i), "+1 234 567 8901");
	await user.type(screen.getByLabelText(/email/i), "anna@example.com");
	await user.type(screen.getByLabelText(/password/i), "StrongPass123");
}

describe("Register submission", () => {
	it("navigates to /authorization when server does not return a user", async () => {
		mockedRegisterUser.mockResolvedValueOnce({ access: "token123" });
		const user = userEvent.setup();
		renderRegister();

		await fillValidForm(user);
		await user.click(screen.getByRole("button", { name: /register/i }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith(
				expect.stringContaining("/authorization?next="),
				{ replace: true },
			);
		});
	});

	it("navigates to / on full success with user and token", async () => {
		mockedRegisterUser.mockResolvedValueOnce({
			access: "token123",
			refresh: "refresh123",
			user: {
				id: 1,
				email: "anna@example.com",
				first_name: "Anna",
				last_name: "Smith",
			},
		});
		const user = userEvent.setup();
		renderRegister();

		await fillValidForm(user);
		await user.click(screen.getByRole("button", { name: /register/i }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
		});
	});

	it('redirects to a safe "next" path after successful registration', async () => {
		mockedRegisterUser.mockResolvedValueOnce({
			access: "token123",
			user: {
				id: 1,
				email: "anna@example.com",
				first_name: "Anna",
				last_name: "Smith",
			},
		});
		const user = userEvent.setup();
		renderRegister("/register?next=/checkout");

		await fillValidForm(user);
		await user.click(screen.getByRole("button", { name: /register/i }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith("/checkout", { replace: true });
		});
	});

	it('ignores an unsafe "next" path (open redirect protection)', async () => {
		mockedRegisterUser.mockResolvedValueOnce({
			access: "token123",
			user: {
				id: 1,
				email: "anna@example.com",
				first_name: "Anna",
				last_name: "Smith",
			},
		});
		const user = userEvent.setup();
		renderRegister("/register?next=//evil.com");

		await fillValidForm(user);
		await user.click(screen.getByRole("button", { name: /register/i }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
		});
	});

	it("shows the specific server error message when registration fails", async () => {
		mockedRegisterUser.mockRejectedValueOnce(
			new Error("User with this email already exists."),
		);

		const user = userEvent.setup();
		renderRegister();

		await fillValidForm(user);
		await user.click(screen.getByRole("button", { name: /register/i }));

		expect(
			await screen.findByText("User with this email already exists."),
		).toBeInTheDocument();
		expect(mockNavigate).not.toHaveBeenCalled();
	});
});
