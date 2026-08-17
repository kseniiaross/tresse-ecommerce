import {
	createAsyncThunk,
	createSlice,
	type PayloadAction,
} from "@reduxjs/toolkit";
import api from "../api/axiosInstance";

export const fetchWishlistCount = createAsyncThunk<
	number,
	void,
	{ rejectValue: string }
>("wishlist/fetchCount", async (_, { rejectWithValue }) => {
	try {
		const res = await api.get<{ count: number }>("/products/wishlist/count/");
		return res.data.count;
	} catch (_err: unknown) {
		// we keep a typed rejectValue so UI can react predictably (e.g., reset count on auth errors).
		return rejectWithValue("Failed to fetch wishlist count");
	}
});

type WishlistState = {
	count: number;
	loading: boolean;
	error: string | null;
};

const initialState: WishlistState = {
	count: 0,
	loading: false,
	error: null,
};

const wishlistSlice = createSlice({
	name: "wishlist",
	initialState,
	reducers: {
		inc: (state) => {
			// optimistic UI helper (use only if you also rollback or re-sync with fetchWishlistCount).
			state.count += 1;
		},
		dec: (state) => {
			// optimistic UI helper; never allow negative UI count.
			state.count = Math.max(0, state.count - 1);
		},
		setCount: (state, action: PayloadAction<number>) => {
			// source-of-truth setter (usually used after server response).
			state.count = Math.max(0, action.payload);
		},
		clearError: (state) => {
			state.error = null;
		},
	},
	extraReducers: (builder) => {
		builder
			.addCase(fetchWishlistCount.pending, (state) => {
				state.loading = true;
				state.error = null;
			})
			.addCase(fetchWishlistCount.fulfilled, (state, action) => {
				state.loading = false;
				state.count = Math.max(0, action.payload);
			})
			.addCase(fetchWishlistCount.rejected, (state, action) => {
				state.loading = false;

				// if user is logged out / unauthorized, count must not show stale values.
				// axiosInstance may surface 401/403; if we can't reliably read it here, we still keep UI safe by not increasing count.
				state.error = (
					action.payload ??
					action.error.message ??
					"Request failed"
				).toString();

				// Safe fallback: keep last known count unless you prefer strict reset on any failure.
				// If your app triggers fetchWishlistCount on logout, the count will reset anyway via setCount(0).
			});
	},
});

export const { setCount, inc, dec, clearError } = wishlistSlice.actions;
export default wishlistSlice.reducer;
