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
import Cart from "./Cart";

vi.mock("../api/axiosInstance", () => ({
	default: {
		get: vi.fn(),
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

import api from "../api/axiosInstance";

const mockedApi = api as unknown as {
	get: ReturnType<typeof vi.fn>;
	post: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
};

function makeGuestItem(overrides: Partial<any> = {}) {
	return {
		id: 1,
		name: "Sweater",
		price: 50,
		product_size_id: 10,
		quantity: 1,
		sizeName: "M",
		maxQty: 5,
		custom_length_selected: false,
		custom_length_cm: null,
		custom_length_surcharge: 0,
		custom_bust: "",
		custom_underbust: "",
		custom_waist: "",
		custom_hips: "",
		custom_height: "",
		custom_cup: "",
		custom_fit_notes: "",
		...overrides,
	};
}

function makeServerItem(overrides: Partial<any> = {}) {
	return {
		id: 1,
		quantity: 1,
		custom_length_selected: false,
		custom_length_cm: null,
		custom_length_surcharge: 0,
		custom_bust: "",
		custom_underbust: "",
		custom_waist: "",
		custom_hips: "",
		custom_height: "",
		custom_cup: "",
		custom_fit_notes: "",
		product_size: {
			id: 10,
			quantity: 5,
			size: { name: "M" },
			product: {
				id: 1,
				name: "Sweater",
				price: 50,
				main_image_url: null,
			},
		},
		...overrides,
	};
}

function renderCart(preloadedState: any, initialPath = "/cart") {
	const store = configureStore({
		reducer: {
			auth: authReducer,
			serverCart: serverCartReducer,
			wishlist: wishlistReducer,
			cart: clientCartReducer,
		},
		preloadedState: preloadedState as any,
	});

	return render(
		<Provider store={store}>
			<MemoryRouter initialEntries={[initialPath]}>
				<Cart />
			</MemoryRouter>
		</Provider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	mockedApi.get.mockResolvedValue({ data: { id: 1, items: [] } });
});

describe("Cart - guest mode (not authenticated)", () => {
	it("shows empty state when guest cart has no items", () => {
		renderCart({ cart: { items: [] } });
		expect(screen.getByText("Your cart is empty.")).toBeInTheDocument();
	});

	it("renders guest cart items with name and price", () => {
		renderCart({ cart: { items: [makeGuestItem()] } });
		expect(screen.getByText("Sweater")).toBeInTheDocument();
		// цена товара + итоговая сумма совпадают при одном товаре
		expect(screen.getAllByText("$50.00").length).toBeGreaterThanOrEqual(2);
	});

	it("calculates total for guest cart including quantity", () => {
		renderCart({
			cart: { items: [makeGuestItem({ quantity: 3, price: 20 })] },
		});
		expect(screen.getByText("$60.00")).toBeInTheDocument();
	});

	it("includes custom length surcharge in total", () => {
		renderCart({
			cart: {
				items: [
					makeGuestItem({
						price: 50,
						quantity: 1,
						custom_length_selected: true,
						custom_length_surcharge: 15,
					}),
				],
			},
		});
		const matches = screen.getAllByText("$65.00");
		expect(matches.length).toBeGreaterThan(0);
	});

	it("redirects to login-choice with next=/order when paying while not authed", async () => {
		const user = userEvent.setup();
		renderCart({ cart: { items: [makeGuestItem()] } });

		await user.click(screen.getByRole("button", { name: /pay/i }));

		expect(mockNavigate).toHaveBeenCalledWith("/login-choice?next=%2Forder");
	});

	it("disables Pay button when custom-size item is missing measurements", () => {
		renderCart({
			cart: {
				items: [makeGuestItem({ sizeName: "CUSTOM SIZE" })],
			},
		});

		expect(screen.getByRole("button", { name: /pay/i })).toBeDisabled();
	});

	it("enables Pay button when custom-size item has all required measurements", () => {
		renderCart({
			cart: {
				items: [
					makeGuestItem({
						sizeName: "CUSTOM SIZE",
						custom_bust: "90",
						custom_underbust: "75",
						custom_waist: "70",
						custom_hips: "95",
					}),
				],
			},
		});

		expect(screen.getByRole("button", { name: /pay/i })).not.toBeDisabled();
	});

	it('shows "Add measurements" label when custom size item lacks measurements', () => {
		renderCart({
			cart: { items: [makeGuestItem({ sizeName: "CUSTOM SIZE" })] },
		});
		expect(screen.getByText("Add measurements")).toBeInTheDocument();
	});

	it("removes a guest item when Remove is clicked", async () => {
		const user = userEvent.setup();
		renderCart({ cart: { items: [makeGuestItem()] } });

		await user.click(screen.getByRole("button", { name: /remove/i }));

		await waitFor(() => {
			expect(screen.getByText("Your cart is empty.")).toBeInTheDocument();
		});
	});

	it("disables decrease-quantity button at quantity 1", () => {
		renderCart({ cart: { items: [makeGuestItem({ quantity: 1 })] } });
		expect(
			screen.getByRole("button", { name: /decrease quantity/i }),
		).toBeDisabled();
	});

	it("disables increase-quantity button at maxQty", () => {
		renderCart({
			cart: { items: [makeGuestItem({ quantity: 5, maxQty: 5 })] },
		});
		expect(
			screen.getByRole("button", { name: /increase quantity/i }),
		).toBeDisabled();
	});
});

describe("Cart - server mode (authenticated)", () => {
	beforeEach(async () => {
		const { getAccessToken } = await import("../types/token");
		(getAccessToken as any).mockReturnValue("fake-token");
		localStorage.setItem("access", "fake-token");
	});

	it("shows empty state when server cart has no items and not loading", async () => {
		mockedApi.get.mockResolvedValue({ data: { id: 1, items: [] } });

		renderCart({
			serverCart: { cart: { id: 1, items: [] }, loading: false, error: null },
			cart: { items: [] },
		});

		// ждём, пока фоновый fetchCart() из useEffect отработает
		expect(await screen.findByText("Your cart is empty.")).toBeInTheDocument();
	});

	it("renders server cart items with product name and price", async () => {
		mockedApi.get.mockResolvedValue({
			data: { id: 1, items: [makeServerItem()] },
		});

		renderCart({
			serverCart: {
				cart: { id: 1, items: [makeServerItem()] },
				loading: false,
				error: null,
			},
			cart: { items: [] },
		});

		expect(await screen.findByText("Sweater")).toBeInTheDocument();
		await waitFor(() => {
			expect(screen.getAllByText("$50.00").length).toBeGreaterThanOrEqual(2);
		});
	});

	it("navigates to /order when paying with all measurements present", async () => {
		mockedApi.get.mockResolvedValue({
			data: { id: 1, items: [makeServerItem()] },
		});

		const user = userEvent.setup();
		renderCart({
			serverCart: {
				cart: { id: 1, items: [makeServerItem()] },
				loading: false,
				error: null,
			},
			cart: { items: [] },
		});

		// дожидаемся, пока фоновые эффекты (fetchCart) отработают, прежде чем кликать
		await screen.findByText("Sweater");

		await user.click(screen.getByRole("button", { name: /pay/i }));

		expect(mockNavigate).toHaveBeenCalledWith("/order");
	});

	it("prefers server cart over guest cart when both are authed and server has items", async () => {
		mockedApi.get.mockResolvedValue({
			data: { id: 1, items: [makeServerItem({ id: 99 })] },
		});

		renderCart({
			serverCart: {
				cart: { id: 1, items: [makeServerItem({ id: 99 })] },
				loading: false,
				error: null,
			},
			cart: { items: [makeGuestItem({ id: 1, name: "GuestOnlyItem" })] },
		});

		expect(await screen.findByText("Sweater")).toBeInTheDocument();
		expect(screen.queryByText("GuestOnlyItem")).not.toBeInTheDocument();
	});
});
