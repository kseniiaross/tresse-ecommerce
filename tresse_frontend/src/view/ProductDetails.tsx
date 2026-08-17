import { useEffect, useMemo, useState } from "react";

import { useLocation, useNavigate, useParams } from "react-router-dom";

import "../../styles/ProductDetail.css";

import api from "../api/axiosInstance";
import fallbackImg from "../assets/images/fallback_product.jpg";
import CustomMeasurementsModal from "../components/CustomMeasurementsModal";
import * as serverCart from "../store/serverCartSlice";
import { fetchWishlistCount } from "../store/wishListSlice";
import type { Product } from "../types/product";
import { isAuthenticated } from "../types/token";
import { addToCart, type CustomMeasurements } from "../utils/cartSlice";
import { useAppDispatch } from "../utils/hooks";

import { toHttps } from "../utils/images";
import { trackMeta } from "../utils/metaPixel";
import { trackTikTok } from "../utils/tiktokPixel";

const SIZE_ORDER = [
	"XS",
	"S",
	"M",
	"L",
	"ONE SIZE",
	"OVER SIZE",
	"CUSTOM SIZE",
] as const;

function safeNumber(value: unknown): number | null {
	const parsed = typeof value === "number" ? value : Number(value);

	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value: string): string {
	return String(value || "")
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function splitParagraphs(value: string): string[] {
	return normalizeText(value)
		.split(/\n{2,}/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function splitCareLines(value: string): string[] {
	return normalizeText(value)
		.replace(/[ \t]+\*/g, "\n*")
		.split(/\n+/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function normalizeSizeLabel(value: string): string {
	return String(value || "")
		.trim()
		.toUpperCase()
		.replace(/\s+/g, " ");
}

function sizeRank(value: string): number {
	const normalized = normalizeSizeLabel(value);

	const index = SIZE_ORDER.indexOf(normalized as (typeof SIZE_ORDER)[number]);

	return index === -1 ? 999 : index;
}

function compareSizes(a: string, b: string): number {
	const rankA = sizeRank(a);
	const rankB = sizeRank(b);

	if (rankA !== rankB) {
		return rankA - rankB;
	}

	return normalizeSizeLabel(a).localeCompare(normalizeSizeLabel(b));
}

function formatPrice(value: string | number): string {
	const parsed = Number(value);

	if (!Number.isFinite(parsed)) {
		return String(value ?? "");
	}

	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 0,
	}).format(parsed);
}

export default function ProductDetails() {
	const dispatch = useAppDispatch();
	const navigate = useNavigate();
	const location = useLocation();

	const { id } = useParams();

	const productId = safeNumber(id);

	const authed = isAuthenticated();

	const [product, setProduct] = useState<Product | null>(null);

	const [selectedSizeId, setSelectedSizeId] = useState<number | null>(null);

	const [activeImageIndex, setActiveImageIndex] = useState(0);

	const [imgSrc, setImgSrc] = useState(fallbackImg);

	const [loading, setLoading] = useState(true);

	const [error, setError] = useState<string | null>(null);

	const [cartBusy, setCartBusy] = useState(false);

	const [wishBusy, setWishBusy] = useState(false);

	const [uiMessage, setUiMessage] = useState<string | null>(null);

	const [customLengthSelected, setCustomLengthSelected] = useState(false);

	const [isCareOpen, setIsCareOpen] = useState(false);

	const [isImageModalOpen, setIsImageModalOpen] = useState(false);

	const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);

	const sizes = useMemo(() => {
		return [...(product?.sizes ?? [])].sort((a, b) =>
			compareSizes(a.size.name, b.size.name),
		);
	}, [product]);

	const selectedSize = useMemo(() => {
		return sizes.find((item) => item.id === selectedSizeId) ?? null;
	}, [sizes, selectedSizeId]);

	const needsSize = sizes.length > 0;

	const isOut = useMemo(() => {
		if (!product) {
			return false;
		}

		return product.available === false || product.in_stock === false;
	}, [product]);

	const isCustomSelected =
		normalizeSizeLabel(selectedSize?.size?.name ?? "") === "CUSTOM SIZE";

	const allowsCustomLength = product?.allows_custom_length === true;

	const customLengthCm = safeNumber(product?.custom_length_cm) ?? 10;

	const customLengthSurcharge = useMemo(() => {
		const parsed = Number(product?.custom_length_surcharge ?? 0);

		return Number.isFinite(parsed) ? parsed : 0;
	}, [product]);

	const displayPrice = useMemo(() => {
		const basePrice = Number(product?.price ?? 0);

		const safeBasePrice = Number.isFinite(basePrice) ? basePrice : 0;

		if (!allowsCustomLength || !customLengthSelected) {
			return safeBasePrice;
		}

		return safeBasePrice + customLengthSurcharge;
	}, [
		product,
		allowsCustomLength,
		customLengthSelected,
		customLengthSurcharge,
	]);

	const canAddToCart =
		!cartBusy && !isOut && (!needsSize || selectedSizeId !== null);

	const descriptionParagraphs = useMemo(() => {
		if (!product?.description) {
			return [];
		}

		return splitParagraphs(product.description);
	}, [product]);

	const careLines = useMemo(() => {
		if (!product?.care_instructions) {
			return [];
		}

		return splitCareLines(product.care_instructions);
	}, [product]);

	const imagesForGallery = useMemo<string[]>(() => {
		const main = toHttps(product?.main_image_url ?? undefined);

		const rest = (product?.images ?? [])
			.map((image) => toHttps(image.image_url ?? undefined))
			.filter(
				(value): value is string =>
					typeof value === "string" && value.length > 0,
			);

		const unique = Array.from(new Set([...(main ? [main] : []), ...rest]));

		return unique.length > 0 ? unique : [fallbackImg];
	}, [product]);

	useEffect(() => {
		if (!productId) {
			setError("Invalid product id.");

			setLoading(false);
			return;
		}

		let alive = true;

		const loadProduct = async () => {
			try {
				setLoading(true);
				setError(null);
				setUiMessage(null);

				const response = await api.get<Product>(`/products/${productId}/`);

				if (!alive) {
					return;
				}

				const data = response.data;

				setProduct(data);

				setSelectedSizeId(null);
				setCustomLengthSelected(false);

				setActiveImageIndex(0);
				setIsCareOpen(false);
				setIsImageModalOpen(false);
				setIsCustomModalOpen(false);

				const firstImage = data.images?.[0]?.image_url ?? undefined;

				const nextImage =
					toHttps(data.main_image_url ?? firstImage) ?? fallbackImg;

				setImgSrc(nextImage);
			} catch (loadError) {
				console.error("Product load failed:", loadError);

				if (!alive) {
					return;
				}

				setError("Could not load product details.");
			} finally {
				if (alive) {
					setLoading(false);
				}
			}
		};

		void loadProduct();

		return () => {
			alive = false;
		};
	}, [productId]);

	useEffect(() => {
		if (!product) {
			return;
		}

		trackTikTok("ViewContent", {
			content_id: String(product.id),

			content_name: product.name,

			content_type: "product",

			currency: "USD",

			value: Number(product.price || 0),
		});

		trackMeta("ViewContent", {
			content_ids: [String(product.id)],

			content_name: product.name,

			content_type: "product",

			value: Number(product.price || 0),

			currency: "USD",
		});
	}, [product]);

	useEffect(() => {
		const index = Math.min(
			Math.max(activeImageIndex, 0),
			imagesForGallery.length - 1,
		);

		setImgSrc(imagesForGallery[index] ?? fallbackImg);
	}, [activeImageIndex, imagesForGallery]);

	useEffect(() => {
		if (!isImageModalOpen) {
			return;
		}

		const previousOverflow = document.body.style.overflow;

		document.body.style.overflow = "hidden";

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsImageModalOpen(false);
			}
		};

		window.addEventListener("keydown", handleKeyDown);

		return () => {
			document.body.style.overflow = previousOverflow;

			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [isImageModalOpen]);

	const trackAddToCart = () => {
		if (!product) {
			return;
		}

		trackTikTok("AddToCart", {
			content_id: String(product.id),

			content_name: product.name,

			content_type: "product",

			currency: "USD",

			value: displayPrice,
		});

		trackMeta("AddToCart", {
			content_ids: [String(product.id)],

			content_name: product.name,

			content_type: "product",

			value: displayPrice,

			currency: "USD",
		});
	};

	const addProductToCart = async (measurements?: CustomMeasurements) => {
		if (!product) {
			return;
		}

		if (needsSize && !selectedSizeId) {
			setUiMessage("Please select a size.");

			return;
		}

		if (!selectedSizeId) {
			return;
		}

		const hasCustomLength = allowsCustomLength && customLengthSelected;

		const payload = {
			product_size_id: selectedSizeId,

			custom_length_selected: hasCustomLength,

			custom_length_cm: hasCustomLength ? customLengthCm : null,

			custom_length_surcharge: hasCustomLength ? customLengthSurcharge : 0,

			custom_bust: measurements?.custom_bust ?? "",

			custom_underbust: measurements?.custom_underbust ?? "",

			custom_waist: measurements?.custom_waist ?? "",

			custom_hips: measurements?.custom_hips ?? "",

			custom_height: measurements?.custom_height ?? "",

			custom_cup: measurements?.custom_cup ?? "",

			custom_fit_notes: measurements?.custom_fit_notes ?? "",
		};

		setCartBusy(true);
		setUiMessage(null);

		try {
			if (authed) {
				await dispatch(serverCart.addCartItem(payload)).unwrap();

				await dispatch(serverCart.fetchCart());
			} else {
				dispatch(
					addToCart({
						product,
						...payload,

						sizeName: selectedSize?.size?.name ?? "ONE SIZE",

						maxQty: selectedSize?.quantity,
					}),
				);
			}

			trackAddToCart();

			setUiMessage("Added to bag.");
		} catch (cartError) {
			console.error("Add to cart failed:", cartError);

			setUiMessage("Could not add to cart.");
		} finally {
			setCartBusy(false);
		}
	};

	const handleAddToCart = () => {
		if (!canAddToCart) {
			return;
		}

		if (isCustomSelected) {
			setIsCustomModalOpen(true);
			return;
		}

		void addProductToCart();
	};

	const handleWishlist = async () => {
		if (!product || wishBusy) {
			return;
		}

		if (!authed) {
			const next = location.pathname + location.search;

			navigate(`/login-choice?next=${encodeURIComponent(next)}`);

			return;
		}

		setWishBusy(true);
		setUiMessage(null);

		try {
			await api.post(`/products/${product.id}/toggle_wishlist/`);

			setProduct((previous) => {
				if (!previous) {
					return previous;
				}

				return {
					...previous,

					is_in_wishlist: !previous.is_in_wishlist,
				};
			});

			dispatch(fetchWishlistCount());

			setUiMessage("Wishlist updated.");
		} catch (wishlistError) {
			console.error("Wishlist update failed:", wishlistError);

			setUiMessage("Could not update wishlist.");
		} finally {
			setWishBusy(false);
		}
	};

	if (loading) {
		return (
			<section className="product-detail">
				<div className="product-detail__wrap">
					<div
						className="
              product-detail__skeleton
              product-detail__skeleton-media
            "
					/>

					<div
						className="
              product-detail__skeleton
              product-detail__skeleton-panel
            "
					/>
				</div>
			</section>
		);
	}

	if (error || !product) {
		return (
			<section className="product-detail">
				<div className="product-detail__error">
					<h2 className="product-detail__error-title">Something went wrong</h2>

					<p className="product-detail__error-text">
						{error ?? "Product not found."}
					</p>
				</div>
			</section>
		);
	}

	return (
		<section className="product-detail">
			<div className="product-detail__wrap">
				<div className="product-detail__media">
					<div className="product-detail__gallery">
						<div className="product-detail__main-image">
							<button
								type="button"
								className="product-detail__image-button"
								onClick={() => setIsImageModalOpen(true)}
								aria-label={`Open larger image of ${product.name}`}
							>
								<img
									src={imgSrc}
									alt={product.name}
									onError={(event) => {
										event.currentTarget.src = fallbackImg;
									}}
								/>
							</button>

							{isOut ? (
								<span className="product-detail__badge">Out of stock</span>
							) : null}
						</div>

						{imagesForGallery.length > 1 ? (
							<fieldset
								className="product-detail__thumbs"
								aria-label="Product images"
							>
								{imagesForGallery.map((url, index) => (
									<button
										key={url}
										type="button"
										className={`product-detail__thumb ${
											index === activeImageIndex ? "is-active" : ""
										}`}
										onClick={() => setActiveImageIndex(index)}
										aria-label={`Open image ${index + 1}`}
									>
										<img
											src={url}
											alt=""
											onError={(event) => {
												event.currentTarget.src = fallbackImg;
											}}
										/>
									</button>
								))}
							</fieldset>
						) : null}
					</div>
				</div>

				<aside className="product-detail__panel">
					<div className="product-detail__top">
						<h1 className="product-detail__title">{product.name}</h1>

						<div className="product-detail__price">
							{formatPrice(displayPrice)}
						</div>
					</div>

					{product.variants?.length ? (
						<div className="product-detail__colors">
							<h2 className="product-detail__section-title">Color</h2>

							<div className="product-detail__color-list">
								{product.variants.map((variant) => {
									const active = variant.id === product.id;

									return (
										<button
											key={variant.id}
											type="button"
											className={`product-detail__color ${
												active ? "is-active" : ""
											}`}
											onClick={() => navigate(`/product/${variant.id}`)}
											title={variant.color_name || variant.name}
											aria-label={variant.color_name || variant.name}
										>
											{variant.color_swatch_url ? (
												<img
													src={variant.color_swatch_url}
													alt={variant.color_name || variant.name}
												/>
											) : (
												<span
													style={{
														background: variant.color_hex || "#ddd",
													}}
												/>
											)}
										</button>
									);
								})}
							</div>
						</div>
					) : null}

					{product.category?.name ? (
						<div className="product-detail__meta">
							{String(product.category.name).toUpperCase()}
						</div>
					) : null}

					{descriptionParagraphs.length > 0 ? (
						<div className="product-detail__desc">
							<h2 className="product-detail__section-title">Description</h2>

							<div className="product-detail__desc-text">
								{descriptionParagraphs.map((paragraph, index) => (
									<p
										key={`${paragraph}-${index}`}
										className="product-detail__desc-paragraph"
									>
										{paragraph}
									</p>
								))}
							</div>
						</div>
					) : null}

					{careLines.length > 0 ? (
						<div className="product-detail__care">
							<button
								type="button"
								className="product-detail__care-toggle"
								onClick={() => setIsCareOpen((previous) => !previous)}
								aria-expanded={isCareOpen}
							>
								<span>Care Instructions</span>

								<span>{isCareOpen ? "−" : "+"}</span>
							</button>

							{isCareOpen ? (
								<div className="product-detail__care-content">
									{careLines.map((line, index) => (
										<p
											key={`care-${index}`}
											className="product-detail__care-line"
										>
											{line}
										</p>
									))}
								</div>
							) : null}
						</div>
					) : null}

					{sizes.length > 0 ? (
						<div className="product-detail__sizes">
							<h2 className="product-detail__section-title">Size</h2>

							<div
								className="product-detail__size-grid"
								role="listbox"
								aria-label="Select size"
							>
								{sizes.map((sizeItem) => {
									const disabled = sizeItem.quantity <= 0;

									const selected = selectedSizeId === sizeItem.id;

									return (
										<button
											key={sizeItem.id}
											type="button"
											className={`product-detail__size ${
												selected ? "is-selected" : ""
											}`}
											disabled={disabled}
											aria-disabled={disabled}
											aria-selected={selected}
											role="option"
											title={
												disabled
													? "Out of stock"
													: `In stock: ${sizeItem.quantity}`
											}
											onClick={() => {
												if (disabled) {
													return;
												}

												setSelectedSizeId(sizeItem.id);

												setUiMessage(null);
											}}
										>
											{sizeItem.size.name}
										</button>
									);
								})}
							</div>

							<div className="product-detail__hint">
								{selectedSize ? (
									selectedSize.quantity > 0 ? (
										<span>Selected size is available.</span>
									) : (
										<span>Selected size is out of stock.</span>
									)
								) : (
									<span>Please select a size.</span>
								)}
							</div>
						</div>
					) : null}

					{allowsCustomLength ? (
						<div className="product-detail__custom-length">
							<h2 className="product-detail__section-title">Custom Length</h2>

							<label className="product-detail__custom-length-row">
								<input
									type="checkbox"
									checked={customLengthSelected}
									onChange={(event) => {
										setCustomLengthSelected(event.target.checked);

										setUiMessage(null);
									}}
								/>

								<span>
									Add {customLengthCm} cm
									{customLengthSurcharge > 0 ? (
										<> · +{formatPrice(customLengthSurcharge)}</>
									) : null}
								</span>
							</label>

							<p className="product-detail__custom-length-note">
								Extend the garment by {customLengthCm} cm. Custom-length pieces
								are made to order and final sale.
							</p>
						</div>
					) : null}

					<div className="product-detail__actions">
						<button
							type="button"
							className="
                product-detail__btn
                product-detail__btn--primary
              "
							onClick={handleAddToCart}
							disabled={!canAddToCart}
						>
							{cartBusy ? "Adding..." : "Add to cart"}
						</button>

						<button
							type="button"
							className="
                product-detail__btn
                product-detail__btn--secondary
              "
							onClick={handleWishlist}
							disabled={wishBusy}
						>
							{wishBusy
								? "Saving..."
								: product.is_in_wishlist
									? "Remove from wishlist"
									: "Add to wishlist"}
						</button>

						{uiMessage ? (
							<div className="product-detail__message" aria-live="polite">
								{uiMessage}
							</div>
						) : null}
					</div>
				</aside>
			</div>

			{isImageModalOpen ? (
				<div
					className="product-detail__modal"
					role="dialog"
					aria-modal="true"
					aria-label={`${product.name} image preview`}
				>
					<button
						type="button"
						className="product-detail__modal-backdrop"
						onClick={() => setIsImageModalOpen(false)}
						aria-label="Close image preview"
					/>

					<div className="product-detail__modal-content">
						<button
							type="button"
							className="product-detail__modal-close"
							onClick={() => setIsImageModalOpen(false)}
							aria-label="Close"
						>
							×
						</button>

						<img
							src={imgSrc}
							alt={product.name}
							className="product-detail__modal-image"
							onError={(event) => {
								event.currentTarget.src = fallbackImg;
							}}
						/>
					</div>
				</div>
			) : null}

			<CustomMeasurementsModal
				open={isCustomModalOpen}
				onClose={() => setIsCustomModalOpen(false)}
				onSubmit={(data) => {
					setIsCustomModalOpen(false);

					void addProductToCart(data);
				}}
			/>
		</section>
	);
}
