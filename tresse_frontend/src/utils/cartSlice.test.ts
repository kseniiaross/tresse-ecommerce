import { beforeEach, describe, expect, it, vi } from "vitest";
import reducer, {
	addToCart,
	clearCart,
	type GuestCartItem,
	type GuestCartState,
	removeFromCart,
	selectGuestCartCount,
	selectGuestCartItems,
	selectGuestCartTotal,
	setItemMaxQty,
	updateCustomMeasurements,
	updateQuantity,
} from "./cartSlice";

const baseProduct = { id: 1, name: "Sweater", price: 50 } as any;

function emptyState(): GuestCartState {
	return { items: [] };
}

function makeItem(overrides: Partial<GuestCartItem> = {}): GuestCartItem {
	return {
		id: 1,
		name: "Sweater",
		price: "50",
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
	} as GuestCartItem;
}

beforeEach(() => {
	localStorage.clear();
	vi.restoreAllMocks();
});

describe("addToCart", () => {
	it("adds a new item to an empty cart", () => {
		const state = reducer(
			emptyState(),
			addToCart({ product: baseProduct, product_size_id: 10 }),
		);
		expect(state.items).toHaveLength(1);
		expect(state.items[0].quantity).toBe(1);
		expect(state.items[0].product_size_id).toBe(10);
	});

	it("increments quantity when adding the same product+size+measurements again", () => {
		let state = reducer(
			emptyState(),
			addToCart({ product: baseProduct, product_size_id: 10 }),
		);
		state = reducer(
			state,
			addToCart({ product: baseProduct, product_size_id: 10 }),
		);
		expect(state.items).toHaveLength(1);
		expect(state.items[0].quantity).toBe(2);
	});

	it("treats different product_size_id as a separate line item", () => {
		let state = reducer(
			emptyState(),
			addToCart({ product: baseProduct, product_size_id: 10 }),
		);
		state = reducer(
			state,
			addToCart({ product: baseProduct, product_size_id: 20 }),
		);
		expect(state.items).toHaveLength(2);
	});

	it("treats different custom measurements as a separate line item", () => {
		let state = reducer(
			emptyState(),
			addToCart({
				product: baseProduct,
				product_size_id: 10,
				custom_bust: "90",
			}),
		);
		state = reducer(
			state,
			addToCart({
				product: baseProduct,
				product_size_id: 10,
				custom_bust: "95",
			}),
		);
		expect(state.items).toHaveLength(2);
	});

	it("treats different custom length selection as a separate line item", () => {
		let state = reducer(
			emptyState(),
			addToCart({
				product: baseProduct,
				product_size_id: 10,
				custom_length_selected: false,
			}),
		);
		state = reducer(
			state,
			addToCart({
				product: baseProduct,
				product_size_id: 10,
				custom_length_selected: true,
				custom_length_cm: 120,
				custom_length_surcharge: 15,
			}),
		);
		expect(state.items).toHaveLength(2);
	});

	it("merges items with identical custom length cm and surcharge", () => {
		let state = reducer(
			emptyState(),
			addToCart({
				product: baseProduct,
				product_size_id: 10,
				custom_length_selected: true,
				custom_length_cm: 120,
				custom_length_surcharge: 15,
			}),
		);
		state = reducer(
			state,
			addToCart({
				product: baseProduct,
				product_size_id: 10,
				custom_length_selected: true,
				custom_length_cm: 120,
				custom_length_surcharge: 15,
			}),
		);
		expect(state.items).toHaveLength(1);
		expect(state.items[0].quantity).toBe(2);
	});

	it("respects maxQty when incrementing an existing item", () => {
		let state = reducer(
			emptyState(),
			addToCart({ product: baseProduct, product_size_id: 10, maxQty: 2 }),
		);
		state = reducer(
			state,
			addToCart({ product: baseProduct, product_size_id: 10 }),
		);
		state = reducer(
			state,
			addToCart({ product: baseProduct, product_size_id: 10 }),
		);
		// maxQty=2 всегда должно ограничивать сверху, сколько бы раз ни добавляли
		expect(state.items[0].quantity).toBe(2);
	});

	it("keeps the first known maxQty even if a later add omits it", () => {
		let state = reducer(
			emptyState(),
			addToCart({ product: baseProduct, product_size_id: 10, maxQty: 3 }),
		);
		state = reducer(
			state,
			addToCart({ product: baseProduct, product_size_id: 10 }),
		);
		expect(state.items[0].maxQty).toBe(3);
	});

	it("persists to localStorage after adding", () => {
		const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
		reducer(
			emptyState(),
			addToCart({ product: baseProduct, product_size_id: 10 }),
		);
		expect(setItemSpy).toHaveBeenCalledWith("guest_cart", expect.any(String));
	});
});

