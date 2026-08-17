import { useEffect } from "react";
import { fetchWishlistCount, setCount } from "../store/wishListSlice";
import { useAppDispatch } from "../utils/hooks";

export default function useAuthStorageSync() {
	const dispatch = useAppDispatch();

	useEffect(() => {
		const onStorage = (e: StorageEvent) => {
			if (!e.key) return;

			if (e.key === "token") {
				e.newValue ? dispatch(fetchWishlistCount()) : dispatch(setCount(0));
				return;
			}

			if (e.key === "wishlist:ping") {
				dispatch(fetchWishlistCount());
			}
		};

		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [dispatch]);
}
