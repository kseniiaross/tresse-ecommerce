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
import Order from "./Order";

vi.mock("../api/axiosInstance", () => ({
	default: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

vi.mock("../types/token", () => ({
	getAccessToken: vi.fn(() => "fake-token"),
	setAccessToken: vi.fn(),
	setRefreshToken: vi.fn(),
	removeRefreshToken: vi.fn(),
	clearAuthStorage: vi.fn(),
	AUTH_STORAGE_KEYS: { USER_KEY: "auth_user" },
}));

import api from "../api/axiosInstance";

const mockedApi = api as unknown as {
	get: ReturnType<typeof vi.fn>;
	post: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
};

function makeServerItem(overrides: Partial<any> = {}) {
	return {
		id: 1,
		quantity: 1,
		custom_length_selected: false,
		custom_length_cm: null,
		custom_length_surcharge: 0,
		product_size: {
			size: { name: "M" },
			product: {
				id: 1,
				name: "Sweater",
				price: "50.00",
				main_image_url: null,
			},
		},
		...overrides,
	};
}

function mockCartEndpoint(items: any[], hasPaidOrder = false) {
	mockedApi.get.mockImplementation((url: string) => {
		if (url === "/orders/my-orders/") {
			return Promise.resolve({
				data: hasPaidOrder ? [{ status: "paid" }] : [],
			});
		}
		return Promise.resolve({ data: { id: 1, items } });
	});
}

function renderOrder(preloadedState: any) {
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
			<MemoryRouter>
				<Order />
			</MemoryRouter>
		</Provider>,
	);
}

let clipboardWriteTextMock: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	vi.clearAllMocks();
	mockCartEndpoint([]);

	Object.defineProperty(window, "location", {
		value: { assign: vi.fn() },
		writable: true,
	});

	if (!navigator.clipboard) {
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: async () => {} },
			configurable: true,
		});
	}

	clipboardWriteTextMock = vi
		.spyOn(navigator.clipboard, "writeText")
		.mockResolvedValue(undefined as any);
});

describe("Order - empty cart", () => {
	it("shows empty cart message and disables checkout button", async () => {
		renderOrder({
			serverCart: { cart: { id: 1, items: [] }, loading: false, error: null },
		});

		expect(await screen.findByText("Your cart is empty")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /continue to payment/i }),
		).toBeDisabled();
	});
});

describe("Order - subtotal calculation", () => {
	it("calculates subtotal for a single item", async () => {
		const items = [makeServerItem({ quantity: 2 })];
		mockCartEndpoint(items);

		renderOrder({
			serverCart: { cart: { id: 1, items }, loading: false, error: null },
		});

		expect(await screen.findByText("$100.00")).toBeInTheDocument();
	});

	it("includes custom length surcharge in subtotal", async () => {
		const items = [
			makeServerItem({
				custom_length_selected: true,
				custom_length_surcharge: 15,
			}),
		];
		mockCartEndpoint(items);

		renderOrder({
			serverCart: { cart: { id: 1, items }, loading: false, error: null },
		});

		await screen.findByText("Sweater");
		await waitFor(() => {
			expect(screen.getAllByText("$65.00").length).toBeGreaterThanOrEqual(2);
		});
	});
});

describe("Order - welcome promo", () => {
	it("shows promo code when this is the customer's first order", async () => {
		const items = [makeServerItem()];
		mockCartEndpoint(items, false);

		renderOrder({
			serverCart: { cart: { id: 1, items }, loading: false, error: null },
		});

		expect(await screen.findByText("TRESSE15")).toBeInTheDocument();
	});

	it("hides promo code when customer already has a paid order", async () => {
		const items = [makeServerItem()];
		mockCartEndpoint(items, true);

		renderOrder({
			serverCart: { cart: { id: 1, items }, loading: false, error: null },
		});

		await screen.findByText("Sweater");
		expect(screen.queryByText("TRESSE15")).not.toBeInTheDocument();
	});

	it("copies promo code to clipboard when clicked", async () => {
		const items = [makeServerItem()];
		mockCartEndpoint(items, false);
		const user = userEvent.setup();

		clipboardWriteTextMock = vi
			.spyOn(navigator.clipboard, "writeText")
			.mockResolvedValue(undefined as any);

		renderOrder({
			serverCart: { cart: { id: 1, items }, loading: false, error: null },
		});

		await waitFor(() => screen.getByText("TRESSE15"));
		await user.click(screen.getByText("TRESSE15"));

		expect(clipboardWriteTextMock).toHaveBeenCalledWith("TRESSE15");
		expect(await screen.findByText("Copied")).toBeInTheDocument();
	});
});

