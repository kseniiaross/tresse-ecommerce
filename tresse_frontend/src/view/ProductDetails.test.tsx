import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import serverCartReducer from "../store/serverCartSlice";
import wishlistReducer from "../store/wishListSlice";
import authReducer from "../utils/authSlice";
import clientCartReducer from "../utils/cartSlice";
import ProductDetails from "./ProductDetails";

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
	isAuthenticated: vi.fn(() => false),
	setAccessToken: vi.fn(),
	setRefreshToken: vi.fn(),
	removeRefreshToken: vi.fn(),
	clearAuthStorage: vi.fn(),
	AUTH_STORAGE_KEYS: { USER_KEY: "auth_user" },
}));

vi.mock("../utils/metaPixel", () => ({ trackMeta: vi.fn() }));
vi.mock("../utils/tiktokPixel", () => ({ trackTikTok: vi.fn() }));

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
import { isAuthenticated } from "../types/token";

const mockedApi = api as unknown as {
	get: ReturnType<typeof vi.fn>;
	post: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
};

const mockedIsAuthenticated = isAuthenticated as unknown as ReturnType<
	typeof vi.fn
>;

function makeProduct(overrides: Partial<any> = {}) {
	return {
		id: 1,
		name: "Sweater",
		price: 50,
		available: true,
		in_stock: true,
		description: "A cozy sweater.",
		care_instructions: "",
		main_image_url: null,
		images: [],
		sizes: [
			{ id: 10, quantity: 5, size: { name: "M" } },
			{ id: 11, quantity: 0, size: { name: "L" } },
		],
		variants: [],
		is_in_wishlist: false,
		allows_custom_length: false,
		custom_length_cm: null,
		custom_length_surcharge: 0,
		category: null,
		...overrides,
	};
}

function renderProductDetails(productId = "1") {
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
			<MemoryRouter initialEntries={[`/product/${productId}`]}>
				<Routes>
					<Route path="/product/:id" element={<ProductDetails />} />
				</Routes>
			</MemoryRouter>
		</Provider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedIsAuthenticated.mockReturnValue(false);
});

describe("ProductDetails - loading and error states", () => {
	it("shows an error message for an invalid product id", async () => {
		renderProductDetails("not-a-number");

		expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
		expect(screen.getByText("Invalid product id.")).toBeInTheDocument();
	});

	it("shows an error message when the product fails to load", async () => {
		mockedApi.get.mockRejectedValueOnce(new Error("network error"));

		renderProductDetails();

		expect(
			await screen.findByText("Could not load product details."),
		).toBeInTheDocument();
	});
});

describe("ProductDetails - product display", () => {
	it("renders product name, price, and description", async () => {
		mockedApi.get.mockResolvedValueOnce({ data: makeProduct() });

		renderProductDetails();

		expect(await screen.findByText("Sweater")).toBeInTheDocument();
		expect(screen.getByText("$50")).toBeInTheDocument();
		expect(screen.getByText("A cozy sweater.")).toBeInTheDocument();
	});

	it("shows an out-of-stock badge when the product is unavailable", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: makeProduct({ available: false }),
		});

		renderProductDetails();

		expect(await screen.findByText("Out of stock")).toBeInTheDocument();
	});

	it("sorts sizes according to the defined size order", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: makeProduct({
				sizes: [
					{ id: 1, quantity: 5, size: { name: "L" } },
					{ id: 2, quantity: 5, size: { name: "XS" } },
					{ id: 3, quantity: 5, size: { name: "M" } },
				],
			}),
		});

		renderProductDetails();

		await screen.findByText("Sweater");
		const options = screen.getAllByRole("option");
		expect(options.map((el) => el.textContent)).toEqual(["XS", "M", "L"]);
	});

	it("disables out-of-stock sizes", async () => {
		mockedApi.get.mockResolvedValueOnce({ data: makeProduct() });

		renderProductDetails();

		await screen.findByText("Sweater");
		const lOption = screen.getByRole("option", { name: "L" });
		expect(lOption).toBeDisabled();
	});

	it("toggles care instructions visibility", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: makeProduct({ care_instructions: "Hand wash only." }),
		});
		const user = userEvent.setup();

		renderProductDetails();

		await screen.findByText("Sweater");
		expect(screen.queryByText("Hand wash only.")).not.toBeInTheDocument();

		await user.click(screen.getByText("Care Instructions"));
		expect(screen.getByText("Hand wash only.")).toBeInTheDocument();
	});
});

