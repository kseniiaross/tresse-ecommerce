import { configureStore } from "@reduxjs/toolkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import authReducer from "../utils/authSlice";
import clientCartReducer from "../utils/cartSlice";
import reducer, {
	addCartItem,
	clearServerCart,
	fetchCart,
	mergeGuestCart,
	removeCartItem,
	updateCartItem,
	updateCartItemMeasurements,
} from "./serverCartSlice";
import wishlistReducer from "./wishListSlice";

vi.mock("../api/axiosInstance", () => ({
	default: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

vi.mock("../types/token", () => ({
	getAccessToken: vi.fn(),
}));

import api from "../api/axiosInstance";
import { getAccessToken } from "../types/token";

const mockedApi = api as unknown as {
	get: ReturnType<typeof vi.fn>;
	post: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
};

const mockedGetToken = getAccessToken as unknown as ReturnType<typeof vi.fn>;

function makeStore(preloadedState?: any) {
	return configureStore({
		reducer: {
			auth: authReducer,
			serverCart: reducer,
			wishlist: wishlistReducer,
			cart: clientCartReducer,
		},
		preloadedState: preloadedState as any,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("serverCartSlice reducer", () => {
	it("returns initial state", () => {
		const state = reducer(undefined, { type: "@@INIT" });
		expect(state).toEqual({ cart: null, loading: false, error: null });
	});

	it("clearServerCart empties items but keeps cart shell", () => {
		const state = reducer(
			{
				cart: { id: 1, items: [{ id: 1 }] } as any,
				loading: false,
				error: "x",
			},
			clearServerCart(),
		);
		expect(state.cart?.items).toEqual([]);
		expect(state.error).toBeNull();
	});

	it("clearServerCart on null cart stays null", () => {
		const state = reducer(
			{ cart: null, loading: true, error: null },
			clearServerCart(),
		);
		expect(state.cart).toBeNull();
		expect(state.loading).toBe(false);
	});
});

describe("fetchCart thunk", () => {
	it("returns null without hitting API when no token", async () => {
		mockedGetToken.mockReturnValue(null);
		const store = makeStore();

		await store.dispatch(fetchCart());

		expect(mockedApi.get).not.toHaveBeenCalled();
		expect(store.getState().serverCart.cart).toBeNull();
	});

	it("fetches and stores cart when token exists", async () => {
		mockedGetToken.mockReturnValue("fake-token");
		const cartData = { id: 1, items: [] };
		mockedApi.get.mockResolvedValueOnce({ data: cartData });

		const store = makeStore();
		await store.dispatch(fetchCart());

		expect(mockedApi.get).toHaveBeenCalledWith("/products/cart/");
		expect(store.getState().serverCart.cart).toEqual(cartData);
		expect(store.getState().serverCart.loading).toBe(false);
	});

	it("sets error on rejection", async () => {
		mockedGetToken.mockReturnValue("fake-token");
		mockedApi.get.mockRejectedValueOnce(new Error("network down"));

		const store = makeStore();
		await store.dispatch(fetchCart());

		expect(store.getState().serverCart.error).toContain("network down");
		expect(store.getState().serverCart.loading).toBe(false);
	});
});

describe("addCartItem thunk", () => {
	it("sends correct body and clamps quantity to min 1", async () => {
		mockedApi.post.mockResolvedValueOnce({ data: { id: 5, quantity: 1 } });
		const store = makeStore();

		await store.dispatch(
			addCartItem({ product_size_id: 10, quantity: 0 } as any),
		);

		expect(mockedApi.post).toHaveBeenCalledWith(
			"/products/cart/items/",
			expect.objectContaining({ product_size_id: 10, quantity: 1 }),
		);
	});

	it("falls back to product_size field on 400 response", async () => {
		const badRequestError = {
			response: { status: 400, data: {} },
		};
		mockedApi.post
			.mockRejectedValueOnce(badRequestError)
			.mockResolvedValueOnce({ data: { id: 6 } });

		const store = makeStore();
		await store.dispatch(
			addCartItem({ product_size_id: 10, quantity: 2 } as any),
		);

		expect(mockedApi.post).toHaveBeenCalledTimes(2);
		const secondCallBody = mockedApi.post.mock.calls[1][1];
		expect(secondCallBody).toHaveProperty("product_size", 10);
		expect(secondCallBody).not.toHaveProperty("product_size_id");
	});

	it("does not retry on non-400 errors", async () => {
		const serverError = { response: { status: 500 } };
		mockedApi.post.mockRejectedValueOnce(serverError);

		const store = makeStore();
		const result = await store.dispatch(
			addCartItem({ product_size_id: 10 } as any),
		);

		expect(mockedApi.post).toHaveBeenCalledTimes(1);
		expect(result.type).toBe("serverCart/addItem/rejected");
	});

	it("adds new item to cart items on fulfilled", async () => {
		mockedApi.post.mockResolvedValueOnce({ data: { id: 99, quantity: 1 } });
		const store = makeStore({
			serverCart: { cart: { id: 1, items: [] }, loading: false, error: null },
		});

		await store.dispatch(addCartItem({ product_size_id: 1 } as any));

		expect(store.getState().serverCart.cart?.items).toHaveLength(1);
		expect(store.getState().serverCart.cart?.items[0].id).toBe(99);
	});

	it("replaces existing item with same id instead of duplicating", async () => {
		mockedApi.post.mockResolvedValueOnce({ data: { id: 1, quantity: 5 } });
		const store = makeStore({
			serverCart: {
				cart: { id: 1, items: [{ id: 1, quantity: 2 }] },
				loading: false,
				error: null,
			},
		});

		await store.dispatch(addCartItem({ product_size_id: 1 } as any));

		const items = store.getState().serverCart.cart?.items;
		expect(items).toHaveLength(1);
		expect(items?.[0].quantity).toBe(5);
	});
});

describe("updateCartItem thunk", () => {
	it("clamps quantity below 1 to 1", async () => {
		mockedApi.put.mockResolvedValueOnce({ data: { id: 1, quantity: 1 } });
		const store = makeStore();

		await store.dispatch(updateCartItem({ item_id: 1, quantity: -5 }));

		expect(mockedApi.put).toHaveBeenCalledWith("/products/cart/items/1/", {
			quantity: 1,
		});
	});

	it("updates matching item in state", async () => {
		mockedApi.put.mockResolvedValueOnce({ data: { id: 1, quantity: 7 } });
		const store = makeStore({
			serverCart: {
				cart: { id: 1, items: [{ id: 1, quantity: 2 }] },
				loading: false,
				error: null,
			},
		});

		await store.dispatch(updateCartItem({ item_id: 1, quantity: 7 }));

		expect(store.getState().serverCart.cart?.items[0].quantity).toBe(7);
	});
});

describe("removeCartItem thunk", () => {
	it("removes item from cart by id", async () => {
		mockedApi.delete.mockResolvedValueOnce({});
		const store = makeStore({
			serverCart: {
				cart: {
					id: 1,
					items: [{ id: 1 }, { id: 2 }],
				},
				loading: false,
				error: null,
			},
		});

		await store.dispatch(removeCartItem(1));

		const items = store.getState().serverCart.cart?.items;
		expect(items).toHaveLength(1);
		expect(items?.[0].id).toBe(2);
	});
});

describe("updateCartItemMeasurements thunk", () => {
	it("sends measurements without item_id in body", async () => {
		mockedApi.put.mockResolvedValueOnce({ data: { id: 1 } });
		const store = makeStore();

		await store.dispatch(
			updateCartItemMeasurements({ item_id: 1, custom_bust: "90" }),
		);

		expect(mockedApi.put).toHaveBeenCalledWith("/products/cart/items/1/", {
			custom_bust: "90",
		});
	});
});

function makeGuestItem(overrides: Partial<any> = {}) {
	return {
		id: 1,
		name: "Sweater",
		price: 50,
		product_size_id: 10,
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
		...overrides,
	};
}

describe("mergeGuestCart thunk", () => {
	it("does nothing without token", async () => {
		mockedGetToken.mockReturnValue(null);
		const store = makeStore();

		await store.dispatch(mergeGuestCart());

		expect(mockedApi.post).not.toHaveBeenCalled();
	});

	it("does nothing when guest cart is empty", async () => {
		mockedGetToken.mockReturnValue("fake-token");
		const store = makeStore({ cart: { items: [] } });

		await store.dispatch(mergeGuestCart());

		expect(mockedApi.post).not.toHaveBeenCalled();
	});

	it("posts each guest item and clears guest cart when all succeed", async () => {
		mockedGetToken.mockReturnValue("fake-token");
		mockedApi.post.mockResolvedValue({ data: { id: 1 } });

		const store = makeStore({
			cart: {
				items: [
					makeGuestItem({ id: 1, product_size_id: 10, quantity: 2 }),
					makeGuestItem({ id: 2, product_size_id: 20, quantity: 1 }),
				],
			},
		});

		await store.dispatch(mergeGuestCart());

		expect(mockedApi.post).toHaveBeenCalledTimes(2);
		expect(mockedApi.post).toHaveBeenCalledWith(
			"/products/cart/items/",
			expect.objectContaining({ product_size_id: 10, quantity: 2 }),
		);
		// после успешного merge гостевая корзина должна очиститься
		expect(store.getState().cart.items).toEqual([]);
	});

	it("does not clear guest cart if any request fails", async () => {
		mockedGetToken.mockReturnValue("fake-token");
		mockedApi.post
			.mockResolvedValueOnce({ data: { id: 1 } })
			.mockRejectedValueOnce({ response: { status: 500 } });

		const store = makeStore({
			cart: {
				items: [
					makeGuestItem({ id: 1, product_size_id: 10, quantity: 1 }),
					makeGuestItem({ id: 2, product_size_id: 20, quantity: 1 }),
				],
			},
		});

		await store.dispatch(mergeGuestCart());

		expect(store.getState().cart.items).toHaveLength(2);
	});

	it("forwards custom length fields when merging", async () => {
		mockedGetToken.mockReturnValue("fake-token");
		mockedApi.post.mockResolvedValue({ data: { id: 1 } });

		const store = makeStore({
			cart: {
				items: [
					makeGuestItem({
						id: 1,
						product_size_id: 10,
						custom_length_selected: true,
						custom_length_cm: 120,
						custom_length_surcharge: 15,
					}),
				],
			},
		});

		await store.dispatch(mergeGuestCart());

		expect(mockedApi.post).toHaveBeenCalledWith(
			"/products/cart/items/",
			expect.objectContaining({
				custom_length_selected: true,
			}),
		);
	});
});
