import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import serverCartReducer from "../store/serverCartSlice";
import wishlistReducer from "../store/wishListSlice";
import authReducer from "../utils/authSlice";
import clientCartReducer from "../utils/cartSlice";
import WishList from "./WishList";

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

function makeProduct(overrides: Partial<any> = {}) {
	return {
		id: 1,
		name: "Sweater",
		price: 50,
		available: true,
		in_stock: true,
		main_image_url: null,
		images: [],
		sizes: [{ id: 10, quantity: 5, size: { name: "M" } }],
		variants: [],
		...overrides,
	};
}

function mockWishlistEndpoint(products: any[], count = products.length) {
	mockedApi.get.mockImplementation((url: string) => {
		if (
			typeof url === "string" &&
			url.startsWith("/products/wishlist/count/")
		) {
			return Promise.resolve({ data: { count } });
		}
		if (typeof url === "string" && url.startsWith("/products/wishlist/")) {
			return Promise.resolve({
				data: { count, next: null, previous: null, results: products },
			});
		}
		return Promise.resolve({ data: {} });
	});
}

function renderWishList(initialPath = "/wishlist") {
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
				<WishList />
			</MemoryRouter>
		</Provider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockWishlistEndpoint([]);
});

describe("WishList - loading and empty states", () => {
	it("shows a loading status while fetching", async () => {
		mockedApi.get.mockImplementation(() => new Promise(() => {}));

		renderWishList();

		expect(await screen.findByText("Loading…")).toBeInTheDocument();
	});

	it("shows an empty state when there are no items in the wishlist", async () => {
		mockWishlistEndpoint([]);

		renderWishList();

		expect(
			await screen.findByText("No items in wishlist."),
		).toBeInTheDocument();
	});

	it("shows an empty state when the wishlist fetch fails", async () => {
		mockedApi.get.mockRejectedValue(new Error("network error"));

		renderWishList();

		expect(
			await screen.findByText("No items in wishlist."),
		).toBeInTheDocument();
	});

	it("renders wishlist items with name, price, and a count in the title", async () => {
		mockWishlistEndpoint([makeProduct()]);

		renderWishList();

		expect(await screen.findByText("Sweater")).toBeInTheDocument();
		expect(screen.getByText("$50")).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "MY WISHLIST (1)" }),
		).toBeInTheDocument();
	});
});

describe("WishList - search filter", () => {
	it("filters items by the search input without re-fetching from the server", async () => {
		mockWishlistEndpoint([
			makeProduct({ id: 1, name: "Sweater" }),
			makeProduct({ id: 2, name: "Jacket" }),
		]);
		const user = userEvent.setup();

		renderWishList();

		await screen.findByText("Sweater");
		screen.getByText("Jacket");

		const callCountBeforeSearch = mockedApi.get.mock.calls.length;

		await user.type(
			screen.getByPlaceholderText("Search in wishlist..."),
			"Sweater",
		);

		expect(screen.getByText("Sweater")).toBeInTheDocument();
		expect(screen.queryByText("Jacket")).not.toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "MY WISHLIST (2 • showing 1)" }),
		).toBeInTheDocument();
		expect(mockedApi.get.mock.calls.length).toBe(callCountBeforeSearch);
	});
});

describe("WishList - sorting and price filters", () => {
	it("re-fetches with the new ordering when the sort select changes", async () => {
		mockWishlistEndpoint([makeProduct()]);
		const user = userEvent.setup();

		renderWishList();

		await screen.findByText("Sweater");
		await user.selectOptions(screen.getByLabelText("Sort wishlist"), "price");

		await waitFor(() => {
			expect(mockedApi.get).toHaveBeenCalledWith(
				"/products/wishlist/",
				expect.objectContaining({
					params: expect.objectContaining({ ordering: "price" }),
				}),
			);
		});
	});

	it("re-fetches with min/max price params when the price inputs change", async () => {
		mockWishlistEndpoint([makeProduct()]);
		const user = userEvent.setup();

		renderWishList();

		await screen.findByText("Sweater");
		await user.type(screen.getByLabelText("Minimum price"), "10");
		await user.type(screen.getByLabelText("Maximum price"), "100");

		await waitFor(() => {
			expect(mockedApi.get).toHaveBeenCalledWith(
				"/products/wishlist/",
				expect.objectContaining({
					params: expect.objectContaining({ min_price: 10, max_price: 100 }),
				}),
			);
		});
	});
});

describe("WishList - removing items", () => {
	it("removes an item from the grid and refreshes the wishlist count", async () => {
		mockWishlistEndpoint([makeProduct({ id: 1, name: "Sweater" })]);
		mockedApi.delete.mockResolvedValueOnce({ data: {} });
		const user = userEvent.setup();

		renderWishList();

		await screen.findByText("Sweater");
		await user.click(
			screen.getByRole("button", { name: "Remove from wishlist" }),
		);

		await waitFor(() => {
			expect(mockedApi.delete).toHaveBeenCalledWith("/products/1/wishlist/");
		});
		expect(screen.queryByText("Sweater")).not.toBeInTheDocument();
		expect(
			await screen.findByText("No items in wishlist."),
		).toBeInTheDocument();

		await waitFor(() => {
			expect(mockedApi.get).toHaveBeenCalledWith("/products/wishlist/count/");
		});
	});
});

describe("WishList - navigation", () => {
	it("navigates to the product detail page when the image is clicked", async () => {
		mockWishlistEndpoint([makeProduct({ id: 1, name: "Sweater" })]);
		const user = userEvent.setup();

		renderWishList();

		await screen.findByText("Sweater");
		await user.click(
			screen.getByRole("button", { name: "Open product: Sweater" }),
		);

		expect(mockNavigate).toHaveBeenCalledWith("/product/1");
	});
});

describe("WishList - add to cart modal", () => {
	it("opens the product modal when ADD TO CART is clicked", async () => {
		mockWishlistEndpoint([makeProduct()]);
		const user = userEvent.setup();

		renderWishList();

		await screen.findByText("Sweater");
		await user.click(screen.getByRole("button", { name: "ADD TO CART" }));

		expect(
			await screen.findByRole("dialog", { name: "Product options" }),
		).toBeInTheDocument();
	});

	it("adds the selected size to the guest cart and closes the modal", async () => {
		mockWishlistEndpoint([makeProduct()]);
		const user = userEvent.setup();

		renderWishList();

		await screen.findByText("Sweater");
		await user.click(screen.getByRole("button", { name: "ADD TO CART" }));

		const dialog = await screen.findByRole("dialog", {
			name: "Product options",
		});
		await user.click(within(dialog).getByRole("button", { name: "M" }));
		await user.click(
			within(dialog).getByRole("button", { name: "ADD TO CART" }),
		);

		await waitFor(() => {
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		});
	});
});
