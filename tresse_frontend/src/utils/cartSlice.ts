import {
	createSelector,
	createSlice,
	type PayloadAction,
} from "@reduxjs/toolkit";

import type { Product } from "../types/product";

export type CustomMeasurements = {
	custom_bust?: string;
	custom_underbust?: string;
	custom_waist?: string;
	custom_hips?: string;
	custom_height?: string;
	custom_cup?: string;
	custom_fit_notes?: string;
};

export type CustomLengthFields = {
	custom_length_selected?: boolean;
	custom_length_cm?: number | null;
	custom_length_surcharge?: number | null;
};

export type GuestCartItem = Product &
	CustomMeasurements &
	CustomLengthFields & {
		lineId: string;
		quantity: number;
		product_size_id: number;
		sizeName?: string;
		maxQty?: number;
	};

export type ClientCartItem = GuestCartItem;

export type GuestCartState = {
	items: GuestCartItem[];
};

type AddToCartPayload = CustomMeasurements &
	CustomLengthFields & {
		product: Product;
		product_size_id: number;
		sizeName?: string;
		maxQty?: number;
	};

const isBrowser =
	typeof window !== "undefined" && typeof localStorage !== "undefined";

const LS_KEY = "guest_cart";

// Stable per-line identifier, distinct from product id + size id so two
// lines for the same product/size with different custom measurements or
// length don't collide.
function createLineId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}

	return `line_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Assigns a lineId to any item that predates this field (carts saved
// before this change). Returns whether anything changed.
function backfillLineIds(state: GuestCartState): boolean {
	let changed = false;

	state.items = state.items.map((item) => {
		if (item.lineId) {
			return item;
		}

		changed = true;

		return { ...item, lineId: createLineId() };
	});

	return changed;
}

function loadFromLS(): GuestCartState | null {
	if (!isBrowser) {
		return null;
	}

	try {
		const raw = localStorage.getItem(LS_KEY);

		if (!raw) {
			return null;
		}

		const parsed: unknown = JSON.parse(raw);

		if (parsed && typeof parsed === "object") {
			const rec = parsed as Record<string, unknown>;

			if (Array.isArray(rec.items)) {
				const state = parsed as GuestCartState;

				if (backfillLineIds(state)) {
					saveToLS(state);
				}

				return state;
			}
		}
	} catch {
		// Ignore invalid storage.
	}

	return null;
}

function saveToLS(state: GuestCartState) {
	if (!isBrowser) {
		return;
	}

	try {
		localStorage.setItem(LS_KEY, JSON.stringify(state));
	} catch {
		// Ignore unavailable storage.
	}
}

const initialState: GuestCartState = loadFromLS() ?? {
	items: [],
};

const toSafeInt = (n: unknown, fallback = 1) => {
	const v = typeof n === "number" ? n : Number(n);

	if (!Number.isFinite(v)) {
		return fallback;
	}

	return Math.trunc(v);
};

const normalizeMax = (maxQty?: number) => {
	if (typeof maxQty !== "number") {
		return undefined;
	}

	if (!Number.isFinite(maxQty)) {
		return undefined;
	}

	const v = Math.trunc(maxQty);

	return v >= 1 ? v : undefined;
};

const clampToMax = (qty: number, maxQty?: number) => {
	const safe = Math.max(1, toSafeInt(qty, 1));

	const max = normalizeMax(maxQty);

	return typeof max === "number" ? Math.min(safe, max) : safe;
};

const resolveMaxQty = (existingMax?: number, incomingMax?: number) => {
	const existing = normalizeMax(existingMax);

	if (typeof existing === "number") {
		return existing;
	}

	const incoming = normalizeMax(incomingMax);

	if (typeof incoming === "number") {
		return incoming;
	}

	return undefined;
};

const toMoney = (value: unknown): number => {
	const number = typeof value === "number" ? value : Number(value);

	return Number.isFinite(number) ? number : 0;
};

const sameMeasurements = (a: GuestCartItem, b: AddToCartPayload) => {
	return (
		(a.custom_bust ?? "") === (b.custom_bust ?? "") &&
		(a.custom_underbust ?? "") === (b.custom_underbust ?? "") &&
		(a.custom_waist ?? "") === (b.custom_waist ?? "") &&
		(a.custom_hips ?? "") === (b.custom_hips ?? "") &&
		(a.custom_height ?? "") === (b.custom_height ?? "") &&
		(a.custom_cup ?? "") === (b.custom_cup ?? "") &&
		(a.custom_fit_notes ?? "") === (b.custom_fit_notes ?? "")
	);
};

const sameCustomLength = (a: GuestCartItem, b: AddToCartPayload) => {
	const aSelected = a.custom_length_selected === true;

	const bSelected = b.custom_length_selected === true;

	if (aSelected !== bSelected) {
		return false;
	}

	if (!aSelected) {
		return true;
	}

	return (
		toMoney(a.custom_length_cm) === toMoney(b.custom_length_cm) &&
		toMoney(a.custom_length_surcharge) === toMoney(b.custom_length_surcharge)
	);
};

const cartSlice = createSlice({
	name: "cart",

	initialState,

	reducers: {
		addToCart: (state, action: PayloadAction<AddToCartPayload>) => {
			const { product, product_size_id, sizeName, maxQty } = action.payload;

			const existingItem = state.items.find(
				(item) =>
					item.id === product.id &&
					item.product_size_id === product_size_id &&
					sameMeasurements(item, action.payload) &&
					sameCustomLength(item, action.payload),
			);

			if (existingItem) {
				const limit = resolveMaxQty(existingItem.maxQty, maxQty);

				existingItem.quantity = clampToMax(existingItem.quantity + 1, limit);

				if (typeof existingItem.maxQty !== "number") {
					const normalizedIncoming = normalizeMax(maxQty);

					if (typeof normalizedIncoming === "number") {
						existingItem.maxQty = normalizedIncoming;
					}
				}
			} else {
				const limit = resolveMaxQty(undefined, maxQty);

				const customLengthSelected =
					action.payload.custom_length_selected === true;

				state.items.push({
					...product,

					lineId: createLineId(),

					product_size_id,

					sizeName,

					maxQty: limit,

					quantity: clampToMax(1, limit),

					custom_length_selected: customLengthSelected,

					custom_length_cm: customLengthSelected
						? (action.payload.custom_length_cm ?? null)
						: null,

					custom_length_surcharge: customLengthSelected
						? (action.payload.custom_length_surcharge ?? 0)
						: 0,

					custom_bust: action.payload.custom_bust ?? "",

					custom_underbust: action.payload.custom_underbust ?? "",

					custom_waist: action.payload.custom_waist ?? "",

					custom_hips: action.payload.custom_hips ?? "",

					custom_height: action.payload.custom_height ?? "",

					custom_cup: action.payload.custom_cup ?? "",

					custom_fit_notes: action.payload.custom_fit_notes ?? "",
				});
			}

			saveToLS(state);
		},

		removeFromCart: (
			state,
			action: PayloadAction<{
				lineId: string;
			}>,
		) => {
			state.items = state.items.filter(
				(item) => item.lineId !== action.payload.lineId,
			);

			saveToLS(state);
		},

		updateQuantity: (
			state,
			action: PayloadAction<{
				lineId: string;
				quantity: number;
			}>,
		) => {
			const item = state.items.find(
				(current) => current.lineId === action.payload.lineId,
			);

			if (!item) {
				return;
			}

			item.quantity = clampToMax(action.payload.quantity, item.maxQty);

			saveToLS(state);
		},

		updateCustomMeasurements: (
			state,
			action: PayloadAction<
				CustomMeasurements & {
					lineId: string;
				}
			>,
		) => {
			const item = state.items.find(
				(current) => current.lineId === action.payload.lineId,
			);

			if (!item) {
				return;
			}

			item.custom_bust = action.payload.custom_bust ?? "";

			item.custom_underbust = action.payload.custom_underbust ?? "";

			item.custom_waist = action.payload.custom_waist ?? "";

			item.custom_hips = action.payload.custom_hips ?? "";

			item.custom_height = action.payload.custom_height ?? "";

			item.custom_cup = action.payload.custom_cup ?? "";

			item.custom_fit_notes = action.payload.custom_fit_notes ?? "";

			saveToLS(state);
		},

		clearCart: (state) => {
			state.items = [];

			saveToLS(state);
		},

		setItemMaxQty: (
			state,
			action: PayloadAction<{
				lineId: string;
				maxQty: number;
			}>,
		) => {
			const item = state.items.find(
				(current) => current.lineId === action.payload.lineId,
			);

			if (!item) {
				return;
			}

			item.maxQty = normalizeMax(action.payload.maxQty);

			item.quantity = clampToMax(item.quantity, item.maxQty);

			saveToLS(state);
		},
	},
});

export const {
	addToCart,
	removeFromCart,
	updateQuantity,
	updateCustomMeasurements,
	clearCart,
	setItemMaxQty,
} = cartSlice.actions;

export default cartSlice.reducer;

type HasGuestCart = {
	cart: GuestCartState;
};

export const selectGuestCartItems = (state: HasGuestCart) => {
	return state.cart.items;
};

export const selectGuestCartCount = createSelector(
	[selectGuestCartItems],

	(items) =>
		items.reduce(
			(total, item) => total + item.quantity,

			0,
		),
);

export const selectGuestCartTotal = createSelector(
	[selectGuestCartItems],

	(items) =>
		items.reduce(
			(sum, item) => {
				const basePrice = toMoney(item.price);

				const surcharge =
					item.custom_length_selected === true
						? toMoney(item.custom_length_surcharge)
						: 0;

				return sum + (basePrice + surcharge) * item.quantity;
			},

			0,
		),
);