describe("Order - checkout consent gating", () => {
	it("shows checkout disabled when policy not accepted", async () => {
		const items = [makeServerItem()];
		mockCartEndpoint(items);

		renderOrder({
			serverCart: { cart: { id: 1, items }, loading: false, error: null },
		});

		await screen.findByText("Sweater");

		const checkoutButton = screen.getByRole("button", {
			name: /continue to payment/i,
		});
		expect(checkoutButton).toBeDisabled();
		expect(mockedApi.post).not.toHaveBeenCalled();
	});

	it("enables checkout button once policy checkbox is accepted (no custom items)", async () => {
		const items = [makeServerItem()];
		mockCartEndpoint(items);
		const user = userEvent.setup();

		renderOrder({
			serverCart: { cart: { id: 1, items }, loading: false, error: null },
		});

		await screen.findByText("Sweater");

		const policyCheckbox = screen.getByLabelText(/return policy/i);
		await user.click(policyCheckbox);

		expect(
			screen.getByRole("button", { name: /continue to payment/i }),
		).not.toBeDisabled();
	});

	it("requires the final-sale checkbox for custom-size items even after policy is accepted", async () => {
		const items = [
			makeServerItem({
				product_size: {
					size: { name: "CUSTOM SIZE" },
					product: { id: 1, name: "Sweater", price: "50.00" },
				},
			}),
		];
		mockCartEndpoint(items);
		const user = userEvent.setup();

		renderOrder({
			serverCart: { cart: { id: 1, items }, loading: false, error: null },
		});

		await screen.findByText("Sweater");

		const policyCheckbox = screen.getByLabelText(/return policy/i);
		await user.click(policyCheckbox);

		expect(
			screen.getByRole("button", { name: /continue to payment/i }),
		).toBeDisabled();

		const finalSaleCheckbox = screen.getByLabelText(/final sale/i);
		await user.click(finalSaleCheckbox);

		expect(
			screen.getByRole("button", { name: /continue to payment/i }),
		).not.toBeDisabled();
	});
});

describe("Order - checkout submission", () => {
	it("redirects to Stripe checkout URL on success", async () => {
		const items = [makeServerItem()];
		mockCartEndpoint(items);
		mockedApi.post.mockResolvedValueOnce({
			data: { url: "https://checkout.stripe.com/session/abc" },
		});
		const user = userEvent.setup();

		renderOrder({
			serverCart: { cart: { id: 1, items }, loading: false, error: null },
		});

		await screen.findByText("Sweater");
		await user.click(screen.getByLabelText(/return policy/i));
		await user.click(
			screen.getByRole("button", { name: /continue to payment/i }),
		);

		await waitFor(() => {
			expect(window.location.assign).toHaveBeenCalledWith(
				"https://checkout.stripe.com/session/abc",
			);
		});

		expect(mockedApi.post).toHaveBeenCalledWith(
			"/orders/create-checkout-session/",
			expect.objectContaining({ policy_accepted: true }),
		);
	});

	it("shows server error message when checkout session creation fails", async () => {
		const items = [makeServerItem()];
		mockCartEndpoint(items);
		const err = {
			response: { data: { detail: "Not enough stock for Sweater." } },
		};
		mockedApi.post.mockRejectedValueOnce(err);
		const user = userEvent.setup();

		renderOrder({
			serverCart: { cart: { id: 1, items }, loading: false, error: null },
		});

		await screen.findByText("Sweater");
		await user.click(screen.getByLabelText(/return policy/i));
		await user.click(
			screen.getByRole("button", { name: /continue to payment/i }),
		);

		expect(
			await screen.findByText("Not enough stock for Sweater."),
		).toBeInTheDocument();
		expect(window.location.assign).not.toHaveBeenCalled();
	});

	it("shows generic error message when server response has no detail", async () => {
		const items = [makeServerItem()];
		mockCartEndpoint(items);
		mockedApi.post.mockRejectedValueOnce(new Error("network down"));
		const user = userEvent.setup();

		renderOrder({
			serverCart: { cart: { id: 1, items }, loading: false, error: null },
		});

		await screen.findByText("Sweater");
		await user.click(screen.getByLabelText(/return policy/i));
		await user.click(
			screen.getByRole("button", { name: /continue to payment/i }),
		);

		expect(
			await screen.findByText(
				"Checkout could not be prepared. Please try again.",
			),
		).toBeInTheDocument();
	});
});
