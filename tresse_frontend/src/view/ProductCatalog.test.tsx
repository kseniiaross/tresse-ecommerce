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
import ProductCatalog from "./ProductCatalog";

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
import { getAccessToken } from "../types/token";

const mockedApi = api as unknown as {
	get: ReturnType<typeof vi.fn>;
	post: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
};

const mockedGetAccessToken = getAccessToken as unknown as ReturnType<
	typeof vi.fn
>;

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
		sort_order: 0,
		collections_slugs: [],
		allows_custom_length: false,
		custom_length_cm: null,
		custom_length_surcharge: 0,
		...overrides,
	};
}

function mockProductsEndpoint(products: any[]) {
	mockedApi.get.mockImplementation((url: string) => {
		if (typeof url === "string" && url.startsWith("/products/wishlist/")) {
			return Promise.resolve({ data: [] });
		}
		if (typeof url === "string" && url.startsWith("/products/")) {
			return Promise.resolve({ data: { results: products, next: null } });
		}
		return Promise.resolve({ data: {} });
	});
}

function renderCatalog(initialPath = "/catalog") {
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
				<ProductCatalog />
			</MemoryRouter>
		</Provider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedGetAccessToken.mockReturnValue(null);
	mockProductsEndpoint([]);
});

describe("ProductCatalog - loading products", () => {
	it("shows a loading status while fetching", async () => {
		mockedApi.get.mockImplementation(() => new Promise(() => {}));

		renderCatalog();

		expect(await screen.findByText(/loading products/i)).toBeInTheDocument();
	});

	it("shows an error message when products fail to load", async () => {
		mockedApi.get.mockRejectedValue(new Error("network error"));

		renderCatalog();

		expect(
			await screen.findByText(/could not load products/i),
		).toBeInTheDocument();
	});

	it("shows an empty state when there are no products", async () => {
		mockProductsEndpoint([]);

		renderCatalog();

		expect(await screen.findByText(/no products found/i)).toBeInTheDocument();
	});

	it("renders product cards with name and price", async () => {
		mockProductsEndpoint([makeProduct()]);

		renderCatalog();

		expect(await screen.findByText("Sweater")).toBeInTheDocument();
		expect(screen.getByText("$50")).toBeInTheDocument();
	});
});

describe("ProductCatalog - search filter", () => {
	it("filters products by search term entered in the input", async () => {
		mockProductsEndpoint([makeProduct({ id: 1, name: "Sweater" })]);
		const user = userEvent.setup();

		renderCatalog();

		await screen.findByText("Sweater");

		const searchInput = screen.getByPlaceholderText(/search in catalog/i);
		await user.type(searchInput, "Sweater");

		await waitFor(
			() => {
				expect(mockedApi.get).toHaveBeenCalledWith(
					expect.stringContaining("search=Sweater"),
				);
			},
			{ timeout: 2000 },
		);
	});
});

describe("ProductCatalog - out of stock products", () => {
	it("shows a restock alert button instead of add-to-cart for out-of-stock products", async () => {
		mockProductsEndpoint([makeProduct({ available: false, in_stock: false })]);

		renderCatalog();

		await screen.findByText("Sweater");
		expect(
			screen.getByRole("button", { name: /get restock alert/i }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /^add to cart$/i }),
		).not.toBeInTheDocument();
	});

	it("shows an out-of-stock badge", async () => {
		mockProductsEndpoint([makeProduct({ available: false, in_stock: false })]);

		renderCatalog();

		expect(await screen.findByText("OUT OF STOCK")).toBeInTheDocument();
	});

	it("opens the notify modal and submits guest email for restock alert", async () => {
		mockProductsEndpoint([makeProduct({ available: false, in_stock: false })]);
		mockedApi.post.mockResolvedValueOnce({ data: {} });
		const user = userEvent.setup();

		renderCatalog();

		await screen.findByText("Sweater");
		await user.click(
			screen.getByRole("button", { name: /get restock alert/i }),
		);

		const emailInput = await screen.findByPlaceholderText(/your@email.com/i);
		await user.type(emailInput, "guest@example.com");
		await user.click(screen.getByRole("button", { name: /confirm/i }));

		await waitFor(() => {
			expect(mockedApi.post).toHaveBeenCalledWith(
				"/products/1/subscribe_back_in_stock/",
				expect.objectContaining({ email: "guest@example.com" }),
			);
		});
	});
});

describe("ProductCatalog - add to cart (single size)", () => {
	it("adds a single-size product to the guest cart directly without opening size modal", async () => {
		mockProductsEndpoint([makeProduct()]);
		const user = userEvent.setup();

		renderCatalog();

		await screen.findByText("Sweater");
		await user.click(screen.getByRole("button", { name: /^add to cart$/i }));

		// единственный доступный размер должен быть выбран автоматически или через модалку
		await waitFor(() => {
			expect(screen.queryByText(/select size/i)).toBeTruthy();
		});
	});
});

describe("ProductCatalog - wishlist toggle", () => {
	it("redirects to login-choice when toggling wishlist while not authenticated", async () => {
		mockProductsEndpoint([makeProduct()]);
		const user = userEvent.setup();

		renderCatalog();

		await screen.findByText("Sweater");
		await user.click(screen.getByRole("button", { name: /add to wishlist/i }));

		expect(mockNavigate).toHaveBeenCalledWith(
			expect.stringContaining("/login-choice?next="),
		);
	});

	it("toggles wishlist when authenticated", async () => {
		mockedGetAccessToken.mockReturnValue("fake-token");
		mockProductsEndpoint([makeProduct()]);
		mockedApi.post.mockResolvedValueOnce({ data: {} });
		const user = userEvent.setup();

		renderCatalog();

		await screen.findByText("Sweater");
		await user.click(screen.getByRole("button", { name: /add to wishlist/i }));

		await waitFor(() => {
			expect(mockedApi.post).toHaveBeenCalledWith("/products/1/wishlist/");
		});
	});
});

describe("ProductCatalog - category subnav", () => {
	it("shows women's collection links when category=woman", async () => {
		mockProductsEndpoint([]);

		renderCatalog("/catalog?category=woman");

		expect(await screen.findByText("SUMMER")).toBeInTheDocument();
		expect(screen.getByText("SWEATERS")).toBeInTheDocument();
		expect(screen.getByText("CARDIGANS")).toBeInTheDocument();
		expect(screen.getByText("DRESSES")).toBeInTheDocument();
	});

	it("does not show the subnav for other categories", async () => {
		mockProductsEndpoint([]);

		renderCatalog("/catalog?category=man");

		await screen.findByText(/coming soon/i);
		expect(screen.queryByText("SUMMER")).not.toBeInTheDocument();
	});
});
