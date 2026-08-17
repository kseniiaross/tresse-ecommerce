import {
	type CSSProperties,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { useDispatch } from "react-redux";

import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../api/axiosInstance";
import wishlistIcon from "../assets/icons/wishlist.png";
import wishlistIconActive from "../assets/icons/wishlist1.png";
import fallbackImg from "../assets/images/fallback_product.jpg";
import { useDialogDismiss } from "../hooks/useDialogDismiss";
import type { AppDispatch } from "../store";
import { fetchWishlistCount } from "../store/wishListSlice";
import type {
	Product,
	ProductSizeInline,
	ProductVariant,
} from "../types/product";
import { getAccessToken } from "../types/token";
import { toHttps } from "../utils/images";

import "../../styles/ProductCatalog.css";

import CustomMeasurementsModal from "../components/CustomMeasurementsModal";
import * as serverCart from "../store/serverCartSlice";

import { addToCart, type CustomMeasurements } from "../utils/cartSlice";
import { trackTikTok } from "../utils/tiktokPixel";

const SESSION_EMAIL_KEY = "notify_email";

const SIZE_ORDER = [
	"XS",
	"S",
	"M",
	"L",
	"ONE SIZE",
	"OVER SIZE",
	"CUSTOM SIZE",
] as const;

type CategoryKey = "" | "woman" | "man" | "kids";

type CollectionKey =
	| ""
	| "the-new"
	| "bestsellers"
	| "exclusives"
	| "summer"
	| "sweaters"
	| "cardigans"
	| "dresses";

type OrderingKey =
	| "sort_order"
	| "-created_at"
	| "price"
	| "-price"
	| "name"
	| "-name";

type PaginatedResponse<T> = {
	count?: number;
	next?: string | null;
	previous?: string | null;
	results?: T[];
};

type PendingCartSelection = {
	product: Product;
	sizeId: number;
	measurements?: CustomMeasurements;
};

type CatalogCarouselStyle = CSSProperties & {
	"--catalog-image-count": number;
};

type NotifyModalProps = {
	product: Product;
	isAuthed: boolean;
	guestNotifyEmail: string;
	onGuestNotifyEmailChange: (value: string) => void;
	onClose: () => void;
	onConfirm: (productId: number) => void;
};

type SizeModalProps = {
	product: Product;
	selectedSizeId?: number;
	onSelectSize: (sizeId: number) => void;
	onClose: () => void;
	onContinue: () => void;
};

type CustomLengthModalProps = {
	pending: PendingCartSelection;
	onClose: () => void;
	onChooseStandard: (pending: PendingCartSelection) => void;
	onChooseCustom: (pending: PendingCartSelection) => void;
};

const isValidEmail = (email: string): boolean => {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
};

const normalizeEmail = (email: string): string => {
	return String(email || "").trim();
};

const safeGetSessionEmail = (): string => {
	try {
		return normalizeEmail(sessionStorage.getItem(SESSION_EMAIL_KEY) || "");
	} catch {
		return "";
	}
};

const safeSetSessionEmail = (email: string): void => {
	try {
		sessionStorage.setItem(SESSION_EMAIL_KEY, normalizeEmail(email));
	} catch {
		// Ignore unavailable storage.
	}
};

const normalizeSizeLabel = (name: string): string => {
	return String(name || "")
		.trim()
		.toUpperCase()
		.replace(/\s+/g, " ");
};

const sizeRank = (name: string): number => {
	const label = normalizeSizeLabel(name);

	const index = SIZE_ORDER.indexOf(label as (typeof SIZE_ORDER)[number]);

	return index === -1 ? 999 : index;
};

const compareSizes = (a: string, b: string): number => {
	const rankA = sizeRank(a);

	const rankB = sizeRank(b);

	if (rankA !== rankB) {
		return rankA - rankB;
	}

	return normalizeSizeLabel(a).localeCompare(normalizeSizeLabel(b));
};

const getProductSizes = (product: Product): ProductSizeInline[] => {
	return product.sizes ?? [];
};

const normalizeCategory = (value: unknown): CategoryKey => {
	const normalized = String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/['"]/g, "")
		.replace(/\s+/g, "-");

	if (
		normalized === "woman" ||
		normalized === "women" ||
		normalized === "womens" ||
		normalized === "female"
	) {
		return "woman";
	}

	if (
		normalized === "man" ||
		normalized === "men" ||
		normalized === "mens" ||
		normalized === "male"
	) {
		return "man";
	}

	if (
		normalized === "kids" ||
		normalized === "kid" ||
		normalized === "children" ||
		normalized === "child"
	) {
		return "kids";
	}

	return "";
};

const normalizeCollection = (value: unknown): CollectionKey => {
	const normalized = String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/['"]/g, "")
		.replace(/\s+/g, "-");

	if (
		normalized === "the-new" ||
		normalized === "new" ||
		normalized === "new-arrivals" ||
		normalized === "new-in"
	) {
		return "the-new";
	}

	if (
		normalized === "bestsellers" ||
		normalized === "best-sellers" ||
		normalized === "best-seller"
	) {
		return "bestsellers";
	}

	if (normalized === "exclusives" || normalized === "exclusive") {
		return "exclusives";
	}

	if (normalized === "summer") {
		return "summer";
	}

	if (normalized === "sweaters" || normalized === "sweater") {
		return "sweaters";
	}

	if (normalized === "cardigans" || normalized === "cardigan") {
		return "cardigans";
	}

	if (normalized === "dresses" || normalized === "dress") {
		return "dresses";
	}

	return "";
};

const readFilters = (
	searchString: string,
): {
	category: CategoryKey;
	collection: CollectionKey;
	search: string;
} => {
	const params = new URLSearchParams(searchString);

	return {
		category: normalizeCategory(params.get("category")),

		collection: normalizeCollection(params.get("collection")),

		search: String(params.get("search") || "").trim(),
	};
};

const isPaginated = <T,>(data: unknown): data is PaginatedResponse<T> => {
	return (
		!!data &&
		typeof data === "object" &&
		"results" in (data as Record<string, unknown>)
	);
};

const uniqById = (items: Product[]): Product[] => {
	const map = new Map<number, Product>();

	for (const item of items) {
		map.set(item.id, item);
	}

	return Array.from(map.values());
};

const getCreatedAtMs = (product: Product): number => {
	const raw =
		(
			product as unknown as {
				created_at?: unknown;
			}
		).created_at ??
		(
			product as unknown as {
				createdAt?: unknown;
			}
		).createdAt ??
		(
			product as unknown as {
				created?: unknown;
			}
		).created ??
		"";

	const parsed = Date.parse(String(raw));

	return Number.isFinite(parsed) ? parsed : 0;
};

const getPriceNumber = (product: Product): number => {
	const raw =
		(
			product as unknown as {
				price?: unknown;
			}
		).price ?? 0;

	const parsed = Number(String(raw).replace(/[^\d.-]/g, ""));

	return Number.isFinite(parsed) ? parsed : 0;
};

const getCustomLengthCm = (product: Product): number => {
	const parsed = Number(product.custom_length_cm ?? 10);

	return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
};

const getCustomLengthSurcharge = (product: Product): number => {
	const parsed = Number(product.custom_length_surcharge ?? 0);

	return Number.isFinite(parsed) ? parsed : 0;
};

const formatMoney = (value: number): string => {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 0,
	}).format(value);
};

const formatPrice = (product: Product): string => {
	return formatMoney(getPriceNumber(product));
};

const getNameString = (product: Product): string => {
	return String(product.name ?? "").toLowerCase();
};

const compareProducts = (
	a: Product,
	b: Product,
	ordering: OrderingKey,
): number => {
	if (ordering === "sort_order") {
		return (a.sort_order ?? 0) - (b.sort_order ?? 0);
	}

	if (ordering === "price") {
		return getPriceNumber(a) - getPriceNumber(b);
	}

	if (ordering === "-price") {
		return getPriceNumber(b) - getPriceNumber(a);
	}

	if (ordering === "name") {
		return getNameString(a).localeCompare(getNameString(b));
	}

	if (ordering === "-name") {
		return getNameString(b).localeCompare(getNameString(a));
	}

	return getCreatedAtMs(b) - getCreatedAtMs(a);
};

const getOrderedVariants = (product: Product): ProductVariant[] => {
	const variants = product.variants ?? [];

	const current: ProductVariant = {
		id: product.id,

		name: product.name,

		color_name: product.color_name ?? "",

		color_hex: product.color_hex ?? "",

		color_swatch_url: product.color_swatch_url ?? null,

		main_image_url: product.main_image_url ?? null,
	};

	return [
		current,

		...variants.filter((variant) => variant.id !== product.id),
	];
};

const MARKETING_BADGES: Record<string, string> = {
	"the-new": "NEW",
	bestsellers: "BESTSELLER",
	exclusives: "EXCLUSIVE",
};

const getProductBadge = (
	product: Product,
	activeCollection: CollectionKey,
): string | null => {
	const isOut = !product.available || !product.in_stock;

	if (isOut) {
		return "OUT OF STOCK";
	}

	const slugs = product.collections_slugs ?? [];

	const marketingSlugs = ["the-new", "bestsellers", "exclusives"];

	for (const slug of marketingSlugs) {
		if (activeCollection === slug) {
			continue;
		}

		if (slugs.includes(slug)) {
			return MARKETING_BADGES[slug] ?? null;
		}
	}

	return null;
};

const getCatalogImages = (product: Product): string[] => {
	const rawUrls = [
		product.main_image_url,

		...(product.images ?? []).map((image) => image.image_url),
	];

	const urls: string[] = [];

	for (const rawUrl of rawUrls) {
		if (!rawUrl) {
			continue;
		}

		const safeUrl = toHttps(rawUrl);

		if (safeUrl) {
			urls.push(safeUrl);
		}
	}

	const unique = Array.from(new Set(urls));

	return unique.length > 0 ? unique.slice(0, 4) : [fallbackImg];
};

const getApiErrorMessage = (error: unknown): string => {
	const responseData = (
		error as {
			response?: {
				data?: unknown;
			};
		}
	)?.response?.data;

	if (typeof responseData === "string" && responseData.trim()) {
		return responseData.trim();
	}

	if (!responseData || typeof responseData !== "object") {
		return "Could not add to cart.";
	}

	const data = responseData as Record<string, unknown>;

	const preferredKeys = [
		"quantity",
		"product_size_id",
		"detail",
		"non_field_errors",
	];

	for (const key of preferredKeys) {
		const value = data[key];

		if (Array.isArray(value) && value.length > 0) {
			const first = value[0];

			if (typeof first === "string" && first.trim()) {
				return first.trim();
			}

			if (first !== null && first !== undefined) {
				return String(first);
			}
		}

		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}

	for (const value of Object.values(data)) {
		if (Array.isArray(value) && value.length > 0) {
			const first = value[0];

			if (typeof first === "string" && first.trim()) {
				return first.trim();
			}
		}

		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}

	return "Could not add to cart.";
};

function NotifyModal({
	product,
	isAuthed,
	guestNotifyEmail,
	onGuestNotifyEmailChange,
	onClose,
	onConfirm,
}: NotifyModalProps) {
	const overlayRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	useDialogDismiss(overlayRef, contentRef, onClose);

	return (
		<div className="sizeModal__overlay" ref={overlayRef}>
			<div
				className="notifyModal"
				ref={contentRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-labelledby="notifyModalTitle"
			>
				<div className="notifyModal__head">
					<h3 id="notifyModalTitle" className="notifyModal__title">
						Notify me
					</h3>

					<button
						type="button"
						className="notifyModal__close"
						onClick={onClose}
						aria-label="Close"
					>
						×
					</button>
				</div>

				{isAuthed ? (
					<p className="notifyModal__text">
						We’ll email you as soon as this item is back in stock.
					</p>
				) : (
					<>
						<p className="notifyModal__text">
							Enter your email — we’ll notify you when it’s available again.
						</p>

						<input
							type="email"
							placeholder="your@email.com"
							value={guestNotifyEmail}
							onChange={(event) => onGuestNotifyEmailChange(event.target.value)}
							autoComplete="email"
							inputMode="email"
						/>
					</>
				)}

				<button
					type="button"
					className="notifyModal__primary"
					disabled={!isAuthed && !isValidEmail(guestNotifyEmail)}
					onClick={() => onConfirm(product.id)}
				>
					Confirm
				</button>
			</div>
		</div>
	);
}

function SizeModal({
	product,
	selectedSizeId,
	onSelectSize,
	onClose,
	onContinue,
}: SizeModalProps) {
	const sizes = getProductSizes(product)
		.slice()
		.sort((a, b) => compareSizes(a.size.name, b.size.name));

	const overlayRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	useDialogDismiss(overlayRef, contentRef, onClose);

	return (
		<div className="sizeModal__overlay" ref={overlayRef}>
			<div
				className="sizeModal"
				ref={contentRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-labelledby="sizeModalTitle"
			>
				<div className="sizeModal__head">
					<div id="sizeModalTitle" className="sizeModal__title">
						Select size
					</div>

					<button
						type="button"
						className="sizeModal__close"
						onClick={onClose}
						aria-label="Close"
					>
						×
					</button>
				</div>

				<div className="sizeModal__body">
					<div className="sizeModal__sizes">
						{sizes.map((size) => {
							const disabled = size.quantity <= 0;

							const active = selectedSizeId === size.id;

							return (
								<button
									key={size.id}
									type="button"
									className={`sizeModal__chip ${
										active ? "sizeModal__chip--active" : ""
									}`}
									disabled={disabled}
									onClick={() => {
										if (disabled) {
											return;
										}

										onSelectSize(size.id);
									}}
									title={
										disabled ? "Out of stock" : `In stock: ${size.quantity}`
									}
								>
									{size.size.name}
								</button>
							);
						})}
					</div>

					<button
						type="button"
						className="sizeModal__primary"
						disabled={!selectedSizeId}
						onClick={onContinue}
					>
						Continue
					</button>

					<div className="sizeModal__hint">
						Choose an available size to continue.
					</div>
				</div>
			</div>
		</div>
	);
}

function CustomLengthModal({
	pending,
	onClose,
	onChooseStandard,
	onChooseCustom,
}: CustomLengthModalProps) {
	const customLengthCm = getCustomLengthCm(pending.product);

	const surcharge = getCustomLengthSurcharge(pending.product);

	const overlayRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	useDialogDismiss(overlayRef, contentRef, onClose);

	return (
		<div className="sizeModal__overlay" ref={overlayRef}>
			<div
				className="customLengthModal"
				ref={contentRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-labelledby="customLengthModalTitle"
			>
				<div className="customLengthModal__head">
					<div id="customLengthModalTitle" className="customLengthModal__title">
						Custom Length
					</div>

					<button
						type="button"
						className="customLengthModal__close"
						onClick={onClose}
						aria-label="Close"
					>
						×
					</button>
				</div>

				<div className="customLengthModal__body">
					<p className="customLengthModal__text">
						Would you like to add {customLengthCm} cm to the garment length?
					</p>

					{surcharge > 0 ? (
						<p className="customLengthModal__price">
							+{formatMoney(surcharge)}
						</p>
					) : null}

					<p className="customLengthModal__note">
						Custom-length pieces are made to order and final sale.
					</p>

					<div className="customLengthModal__actions">
						<button
							type="button"
							className="customLengthModal__secondary"
							onClick={() => onChooseStandard(pending)}
						>
							Standard Length
						</button>

						<button
							type="button"
							className="customLengthModal__primary"
							onClick={() => onChooseCustom(pending)}
						>
							Add Custom Length
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

export default function ProductCatalog() {
	const navigate = useNavigate();

	const dispatch = useDispatch<AppDispatch>();

	const location = useLocation();

	const searchInputRef = useRef<HTMLInputElement | null>(null);

	const isAuthed = Boolean(getAccessToken());

	const {
		category,
		collection,
		search: urlSearch,
	} = useMemo(() => readFilters(location.search), [location.search]);

	const [searchTerm, setSearchTerm] = useState<string>(urlSearch);

	const [ordering, setOrdering] = useState<OrderingKey>("sort_order");

	const [minPrice, setMinPrice] = useState<number | "">("");

	const [maxPrice, setMaxPrice] = useState<number | "">("");

	const [allProducts, setAllProducts] = useState<Product[]>([]);

	const [loading, setLoading] = useState(false);

	const [loadError, setLoadError] = useState("");

	const [selectedSizeByProduct, setSelectedSizeByProduct] = useState<
		Record<number, number>
	>({});

	const [addBusyByProduct, setAddBusyByProduct] = useState<
		Record<number, boolean>
	>({});

	const [notifyModalProduct, setNotifyModalProduct] = useState<Product | null>(
		null,
	);

	const [guestNotifyEmail, setGuestNotifyEmail] = useState<string>(() =>
		safeGetSessionEmail(),
	);

	const [sizeModalProductId, setSizeModalProductId] = useState<number | null>(
		null,
	);

	const [customModalProduct, setCustomModalProduct] = useState<Product | null>(
		null,
	);

	const [pendingCartSelection, setPendingCartSelection] =
		useState<PendingCartSelection | null>(null);

	const [wishlistIds, setWishlistIds] = useState<Set<number>>(
		() => new Set<number>(),
	);

	const [wishlistBusyByProduct, setWishlistBusyByProduct] = useState<
		Record<number, boolean>
	>({});

	useEffect(() => {
		if (!isAuthed) {
			setWishlistIds(new Set<number>());

			return;
		}

		let cancelled = false;

		const loadWishlist = async (): Promise<void> => {
			try {
				const response = await api.get("/products/wishlist/");

				const data = response.data;

				const wishlistProducts: Product[] = Array.isArray(data)
					? data
					: Array.isArray(data?.results)
						? data.results
						: [];

				if (cancelled) {
					return;
				}

				setWishlistIds(new Set(wishlistProducts.map((item) => item.id)));
			} catch (error) {
				console.error("Wishlist load failed:", error);
			}
		};

		void loadWishlist();

		return () => {
			cancelled = true;
		};
	}, [isAuthed]);

	useEffect(() => {
		const params = new URLSearchParams(location.search);

		if (params.get("focusSearch") !== "1") {
			return;
		}

		const timer = window.setTimeout(() => {
			searchInputRef.current?.focus();
		}, 0);

		return () => {
			window.clearTimeout(timer);
		};
	}, [location.search]);

	useEffect(() => {
		setSearchTerm(urlSearch);
	}, [urlSearch]);

	useEffect(() => {
		let cancelled = false;

		const timer = window.setTimeout(() => {
			const loadProducts = async (): Promise<void> => {
				try {
					setLoading(true);
					setLoadError("");

					const params = new URLSearchParams();

					params.set("page_size", "200");

					params.set("ordering", ordering);

					if (category) {
						params.set("category", category);
					}

					if (collection) {
						params.set("collection", collection);
					}

					if (searchTerm.trim()) {
						params.set("search", searchTerm.trim());
					}

					if (minPrice !== "") {
						params.set("min_price", String(minPrice));
					}

					if (maxPrice !== "") {
						params.set("max_price", String(maxPrice));
					}

					let nextUrl = `/products/?${params.toString()}`;

					const collected: Product[] = [];

					let page = 0;

					while (nextUrl && page < 20) {
						page += 1;

						const response = await api.get(nextUrl);

						const data = response.data as unknown;

						if (Array.isArray(data)) {
							collected.push(...(data as Product[]));

							break;
						}

						if (isPaginated<Product>(data)) {
							const results = Array.isArray(data.results) ? data.results : [];

							collected.push(...results);

							nextUrl = data.next ?? "";

							continue;
						}

						break;
					}

					if (cancelled) {
						return;
					}

					setAllProducts(uniqById(collected));

					if (isAuthed) {
						void dispatch(fetchWishlistCount());
					}
				} catch (error) {
					console.error("Products load failed:", error);

					if (cancelled) {
						return;
					}

					setAllProducts([]);

					setLoadError("Could not load products. Check API base URL and CORS.");
				} finally {
					if (!cancelled) {
						setLoading(false);
					}
				}
			};

			void loadProducts();
		}, 250);

		return () => {
			cancelled = true;

			window.clearTimeout(timer);
		};
	}, [
		dispatch,
		isAuthed,
		category,
		collection,
		searchTerm,
		minPrice,
		maxPrice,
		ordering,
	]);

	const products = useMemo<Product[]>(() => {
		return allProducts.slice().sort((a, b) => compareProducts(a, b, ordering));
	}, [allProducts, ordering]);

	const activeSizeModalProduct = useMemo<Product | null>(() => {
		if (sizeModalProductId === null) {
			return null;
		}

		return (
			allProducts.find((product) => product.id === sizeModalProductId) ?? null
		);
	}, [allProducts, sizeModalProductId]);

	const toggleWishlist = async (productId: number): Promise<void> => {
		if (!isAuthed) {
			const next = location.pathname + location.search;

			navigate(`/login-choice?next=${encodeURIComponent(next)}`);

			return;
		}

		if (wishlistBusyByProduct[productId]) {
			return;
		}

		const isActive = wishlistIds.has(productId);

		try {
			setWishlistBusyByProduct((previous) => ({
				...previous,
				[productId]: true,
			}));

			if (isActive) {
				await api.delete(`/products/${productId}/wishlist/`);

				setWishlistIds((previous) => {
					const next = new Set(previous);

					next.delete(productId);

					return next;
				});
			} else {
				await api.post(`/products/${productId}/wishlist/`);

				setWishlistIds((previous) => {
					const next = new Set(previous);

					next.add(productId);

					return next;
				});
			}

			void dispatch(fetchWishlistCount());
		} catch (error) {
			console.error("Wishlist toggle failed:", error);
		} finally {
			setWishlistBusyByProduct((previous) => ({
				...previous,
				[productId]: false,
			}));
		}
	};

	const notifyMe = async (productId: number): Promise<void> => {
		if (!isAuthed && !isValidEmail(guestNotifyEmail)) {
			return;
		}

		try {
			await api.post(`/products/${productId}/subscribe_back_in_stock/`, {
				email: isAuthed ? undefined : normalizeEmail(guestNotifyEmail),
			});

			if (!isAuthed) {
				safeSetSessionEmail(guestNotifyEmail);
			}

			setNotifyModalProduct(null);
		} catch (error) {
			console.error("Restock subscription failed:", error);
		}
	};

	const commitAddToCart = async (
		product: Product,
		sizeId: number,
		measurements?: CustomMeasurements,
		customLengthSelected = false,
	): Promise<void> => {
		if (addBusyByProduct[product.id]) {
			return;
		}

		const picked = getProductSizes(product).find((item) => item.id === sizeId);

		if (!picked) {
			return;
		}

		if (picked.quantity <= 0) {
			window.alert("This size is out of stock.");

			return;
		}

		const customLengthCm = getCustomLengthCm(product);

		const customLengthSurcharge = getCustomLengthSurcharge(product);

		const hasCustomLength =
			product.allows_custom_length === true && customLengthSelected;

		const payload = {
			product_size_id: sizeId,

			quantity: 1,

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

		try {
			setAddBusyByProduct((previous) => ({
				...previous,
				[product.id]: true,
			}));

			if (isAuthed) {
				await dispatch(serverCart.addCartItem(payload)).unwrap();

				await dispatch(serverCart.fetchCart()).unwrap();
			} else {
				dispatch(
					addToCart({
						product,

						...payload,

						sizeName: picked.size.name,

						maxQty: picked.quantity,
					}),
				);
			}

			const trackedValue =
				getPriceNumber(product) + (hasCustomLength ? customLengthSurcharge : 0);

			trackTikTok("AddToCart", {
				content_id: String(product.id),

				content_name: product.name,

				content_type: "product",

				currency: "USD",

				value: trackedValue,
			});
		} catch (error) {
			console.error("Add to cart failed:", error);

			window.alert(getApiErrorMessage(error));
		} finally {
			setAddBusyByProduct((previous) => ({
				...previous,
				[product.id]: false,
			}));
		}
	};

	const continueAfterSize = (
		product: Product,
		sizeId: number,
		measurements?: CustomMeasurements,
	): void => {
		if (product.allows_custom_length === true) {
			setPendingCartSelection({
				product,
				sizeId,
				measurements,
			});

			return;
		}

		void commitAddToCart(product, sizeId, measurements, false);
	};

	const handleAddToCart = (
		product: Product,
		measurements?: CustomMeasurements,
	): void => {
		const sizes = getProductSizes(product)
			.slice()
			.sort((a, b) => compareSizes(a.size.name, b.size.name));

		const availableSizes = sizes.filter((item) => item.quantity > 0);

		if (availableSizes.length === 0) {
			return;
		}

		const onlyCustomSize =
			availableSizes.length === 1 &&
			normalizeSizeLabel(availableSizes[0].size.name) === "CUSTOM SIZE";

		let pickedSizeId = selectedSizeByProduct[product.id];

		if (onlyCustomSize) {
			pickedSizeId = availableSizes[0].id;
		}

		if (!pickedSizeId) {
			setSizeModalProductId(product.id);

			return;
		}

		const picked = sizes.find((item) => item.id === pickedSizeId);

		if (!picked || picked.quantity <= 0) {
			setSizeModalProductId(product.id);

			return;
		}

		const isCustom = normalizeSizeLabel(picked.size.name) === "CUSTOM SIZE";

		if (isCustom && !measurements) {
			setSelectedSizeByProduct((previous) => ({
				...previous,

				[product.id]: pickedSizeId,
			}));

			setSizeModalProductId(null);

			setCustomModalProduct(product);

			return;
		}

		continueAfterSize(product, pickedSizeId, measurements);
	};

	const handleCustomMeasurementsSubmit = (data: CustomMeasurements): void => {
		const product = customModalProduct;

		if (!product) {
			return;
		}

		setCustomModalProduct(null);

		handleAddToCart(product, data);
	};

	const handleStandardLength = (pending: PendingCartSelection): void => {
		setPendingCartSelection(null);

		void commitAddToCart(
			pending.product,
			pending.sizeId,
			pending.measurements,
			false,
		);
	};

	const handleCustomLength = (pending: PendingCartSelection): void => {
		setPendingCartSelection(null);

		void commitAddToCart(
			pending.product,
			pending.sizeId,
			pending.measurements,
			true,
		);
	};

	return (
		<section className="catalog" aria-label="Product catalog">
			{category === "woman" ? (
				<nav className="catalogSubnav" aria-label="Women collections">
					<Link to="/catalog?category=woman&collection=summer">SUMMER</Link>

					<Link to="/catalog?category=woman&collection=sweaters">SWEATERS</Link>

					<Link to="/catalog?category=woman&collection=cardigans">
						CARDIGANS
					</Link>

					<Link to="/catalog?category=woman&collection=dresses">DRESSES</Link>
				</nav>
			) : null}

			<fieldset className="catalogFilters" aria-label="Catalog filters">
				<label className="srOnly" htmlFor="catalog_search">
					Search in catalog
				</label>

				<input
					ref={searchInputRef}
					id="catalog_search"
					className="catalogFilters__input"
					placeholder="Search in catalog..."
					value={searchTerm}
					onChange={(event) => setSearchTerm(event.target.value)}
				/>

				<select
					className="catalogFilters__select"
					value={ordering}
					onChange={(event) => setOrdering(event.target.value as OrderingKey)}
					aria-label="Sort catalog"
				>
					<option value="sort_order">Featured</option>

					<option value="-created_at">Newest first</option>

					<option value="price">Price: low → high</option>

					<option value="-price">Price: high → low</option>

					<option value="name">Name: A → Z</option>

					<option value="-name">Name: Z → A</option>
				</select>

				<fieldset className="catalogFilters__price" aria-label="Price range">
					<label className="srOnly" htmlFor="catalog_min_price">
						Minimum price
					</label>

					<input
						id="catalog_min_price"
						type="number"
						placeholder="Min price"
						value={minPrice}
						onChange={(event) => {
							const value = event.target.value;

							setMinPrice(value === "" ? "" : Number(value));
						}}
						className="
              catalogFilters__input
              catalogFilters__input--price
            "
					/>

					<label className="srOnly" htmlFor="catalog_max_price">
						Maximum price
					</label>

					<input
						id="catalog_max_price"
						type="number"
						placeholder="Max price"
						value={maxPrice}
						onChange={(event) => {
							const value = event.target.value;

							setMaxPrice(value === "" ? "" : Number(value));
						}}
						className="
              catalogFilters__input
              catalogFilters__input--price
            "
					/>
				</fieldset>
			</fieldset>

			{loading ? (
				<div className="catalog__status">Loading products…</div>
			) : null}

			{!loading && loadError ? (
				<div
					className="
            catalog__status
            catalog__status--error
          "
				>
					{loadError}
				</div>
			) : null}

			{!loading && !loadError && products.length === 0 ? (
				<div className="catalog__status">No products found.</div>
			) : null}

			<ul className="catalog__grid" aria-label="Product list">
				{products.map((apiItem) => {
					const isOut = !apiItem.available || !apiItem.in_stock;

					const catalogImages = getCatalogImages(apiItem);

					const hasImageLoop = catalogImages.length > 1;

					const loopImages = hasImageLoop
						? [...catalogImages, catalogImages[0]]
						: catalogImages;

					const addBusy = Boolean(addBusyByProduct[apiItem.id]);

					const wishlistActive = wishlistIds.has(apiItem.id);

					const wishlistBusy = Boolean(wishlistBusyByProduct[apiItem.id]);

					const orderedVariants = getOrderedVariants(apiItem);

					const badge = getProductBadge(apiItem, collection);

					const carouselStyle: CatalogCarouselStyle = {
						"--catalog-image-count": catalogImages.length,
					};

					return (
						<li key={apiItem.id} className="catalog__card">
							<button
								type="button"
								className={`catalog__wishlist-btn ${
									wishlistActive ? "catalog__wishlist-btn--active" : ""
								}`}
								aria-label={
									wishlistActive ? "Remove from wishlist" : "Add to wishlist"
								}
								aria-pressed={wishlistActive}
								disabled={wishlistBusy}
								onClick={() => void toggleWishlist(apiItem.id)}
							>
								<img
									src={wishlistActive ? wishlistIconActive : wishlistIcon}
									alt=""
									aria-hidden="true"
									className="catalog__wishlist-icon"
								/>
							</button>

							<Link
								to={`/product/${apiItem.id}`}
								className="catalog__link"
								aria-label={`Open product: ${apiItem.name}`}
							>
								<div className="catalog__media">
									{badge ? (
										<span className="catalog__badge">{badge}</span>
									) : null}

									<div
										className={`catalog__carousel ${
											hasImageLoop ? "catalog__carousel--loop" : ""
										}`}
										style={carouselStyle}
									>
										{loopImages.map((src, index) => (
											<img
												key={`${apiItem.id}-${src}`}
												src={src}
												alt={index === 0 ? apiItem.name : ""}
												aria-hidden={index === 0 ? undefined : true}
												className="catalog__image"
												loading={index === 0 ? "lazy" : "eager"}
												decoding="async"
												width={900}
												height={1200}
												onError={(event) => {
													event.currentTarget.src = fallbackImg;
												}}
											/>
										))}
									</div>
								</div>
							</Link>

							<div className="catalogCardMeta">
								<div className="catalogCardMeta__name" title={apiItem.name}>
									{apiItem.name}
								</div>

								<div className="catalogCardMeta__price">
									{formatPrice(apiItem)}
								</div>
							</div>

							{orderedVariants.length > 0 ? (
								<fieldset
									className="catalogCardColors"
									aria-label="Available colors"
								>
									{orderedVariants.slice(0, 2).map((variant) => (
										<button
											key={variant.id}
											type="button"
											className={`catalogCardColors__swatch ${
												variant.id === apiItem.id ? "is-active" : ""
											}`}
											title={variant.color_name || variant.name}
											aria-label={variant.color_name || variant.name}
											onClick={() => navigate(`/product/${variant.id}`)}
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
									))}

									{orderedVariants.length > 2 ? (
										<span className="catalogCardColors__more">
											+{orderedVariants.length - 2}
										</span>
									) : null}
								</fieldset>
							) : null}

							<div className="catalog__actions">
								{!isOut ? (
									<button
										type="button"
										className="catalog__addBtn"
										disabled={addBusy}
										onClick={() => handleAddToCart(apiItem)}
									>
										{addBusy ? "Adding..." : "Add to cart"}
									</button>
								) : (
									<button
										type="button"
										className="catalog__notify-btn"
										onClick={() => setNotifyModalProduct(apiItem)}
										aria-label="Get restock alert"
									>
										Get restock alert
									</button>
								)}
							</div>
						</li>
					);
				})}
			</ul>

			{notifyModalProduct ? (
				<NotifyModal
					product={notifyModalProduct}
					isAuthed={isAuthed}
					guestNotifyEmail={guestNotifyEmail}
					onGuestNotifyEmailChange={setGuestNotifyEmail}
					onClose={() => setNotifyModalProduct(null)}
					onConfirm={(productId) => void notifyMe(productId)}
				/>
			) : null}

			{activeSizeModalProduct ? (
				<SizeModal
					product={activeSizeModalProduct}
					selectedSizeId={selectedSizeByProduct[activeSizeModalProduct.id]}
					onSelectSize={(sizeId) =>
						setSelectedSizeByProduct((previous) => ({
							...previous,

							[activeSizeModalProduct.id]: sizeId,
						}))
					}
					onClose={() => setSizeModalProductId(null)}
					onContinue={() => {
						const product = activeSizeModalProduct;

						setSizeModalProductId(null);

						handleAddToCart(product);
					}}
				/>
			) : null}

			{pendingCartSelection ? (
				<CustomLengthModal
					pending={pendingCartSelection}
					onClose={() => setPendingCartSelection(null)}
					onChooseStandard={handleStandardLength}
					onChooseCustom={handleCustomLength}
				/>
			) : null}

			<CustomMeasurementsModal
				open={customModalProduct !== null}
				onClose={() => setCustomModalProduct(null)}
				onSubmit={handleCustomMeasurementsSubmit}
			/>
		</section>
	);
}
