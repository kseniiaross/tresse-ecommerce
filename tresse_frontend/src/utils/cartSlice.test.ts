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

let lineIdCounter = 0;

function makeItem(overrides: Partial<GuestCartItem> = {}): GuestCartItem {
	lineIdCounter += 1;

	return {
		lineId: `line-${lineIdCounter}`,
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
		expect(typeof state.items[0].lineId).toBe("string");
		expect(state.items[0].lineId.length).toBeGreaterThan(0);
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
		expect(state.items[0].lineId).not.toBe(state.items[1].lineId);
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
	it("removes the matching item by lineId", () => {
		const state: GuestCartState = {
			items: [
				makeItem({ lineId: "line-a", id: 1, product_size_id: 10 }),
				makeItem({ lineId: "line-b", id: 2, product_size_id: 20 }),
			],
		};
		const next = reducer(state, removeFromCart({ lineId: "line-a" }));
		expect(next.items).toHaveLength(1);
		expect(next.items[0].id).toBe(2);
	});

	it("does nothing if item not found", () => {
		const state: GuestCartState = {
			items: [makeItem({ lineId: "line-a" })],
		};
		const next = reducer(state, removeFromCart({ lineId: "unknown" }));
		expect(next.items).toHaveLength(1);
	});

	it("removing one of two lines for the same product+size (different measurements) leaves the other untouched", () => {
		const lineA = makeItem({
			lineId: "line-a",
			id: 1,
			product_size_id: 10,
			custom_bust: "90",
			custom_waist: "70",
		});
		const lineB = makeItem({
			lineId: "line-b",
			id: 1,
			product_size_id: 10,
			custom_bust: "95",
			custom_waist: "75",
		});
		const state: GuestCartState = { items: [lineA, lineB] };

		const next = reducer(state, removeFromCart({ lineId: "line-b" }));

		expect(next.items).toHaveLength(1);
		expect(next.items[0]).toEqual(lineA);
	});
});

describe("updateQuantity", () => {
	it("updates quantity of matching item", () => {
		const state: GuestCartState = {
			items: [makeItem({ lineId: "line-a", quantity: 1 })],
		};
		const next = reducer(
			state,
			updateQuantity({ lineId: "line-a", quantity: 5 }),
		);
		expect(next.items[0].quantity).toBe(5);
	});

	it("clamps quantity to maxQty", () => {
		const state: GuestCartState = {
			items: [makeItem({ lineId: "line-a", quantity: 1, maxQty: 3 })],
		};
		const next = reducer(
			state,
			updateQuantity({ lineId: "line-a", quantity: 99 }),
		);
		expect(next.items[0].quantity).toBe(3);
	});

	it("clamps quantity below 1 to 1", () => {
		const state: GuestCartState = {
			items: [makeItem({ lineId: "line-a", quantity: 5 })],
		};
		const next = reducer(
			state,
			updateQuantity({ lineId: "line-a", quantity: -2 }),
		);
		expect(next.items[0].quantity).toBe(1);
	});

	it("does nothing for unknown item", () => {
		const state: GuestCartState = { items: [makeItem({ lineId: "line-a" })] };
		const next = reducer(
			state,
			updateQuantity({ lineId: "unknown", quantity: 5 }),
		);
		expect(next.items[0].quantity).toBe(1);
	});

	it("updating the quantity of one of two lines for the same product+size (different measurements) leaves the other untouched", () => {
		const lineA = makeItem({
			lineId: "line-a",
			id: 1,
			product_size_id: 10,
			quantity: 1,
			custom_bust: "90",
		});
		const lineB = makeItem({
			lineId: "line-b",
			id: 1,
			product_size_id: 10,
			quantity: 1,
			custom_bust: "95",
		});
		const state: GuestCartState = { items: [lineA, lineB] };

		const next = reducer(
			state,
			updateQuantity({ lineId: "line-b", quantity: 4 }),
		);

		const [nextA, nextB] = next.items;
		expect(nextA.quantity).toBe(1);
		expect(nextB.quantity).toBe(4);
	});
});

