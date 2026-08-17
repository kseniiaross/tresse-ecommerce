import { useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/axiosInstance";
import wishlistIconActive from "../assets/icons/wishlist1.png";
import fallbackImg from "../assets/images/fallback_product.jpg";
import ProductModal from "../components/ProductModal";
import type { AppDispatch } from "../store";
import { fetchWishlistCount } from "../store/wishListSlice";
import type { Product } from "../types/product";
import "../../styles/WishList.css";

type Paginated<T> = {
	count: number;
	next: string | null;
	previous: string | null;
	results: T[];
};

function toNumberOrEmpty(raw: string): number | "" {
	const v = raw.trim();
	if (v === "") return "";
	const n = Number(v);
	if (!Number.isFinite(n)) return "";
	return n;
}

function isFiniteNumber(v: number | ""): v is number {
	return typeof v === "number" && Number.isFinite(v);
}

export default function WishList() {
	const dispatch = useDispatch<AppDispatch>();
	const navigate = useNavigate();
	const location = useLocation();

	const params = new URLSearchParams(location.search);
	const categoryParam = params.get("category");

	const [products, setProducts] = useState<Product[]>([]);
	const [searchTerm, setSearchTerm] = useState("");
	const [ordering, setOrdering] = useState("-created_at");

	const [minPrice, setMinPrice] = useState<number | "">("");
	const [maxPrice, setMaxPrice] = useState<number | "">("");

	const [modalProduct, setModalProduct] = useState<Product | null>(null);

	const [loading, setLoading] = useState(false);
	const [serverTotal, setServerTotal] = useState(0);

	const pageSize = 12;

	const filtered = useMemo(() => {
		const t = searchTerm.trim().toLowerCase();
		if (!t) return products;
		return products.filter((p) => p.name.toLowerCase().includes(t));
	}, [products, searchTerm]);

	useEffect(() => {
		const ctrl = new AbortController();
		setLoading(true);

		const safeMin = isFiniteNumber(minPrice) ? minPrice : undefined;
		const safeMax = isFiniteNumber(maxPrice) ? maxPrice : undefined;

		api
			.get<Paginated<Product>>("/products/wishlist/", {
				params: {
					page_size: pageSize,
					ordering,
					category: categoryParam || undefined,
					min_price: safeMin,
					max_price: safeMax,
				},
				signal: ctrl.signal,
			})
			.then((res) => {
				setProducts(res.data.results);
				setServerTotal(res.data.count);
			})
			.catch((err) => {
				if (ctrl.signal.aborted) return;
				console.error("Wishlist fetch error:", err);
				setProducts([]);
				setServerTotal(0);
			})
			.finally(() => {
				if (!ctrl.signal.aborted) setLoading(false);
			});

		return () => ctrl.abort();
	}, [ordering, categoryParam, minPrice, maxPrice]);

	const handleRemove = async (id: number) => {
		try {
			await api.delete(`/products/${id}/wishlist/`);

			setProducts((prev) => prev.filter((p) => p.id !== id));
			setServerTotal((t) => Math.max(0, t - 1));

			dispatch(fetchWishlistCount());
			localStorage.setItem("wishlist:ping", String(Date.now()));
		} catch (e) {
			console.error("Remove wishlist error:", e);
		}
	};

	const openProductDetail = (productId: number) => {
		navigate(`/product/${productId}`);
	};

	const shownCount = filtered.length;

	return (
		<section className="wishlist" aria-label="Wishlist">
			<div className="wishlist__top">
				<h1 className="wishlist__title">
					MY WISHLIST{" "}
					{serverTotal
						? `(${serverTotal}${searchTerm.trim() ? ` • showing ${shownCount}` : ""})`
						: ""}
				</h1>

				<fieldset className="wishlist__filters" aria-label="Wishlist filters">
					<label className="srOnly" htmlFor="wishlist_search">
						Search in wishlist
					</label>

					<input
						id="wishlist_search"
						className="wishlist__input"
						placeholder="Search in wishlist..."
						value={searchTerm}
						onChange={(e) => setSearchTerm(e.target.value)}
					/>

					<select
						className="wishlist__select"
						value={ordering}
						onChange={(e) => setOrdering(e.target.value)}
						aria-label="Sort wishlist"
					>
						<option value="-created_at">Newest first</option>
						<option value="price">Price: low → high</option>
						<option value="-price">Price: high → low</option>
						<option value="name">Name: A → Z</option>
						<option value="-name">Name: Z → A</option>
					</select>

					<fieldset className="wishlist__price" aria-label="Price range">
						<label className="srOnly" htmlFor="wishlist_min_price">
							Minimum price
						</label>
						<input
							id="wishlist_min_price"
							type="number"
							placeholder="Min price"
							value={minPrice}
							onChange={(e) => setMinPrice(toNumberOrEmpty(e.target.value))}
							className="wishlist__input wishlist__input--price"
							inputMode="decimal"
							min={0}
							step="0.01"
						/>

						<label className="srOnly" htmlFor="wishlist_max_price">
							Maximum price
						</label>
						<input
							id="wishlist_max_price"
							type="number"
							placeholder="Max price"
							value={maxPrice}
							onChange={(e) => setMaxPrice(toNumberOrEmpty(e.target.value))}
							className="wishlist__input wishlist__input--price"
							inputMode="decimal"
							min={0}
							step="0.01"
						/>
					</fieldset>
				</fieldset>
			</div>

			{loading && (
				<div className="wishlist__loader" role="status" aria-live="polite">
					Loading…
				</div>
			)}

			{!loading && filtered.length === 0 && (
				<div className="wishlist__empty" role="status" aria-live="polite">
					No items in wishlist.
				</div>
			)}

			<ul className="wishlist__grid" aria-label="Wishlist items">
				{filtered.map((product) => {
					const imgSrc =
						product.main_image_url ||
						product.images?.[0]?.image_url ||
						fallbackImg;

					return (
						<li key={product.id} className="wishlist__card">
							<button
								type="button"
								className="catalog__wishlist-btn catalog__wishlist-btn--active wishlist__wishlistBtn"
								aria-label="Remove from wishlist"
								aria-pressed={true}
								onClick={(e) => {
									e.stopPropagation();
									void handleRemove(product.id);
								}}
							>
								<img
									src={wishlistIconActive}
									alt=""
									aria-hidden="true"
									className="catalog__wishlist-icon"
								/>
							</button>

							<button
								type="button"
								className="wishlist__media"
								onClick={() => openProductDetail(product.id)}
								aria-label={`Open product: ${product.name}`}
							>
								<img
									src={imgSrc}
									alt={product.name}
									className="wishlist__image"
									loading="lazy"
									onError={(e) => {
										(e.currentTarget as HTMLImageElement).src = fallbackImg;
									}}
								/>
							</button>

							<div className="wishlist__meta">
								<span className="wishlist__name" title={product.name}>
									{product.name}
								</span>
								<span className="wishlist__priceValue">${product.price}</span>
							</div>

							<button
								type="button"
								className="wishlist__addBtn"
								onClick={(e) => {
									e.stopPropagation();
									setModalProduct(product);
								}}
							>
								ADD TO CART
							</button>
						</li>
					);
				})}
			</ul>

			<ProductModal
				product={modalProduct}
				onClose={() => setModalProduct(null)}
			/>
		</section>
	);
}
