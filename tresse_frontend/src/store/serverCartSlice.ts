import {
	createAsyncThunk,
	createSlice,
	type PayloadAction,
} from "@reduxjs/toolkit";

import api from "../api/axiosInstance";
import type { CartDto, CartItemDto } from "../types/cart";
import { getAccessToken } from "../types/token";
import {
	clearCart as clearGuestCart,
	selectGuestCartItems,
} from "../utils/cartSlice";
import type { RootState } from ".";

type State = {
	cart: CartDto | null;
	loading: boolean;
	error: string | null;
};

type CustomMeasurementsPayload = {
	custom_bust?: string;
	custom_underbust?: string;
	custom_waist?: string;
	custom_hips?: string;
	custom_height?: string;
	custom_cup?: string;
	custom_fit_notes?: string;
};

type CustomLengthPayload = {
	custom_length_selected?: boolean;
	custom_length_cm?: number | string | null;
	custom_length_surcharge?: number | string | null;
};

type AddCartItemPayload = CustomMeasurementsPayload &
	CustomLengthPayload & {
		product_size_id: number;
		quantity?: number;
	};

const initialState: State = {
	cart: null,
	loading: false,
	error: null,
};

const toSafeInt = (n: unknown, fallback = 1) => {
	const v = typeof n === "number" ? n : Number(n);

	if (!Number.isFinite(v)) {
		return fallback;
	}

	return Math.trunc(v);
};

const clampMin1 = (n: unknown) => {
	return Math.max(1, toSafeInt(n, 1));
};

const hasToken = () => {
	const t = getAccessToken();

	return typeof t === "string" && t.trim().length > 0;
};

async function postCartItem(payload: AddCartItemPayload) {
	const qty = clampMin1(payload.quantity ?? 1);

	const body = {
		product_size_id: payload.product_size_id,

		quantity: qty,

		custom_length_selected: payload.custom_length_selected === true,

		custom_bust: payload.custom_bust ?? "",

		custom_underbust: payload.custom_underbust ?? "",

		custom_waist: payload.custom_waist ?? "",

		custom_hips: payload.custom_hips ?? "",

		custom_height: payload.custom_height ?? "",

		custom_cup: payload.custom_cup ?? "",

		custom_fit_notes: payload.custom_fit_notes ?? "",
	};

	try {
		const { data } = await api.post<CartItemDto>("/products/cart/items/", body);

		return data;
	} catch (err: unknown) {
		const maybeAxios = err as {
			response?: {
				status?: number;
				data?: unknown;
			};
		};

		const status = maybeAxios?.response?.status;

		if (status !== 400) {
			throw err;
		}

		const { product_size_id, ...rest } = body;

		const { data } = await api.post<CartItemDto>("/products/cart/items/", {
			...rest,
			product_size: product_size_id,
		});

		return data;
	}
}

export const fetchCart = createAsyncThunk<CartDto | null>(
	"serverCart/fetch",
	async () => {
		if (!hasToken()) {
			return null;
		}

		const { data } = await api.get<CartDto>("/products/cart/");

		return data;
	},
);

export const mergeGuestCart = createAsyncThunk<
	void,
	void,
	{
		state: RootState;
	}
>(
	"serverCart/mergeGuestCart",

	async (_, { getState, dispatch }) => {
		if (!hasToken()) {
			return;
		}

		const guestItems = selectGuestCartItems(getState());

		if (!guestItems.length) {
			return;
		}

		const requests = guestItems.map((it) =>
			postCartItem({
				product_size_id: it.product_size_id,

				quantity: it.quantity,

				custom_length_selected: it.custom_length_selected,

				custom_length_cm: it.custom_length_cm,

				custom_length_surcharge: it.custom_length_surcharge,

				custom_bust: it.custom_bust,

				custom_underbust: it.custom_underbust,

				custom_waist: it.custom_waist,

				custom_hips: it.custom_hips,

				custom_height: it.custom_height,

				custom_cup: it.custom_cup,

				custom_fit_notes: it.custom_fit_notes,
			}),
		);

		const results = await Promise.allSettled(requests);

		const allOk = results.every((result) => result.status === "fulfilled");

		if (allOk) {
			dispatch(clearGuestCart());
		} else {
			console.warn("mergeGuestCart: some requests failed", results);
		}
	},
);

export const addCartItem = createAsyncThunk<CartItemDto, AddCartItemPayload>(
	"serverCart/addItem",

	async (payload) => {
		return await postCartItem(payload);
	},
);

export const updateCartItem = createAsyncThunk<
	CartItemDto,
	{
		item_id: number;
		quantity: number;
	}
>(
	"serverCart/updateItem",

	async ({ item_id, quantity }) => {
		const safeQty = clampMin1(quantity);

		const { data } = await api.put<CartItemDto>(
			`/products/cart/items/${item_id}/`,
			{
				quantity: safeQty,
			},
		);

		return data;
	},
);

export const updateCartItemMeasurements = createAsyncThunk<
	CartItemDto,
	CustomMeasurementsPayload & {
		item_id: number;
	}
>(
	"serverCart/updateItemMeasurements",

	async ({ item_id, ...measurements }) => {
		const { data } = await api.put<CartItemDto>(
			`/products/cart/items/${item_id}/`,
			{
				...measurements,
			},
		);

		return data;
	},
);

export const removeCartItem = createAsyncThunk<number, number>(
	"serverCart/removeItem",

	async (item_id) => {
		await api.delete(`/products/cart/items/${item_id}/`);

		return item_id;
	},
);

const slice = createSlice({
	name: "serverCart",

	initialState,

	reducers: {
		clearServerCart(state) {
			state.cart = state.cart
				? {
						...state.cart,
						items: [],
					}
				: null;

			state.error = null;
			state.loading = false;
		},
	},

	extraReducers: (builder) => {
		builder
			.addCase(fetchCart.pending, (state) => {
				state.loading = true;
				state.error = null;
			})

			.addCase(fetchCart.fulfilled, (state, action) => {
				state.loading = false;
				state.cart = action.payload;
			})

			.addCase(fetchCart.rejected, (state, action) => {
				state.loading = false;

				state.error = String(action.error.message || "Failed");
			})

			.addCase(addCartItem.fulfilled, (state, action) => {
				if (!state.cart) {
					return;
				}

				const idx = state.cart.items.findIndex(
					(item) => item.id === action.payload.id,
				);

				if (idx >= 0) {
					state.cart.items[idx] = action.payload;
				} else {
					state.cart.items.push(action.payload);
				}
			})

			.addCase(updateCartItem.fulfilled, (state, action) => {
				if (!state.cart) {
					return;
				}

				const idx = state.cart.items.findIndex(
					(item) => item.id === action.payload.id,
				);

				if (idx >= 0) {
					state.cart.items[idx] = action.payload;
				}
			})

			.addCase(
				removeCartItem.fulfilled,
				(state, action: PayloadAction<number>) => {
					if (!state.cart) {
						return;
					}

					state.cart.items = state.cart.items.filter(
						(item) => item.id !== action.payload,
					);
				},
			)

			.addCase(updateCartItemMeasurements.fulfilled, (state, action) => {
				if (!state.cart) {
					return;
				}

				const idx = state.cart.items.findIndex(
					(item) => item.id === action.payload.id,
				);

				if (idx >= 0) {
					state.cart.items[idx] = action.payload;
				}
			});
	},
});

export const { clearServerCart } = slice.actions;

export default slice.reducer;