describe("updateCustomMeasurements", () => {
	it("updates measurement fields on matching item", () => {
		const state: GuestCartState = { items: [makeItem({ lineId: "line-a" })] };
		const next = reducer(
			state,
			updateCustomMeasurements({
				lineId: "line-a",
				custom_bust: "90",
				custom_waist: "70",
			}),
		);
		expect(next.items[0].custom_bust).toBe("90");
		expect(next.items[0].custom_waist).toBe("70");
		expect(next.items[0].custom_hips).toBe("");
	});

	it("updating the measurements of one of two lines for the same product+size leaves the other untouched", () => {
		const lineA = makeItem({
			lineId: "line-a",
			id: 1,
			product_size_id: 10,
			custom_bust: "90",
			custom_waist: "70",
		});
		const lineB = makeItem({
			lineId: "line-b",
			id: 1,
			product_size_id: 10,
			custom_bust: "95",
			custom_waist: "75",
		});
		const state: GuestCartState = { items: [lineA, lineB] };

		const next = reducer(
			state,
			updateCustomMeasurements({
				lineId: "line-b",
				custom_bust: "100",
				custom_waist: "80",
			}),
		);

		const [nextA, nextB] = next.items;
		expect(nextA.custom_bust).toBe("90");
		expect(nextA.custom_waist).toBe("70");
		expect(nextB.custom_bust).toBe("100");
		expect(nextB.custom_waist).toBe("80");
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
		const state: GuestCartState = {
			items: [makeItem({ lineId: "line-a", quantity: 5 })],
		};
		const next = reducer(state, setItemMaxQty({ lineId: "line-a", maxQty: 2 }));
		expect(next.items[0].maxQty).toBe(2);
		expect(next.items[0].quantity).toBe(2);
	});

	it("ignores invalid maxQty (0 or negative)", () => {
		const state: GuestCartState = {
			items: [makeItem({ lineId: "line-a", quantity: 3 })],
		};
		const next = reducer(state, setItemMaxQty({ lineId: "line-a", maxQty: 0 }));
		expect(next.items[0].maxQty).toBeUndefined();
		expect(next.items[0].quantity).toBe(3);
	});
});

describe("loading a cart saved before lineId existed", () => {
	it("assigns a lineId to a stored line that lacks one", async () => {
		localStorage.setItem(
			"guest_cart",
			JSON.stringify({
				items: [
					{
						id: 1,
						name: "Sweater",
						price: "50",
						product_size_id: 10,
						quantity: 1,
					},
				],
			}),
		);

		vi.resetModules();
		const fresh = await import("./cartSlice");
		const state = fresh.default(undefined, { type: "@@INIT" });

		expect(state.items).toHaveLength(1);
		expect(typeof state.items[0].lineId).toBe("string");
		expect(state.items[0].lineId.length).toBeGreaterThan(0);
	});

	it("persists the backfilled lineId to localStorage", async () => {
		localStorage.setItem(
			"guest_cart",
			JSON.stringify({
				items: [
					{
						id: 1,
						name: "Sweater",
						price: "50",
						product_size_id: 10,
						quantity: 1,
					},
				],
			}),
		);

		vi.resetModules();
		await import("./cartSlice");

		const saved = JSON.parse(localStorage.getItem("guest_cart") ?? "{}");
		expect(typeof saved.items[0].lineId).toBe("string");
		expect(saved.items[0].lineId.length).toBeGreaterThan(0);
	});

	it("keeps the existing lineId of a stored line that already has one", async () => {
		localStorage.setItem(
			"guest_cart",
			JSON.stringify({
				items: [
					{
						lineId: "already-there",
						id: 1,
						name: "Sweater",
						price: "50",
						product_size_id: 10,
						quantity: 1,
					},
				],
			}),
		);

		vi.resetModules();
		const fresh = await import("./cartSlice");
		const state = fresh.default(undefined, { type: "@@INIT" });

		expect(state.items[0].lineId).toBe("already-there");
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
