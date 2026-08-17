import { configureStore } from "@reduxjs/toolkit";

import authReducer from "../utils/authSlice";
import clientCartReducer from "../utils/cartSlice";
import serverCartReducer from "./serverCartSlice";
import wishlistReducer from "./wishListSlice";

export const store = configureStore({
	reducer: {
		auth: authReducer,
		serverCart: serverCartReducer,
		wishlist: wishlistReducer,
		cart: clientCartReducer, // Guest cart stored in localStorage (LS_KEY = "guest_cart")
	},
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