describe("ProductDetails - add to cart", () => {
	it("shows a message asking to select a size when none is chosen", async () => {
		mockedApi.get.mockResolvedValueOnce({ data: makeProduct() });
		const user = userEvent.setup();

		renderProductDetails();

		await screen.findByText("Sweater");
		await user.click(screen.getByRole("button", { name: /^add to cart$/i }));

		expect(
			await screen.findByText("Please select a size."),
		).toBeInTheDocument();
	});

	it("adds to guest cart when a size is selected and user is not authenticated", async () => {
		mockedApi.get.mockResolvedValueOnce({ data: makeProduct() });
		const user = userEvent.setup();

		renderProductDetails();

		await screen.findByText("Sweater");
		await user.click(screen.getByRole("option", { name: "M" }));
		await user.click(screen.getByRole("button", { name: /^add to cart$/i }));

		expect(await screen.findByText("Added to bag.")).toBeInTheDocument();
		expect(mockedApi.post).not.toHaveBeenCalledWith(
			expect.stringContaining("/products/cart/items/"),
		);
	});

	it("adds to server cart when user is authenticated", async () => {
		mockedIsAuthenticated.mockReturnValue(true);
		mockedApi.get.mockImplementation((url: string) => {
			if (url === "/products/1/") {
				return Promise.resolve({ data: makeProduct() });
			}
			return Promise.resolve({ data: { id: 1, items: [] } });
		});
		mockedApi.post.mockResolvedValueOnce({ data: { id: 1 } });
		const user = userEvent.setup();

		renderProductDetails();

		await screen.findByText("Sweater");
		await user.click(screen.getByRole("option", { name: "M" }));
		await user.click(screen.getByRole("button", { name: /^add to cart$/i }));

		await waitFor(() => {
			expect(mockedApi.post).toHaveBeenCalledWith(
				"/products/cart/items/",
				expect.objectContaining({ product_size_id: 10 }),
			);
		});
	});

	it("opens the custom measurements modal for custom-size items", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: makeProduct({
				sizes: [{ id: 20, quantity: 3, size: { name: "CUSTOM SIZE" } }],
			}),
		});
		const user = userEvent.setup();

		renderProductDetails();

		await screen.findByText("Sweater");
		await user.click(screen.getByRole("option", { name: "CUSTOM SIZE" }));
		await user.click(screen.getByRole("button", { name: /^add to cart$/i }));

		expect(await screen.findByText(/custom sizing/i)).toBeInTheDocument();
	});

	it("disables the add-to-cart button when the product is out of stock", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: makeProduct({ available: false, in_stock: false }),
		});

		renderProductDetails();

		await screen.findByText("Sweater");
		expect(
			screen.getByRole("button", { name: /^add to cart$/i }),
		).toBeDisabled();
	});
});

describe("ProductDetails - custom length pricing", () => {
	it("adds custom-length surcharge to the displayed price when selected", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: makeProduct({
				price: 50,
				allows_custom_length: true,
				custom_length_cm: 10,
				custom_length_surcharge: 15,
			}),
		});
		const user = userEvent.setup();

		renderProductDetails();

		await screen.findByText("Sweater");
		expect(screen.getByText("$50")).toBeInTheDocument();

		const checkbox = screen.getByRole("checkbox");
		await user.click(checkbox);

		expect(await screen.findByText("$65")).toBeInTheDocument();
	});
});

describe("ProductDetails - wishlist", () => {
	it("redirects to login-choice when adding to wishlist while not authenticated", async () => {
		mockedApi.get.mockResolvedValueOnce({ data: makeProduct() });
		const user = userEvent.setup();

		renderProductDetails();

		await screen.findByText("Sweater");
		await user.click(screen.getByRole("button", { name: /add to wishlist/i }));

		expect(mockNavigate).toHaveBeenCalledWith(
			expect.stringContaining("/login-choice?next="),
		);
	});

	it("toggles wishlist state when authenticated", async () => {
		mockedIsAuthenticated.mockReturnValue(true);
		mockedApi.get.mockResolvedValueOnce({ data: makeProduct() });
		mockedApi.post.mockResolvedValueOnce({ data: {} });
		const user = userEvent.setup();

		renderProductDetails();

		await screen.findByText("Sweater");
		await user.click(screen.getByRole("button", { name: /add to wishlist/i }));

		expect(mockedApi.post).toHaveBeenCalledWith("/products/1/toggle_wishlist/");
		expect(
			await screen.findByRole("button", { name: /remove from wishlist/i }),
		).toBeInTheDocument();
	});
});

describe("ProductDetails - image modal", () => {
	it("opens the image modal when the main image is clicked", async () => {
		mockedApi.get.mockResolvedValueOnce({ data: makeProduct() });
		const user = userEvent.setup();

		renderProductDetails();

		await screen.findByText("Sweater");
		await user.click(
			screen.getByRole("button", { name: /open larger image/i }),
		);

		expect(await screen.findByRole("dialog")).toBeInTheDocument();
	});

	it("closes the image modal on Escape key press", async () => {
		mockedApi.get.mockResolvedValueOnce({ data: makeProduct() });
		const user = userEvent.setup();

		renderProductDetails();

		await screen.findByText("Sweater");
		await user.click(
			screen.getByRole("button", { name: /open larger image/i }),
		);
		await screen.findByRole("dialog");

		await user.keyboard("{Escape}");

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		});
	});
});