describe("removeFromCart", () => {
	it("removes the matching item by id + product_size_id", () => {
		const state: GuestCartState = {
			items: [
				makeItem({ id: 1, product_size_id: 10 }),
				makeItem({ id: 2, product_size_id: 20 }),
			],
		};
		const next = reducer(state, removeFromCart({ id: 1, product_size_id: 10 }));
		expect(next.items).toHaveLength(1);
		expect(next.items[0].id).toBe(2);
	});

	it("does nothing if item not found", () => {
		const state: GuestCartState = {
			items: [makeItem({ id: 1, product_size_id: 10 })],
		};
		const next = reducer(
			state,
			removeFromCart({ id: 99, product_size_id: 99 }),
		);
		expect(next.items).toHaveLength(1);
	});
});

describe("updateQuantity", () => {
	it("updates quantity of matching item", () => {
		const state: GuestCartState = { items: [makeItem({ quantity: 1 })] };
		const next = reducer(
			state,
			updateQuantity({ id: 1, product_size_id: 10, quantity: 5 }),
		);
		expect(next.items[0].quantity).toBe(5);
	});

	it("clamps quantity to maxQty", () => {
		const state: GuestCartState = {
			items: [makeItem({ quantity: 1, maxQty: 3 })],
		};
		const next = reducer(
			state,
			updateQuantity({ id: 1, product_size_id: 10, quantity: 99 }),
		);
		expect(next.items[0].quantity).toBe(3);
	});

	it("clamps quantity below 1 to 1", () => {
		const state: GuestCartState = { items: [makeItem({ quantity: 5 })] };
		const next = reducer(
			state,
			updateQuantity({ id: 1, product_size_id: 10, quantity: -2 }),
		);
		expect(next.items[0].quantity).toBe(1);
	});

	it("does nothing for unknown item", () => {
		const state: GuestCartState = { items: [makeItem()] };
		const next = reducer(
			state,
			updateQuantity({ id: 99, product_size_id: 99, quantity: 5 }),
		);
		expect(next.items[0].quantity).toBe(1);
	});
});

describe("updateCustomMeasurements", () => {
	it("updates measurement fields on matching item", () => {
		const state: GuestCartState = { items: [makeItem()] };
		const next = reducer(
			state,
			updateCustomMeasurements({
				id: 1,
				product_size_id: 10,
				custom_bust: "90",
				custom_waist: "70",
			}),
		);
		expect(next.items[0].custom_bust).toBe("90");
		expect(next.items[0].custom_waist).toBe("70");
		expect(next.items[0].custom_hips).toBe("");
	});
});

describe("clearCart", () => {
	it("empties all items", () => {
		const state: GuestCartState = { items: [makeItem(), makeItem({ id: 2 })] };
		const next = reducer(state, clearCart());
		expect(next.items).toEqual([]);
	});
});

describe("setItemMaxQty", () => {
	it("sets maxQty and clamps current quantity down if needed", () => {
		const state: GuestCartState = { items: [makeItem({ quantity: 5 })] };
		const next = reducer(
			state,
			setItemMaxQty({ id: 1, product_size_id: 10, maxQty: 2 }),
		);
		expect(next.items[0].maxQty).toBe(2);
		expect(next.items[0].quantity).toBe(2);
	});

	it("ignores invalid maxQty (0 or negative)", () => {
		const state: GuestCartState = { items: [makeItem({ quantity: 3 })] };
		const next = reducer(
			state,
			setItemMaxQty({ id: 1, product_size_id: 10, maxQty: 0 }),
		);
		expect(next.items[0].maxQty).toBeUndefined();
		expect(next.items[0].quantity).toBe(3);
	});
});

describe("selectors", () => {
	it("selectGuestCartItems returns items array", () => {
		const items = [makeItem()];
		expect(selectGuestCartItems({ cart: { items } })).toBe(items);
	});

	it("selectGuestCartCount sums quantities", () => {
		const items = [makeItem({ quantity: 2 }), makeItem({ id: 2, quantity: 3 })];
		expect(selectGuestCartCount({ cart: { items } })).toBe(5);
	});

	it("selectGuestCartTotal sums price*quantity without surcharge when custom length not selected", () => {
		const items = [
			makeItem({ price: "50", quantity: 2, custom_length_selected: false }),
		];
		expect(selectGuestCartTotal({ cart: { items } })).toBe(100);
	});

	it("selectGuestCartTotal adds surcharge when custom length selected", () => {
		const items = [
			makeItem({
				price: "50",
				quantity: 2,
				custom_length_selected: true,
				custom_length_surcharge: 15,
			}),
		];
		// (50 + 15) * 2 = 130
		expect(selectGuestCartTotal({ cart: { items } })).toBe(130);
	});
});
