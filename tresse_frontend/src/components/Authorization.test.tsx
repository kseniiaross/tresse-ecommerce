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
import Authorization from "./Authorization";

vi.mock("../api/auth", () => ({
	loginUser: vi.fn(),
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

import { loginUser } from "../api/auth";

const mockedLoginUser = loginUser as unknown as ReturnType<typeof vi.fn>;

function renderAuthorization(initialPath = "/login") {
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
				<Authorization />
			</MemoryRouter>
		</Provider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
});

describe("Authorization form validation", () => {
	it("shows required-field errors when submitting an empty form", async () => {
		const user = userEvent.setup();
		renderAuthorization();

		await user.click(screen.getByRole("button", { name: /log in/i }));

		expect(await screen.findByText("Email is required")).toBeInTheDocument();
		expect(screen.getByText("Password is required")).toBeInTheDocument();

		expect(mockedLoginUser).not.toHaveBeenCalled();
	});

	it("shows an invalid-email error for a malformed email", async () => {
		const user = userEvent.setup();
		renderAuthorization();

		await user.type(screen.getByLabelText(/email/i), "not-an-email");
		await user.type(screen.getByLabelText(/password/i), "somepass");
		await user.click(screen.getByRole("button", { name: /log in/i }));

		expect(await screen.findByText("Invalid email")).toBeInTheDocument();
		expect(mockedLoginUser).not.toHaveBeenCalled();
	});
});

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
	await user.type(screen.getByLabelText(/email/i), "anna@example.com");
	await user.type(screen.getByLabelText(/password/i), "StrongPass123");
}

describe("Authorization submission", () => {
	it("logs in and navigates to / on success", async () => {
		mockedLoginUser.mockResolvedValueOnce({
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
		renderAuthorization();

		await fillValidForm(user);
		await user.click(screen.getByRole("button", { name: /log in/i }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
		});
	});

	it('redirects to a safe "next" path after successful login', async () => {
		mockedLoginUser.mockResolvedValueOnce({
			access: "token123",
			user: {
				id: 1,
				email: "anna@example.com",
				first_name: "Anna",
				last_name: "Smith",
			},
		});
		const user = userEvent.setup();
		renderAuthorization("/login?next=/checkout");

		await fillValidForm(user);
		await user.click(screen.getByRole("button", { name: /log in/i }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith("/checkout", { replace: true });
		});
	});

	it('ignores an unsafe "next" path (open redirect protection)', async () => {
		mockedLoginUser.mockResolvedValueOnce({
			access: "token123",
			user: {
				id: 1,
				email: "anna@example.com",
				first_name: "Anna",
				last_name: "Smith",
			},
		});
		const user = userEvent.setup();
		renderAuthorization("/login?next=//evil.com");

		await fillValidForm(user);
		await user.click(screen.getByRole("button", { name: /log in/i }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
		});
	});

	it("shows generic login-failed message when response is missing access token", async () => {
		mockedLoginUser.mockResolvedValueOnce({
			user: {
				id: 1,
				email: "anna@example.com",
				first_name: "Anna",
				last_name: "Smith",
			},
		});
		const user = userEvent.setup();
		renderAuthorization();

		await fillValidForm(user);
		await user.click(screen.getByRole("button", { name: /log in/i }));

		expect(
			await screen.findByText("Login failed. Please try again."),
		).toBeInTheDocument();
		expect(mockNavigate).not.toHaveBeenCalled();
	});

	it("shows generic login-failed message when response is missing user", async () => {
		mockedLoginUser.mockResolvedValueOnce({ access: "token123" });
		const user = userEvent.setup();
		renderAuthorization();

		await fillValidForm(user);
		await user.click(screen.getByRole("button", { name: /log in/i }));

		expect(
			await screen.findByText("Login failed. Please try again."),
		).toBeInTheDocument();
	});

	it("shows the specific server error message on rejected login", async () => {
		// loginUser() in api/auth.ts always rethrows as a plain Error carrying
		// the extracted server message, so getLoginErrorMessage's fallback
		// (below its isAxiosError branch, which never actually receives an
		// AxiosError here) is what surfaces this text.
		mockedLoginUser.mockRejectedValueOnce(
			new Error("Invalid email or password."),
		);

		const user = userEvent.setup();
		renderAuthorization();

		await fillValidForm(user);
		await user.click(screen.getByRole("button", { name: /log in/i }));

		expect(
			await screen.findByText("Invalid email or password."),
		).toBeInTheDocument();
		expect(mockNavigate).not.toHaveBeenCalled();
	});

	it("continues navigation even if mergeGuestCart fails (non-blocking)", async () => {
		mockedLoginUser.mockResolvedValueOnce({
			access: "token123",
			user: {
				id: 1,
				email: "anna@example.com",
				first_name: "Anna",
				last_name: "Smith",
			},
		});

		const api = (await import("../api/axiosInstance")).default as any;
		api.post.mockRejectedValueOnce(new Error("merge failed"));

		const user = userEvent.setup();
		renderAuthorization();

		await fillValidForm(user);
		await user.click(screen.getByRole("button", { name: /log in/i }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
		});
	});
});
