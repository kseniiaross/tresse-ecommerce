import { useEffect, useMemo, useRef, useState } from "react";

import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/axiosInstance";
import fallbackImg from "../assets/images/fallback_product.jpg";

import CustomMeasurementsModal from "../components/CustomMeasurementsModal";
import type { RootState } from "../store";
import * as serverCart from "../store/serverCartSlice";
import type { CartItemDto, GuestCartItem } from "../types/cart";
import {
	addToCart,
	type CustomMeasurements,
	removeFromCart as removeGuestItem,
	selectGuestCartItems,
	updateCustomMeasurements,
	updateQuantity as updateGuestQty,
} from "../utils/cartSlice";
import { useAppDispatch, useAppSelector } from "../utils/hooks";

import "../../styles/Cart.css";

type CustomLengthFields = {
	custom_length_selected?: boolean;
	custom_length_cm?: string | number | null;
	custom_length_surcharge?: string | number | null;
};

type ExtendedServerCartItem = CartItemDto & CustomLengthFields;

type ExtendedGuestCartItem = GuestCartItem & CustomLengthFields;

type MeasurementItem = ExtendedServerCartItem | ExtendedGuestCartItem;

type MetaSize = {
	id: number;
	quantity: number;

	size?: {
		name?: string;
	};
};

const toSafeInt = (value: unknown, fallback = 1): number => {
	const parsed = typeof value === "number" ? value : Number(value);

	if (!Number.isFinite(parsed)) {
		return fallback;
	}

	return Math.trunc(parsed);
};

const clampQty = (quantity: number, maxQty?: number): number => {
	const safeQuantity = Math.max(1, toSafeInt(quantity, 1));

	if (typeof maxQty === "number" && Number.isFinite(maxQty)) {
		return Math.min(safeQuantity, Math.max(1, Math.trunc(maxQty)));
	}

	return safeQuantity;
};

const toMoney = (value: unknown): number => {
	const parsed = typeof value === "number" ? value : Number(value);

	return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeSizeLabel = (name?: string): string => {
	return String(name || "")
		.trim()
		.toUpperCase()
		.replace(/\s+/g, " ");
};

const isCustomSize = (name?: string): boolean => {
	return normalizeSizeLabel(name) === "CUSTOM SIZE";
};

const hasRequiredMeasurements = (item: MeasurementItem): boolean => {
	return Boolean(
		item.custom_bust?.trim() &&
			item.custom_underbust?.trim() &&
			item.custom_waist?.trim() &&
			item.custom_hips?.trim(),
	);
};

const hasCustomLength = (item: MeasurementItem): boolean => {
	return item.custom_length_selected === true;
};

const getCustomLengthSurcharge = (item: MeasurementItem): number => {
	if (!hasCustomLength(item)) {
		return 0;
	}

	return toMoney(item.custom_length_surcharge);
};

const getServerUnitPrice = (item: ExtendedServerCartItem): number => {
	const basePrice = toMoney(item.product_size.product.price);

	return basePrice + getCustomLengthSurcharge(item);
};

const getGuestUnitPrice = (item: ExtendedGuestCartItem): number => {
	const basePrice = toMoney(item.price);

	return basePrice + getCustomLengthSurcharge(item);
};

const getFirstGuestImage = (item: ExtendedGuestCartItem): string | null => {
	const list = item.images;

	if (!Array.isArray(list) || list.length === 0) {
		return null;
	}

	const first = list[0] as Record<string, unknown>;

	if (typeof first.image_url === "string") {
		return first.image_url;
	}

	if (typeof first.image === "string") {
		return first.image;
	}

	return null;
};

const META_PRODUCT_MAP: Record<string, number> = {
	"96arxjauw2": 104,
};

const parseMetaProducts = (raw: string | null) => {
	if (!raw) {
		return [];
	}

	return raw
		.split(",")
		.map((entry) => {
			const [metaId, qtyRaw] = entry.split(":");

			return {
				metaId: metaId.trim(),

				quantity: clampQty(Number(qtyRaw || 1)),
			};
		})
		.filter((item) => Boolean(item.metaId));
};

export default function Cart() {
	const dispatch = useAppDispatch();

	const navigate = useNavigate();

	const location = useLocation();

	const didHandleMetaCartRef = useRef(false);

	const didMergeRef = useRef(false);

	const isAuthed = Boolean(localStorage.getItem("access"));

	const cart = useAppSelector((state: RootState) => state.serverCart.cart);

	const loading = useAppSelector(
		(state: RootState) => state.serverCart.loading,
	);

	const guestItems = useAppSelector(
		selectGuestCartItems,
	) as ExtendedGuestCartItem[];

	const serverItems = (cart?.items ?? []) as ExtendedServerCartItem[];

	const [measurementsItem, setMeasurementsItem] =
		useState<MeasurementItem | null>(null);

	const hasGuest = guestItems.length > 0;

	const hasServer = serverItems.length > 0;

	const usingServer = isAuthed && (hasServer || !hasGuest);

	useEffect(() => {
		if (!isAuthed) {
			return;
		}

		dispatch(serverCart.fetchCart());
	}, [isAuthed, dispatch]);

	useEffect(() => {
		if (!isAuthed || !hasGuest || didMergeRef.current) {
			return;
		}

		didMergeRef.current = true;

		const mergeCart = async () => {
			try {
				await dispatch(serverCart.mergeGuestCart());

				await dispatch(serverCart.fetchCart());
			} catch {
				// Keep guest cart if merge fails.
			}
		};

		void mergeCart();
	}, [isAuthed, hasGuest, dispatch]);

	useEffect(() => {
		if (didHandleMetaCartRef.current) {
			return;
		}

		const params = new URLSearchParams(location.search);

		const metaProducts = parseMetaProducts(params.get("products"));

		if (metaProducts.length === 0) {
			return;
		}

		didHandleMetaCartRef.current = true;

		const importMetaCart = async () => {
			try {
				for (const metaItem of metaProducts) {
					const siteProductId = META_PRODUCT_MAP[metaItem.metaId];

					if (!siteProductId) {
						continue;
					}

					const { data: product } = await api.get(
						`/products/${siteProductId}/`,
					);

					const pickedSize = (product.sizes as MetaSize[] | undefined)?.find(
						(size) => size.quantity > 0,
					);

					if (!pickedSize) {
						continue;
					}

					for (let index = 0; index < metaItem.quantity; index += 1) {
						if (isAuthed) {
							await dispatch(
								serverCart.addCartItem({
									product_size_id: pickedSize.id,
								}),
							).unwrap();
						} else {
							dispatch(
								addToCart({
									product,

									product_size_id: pickedSize.id,

									sizeName: pickedSize.size?.name,

									maxQty: pickedSize.quantity,
								}),
							);
						}
					}
				}

				if (isAuthed) {
					await dispatch(serverCart.fetchCart());
				}

				navigate("/cart", {
					replace: true,
				});
			} catch (error) {
				console.error("Meta cart import failed:", error);
			}
		};

		void importMetaCart();
	}, [location.search, isAuthed, dispatch, navigate]);

	const total = useMemo(() => {
		if (usingServer) {
			return serverItems.reduce((sum, item) => {
				return sum + getServerUnitPrice(item) * item.quantity;
			}, 0);
		}

		return guestItems.reduce((sum, item) => {
			return sum + getGuestUnitPrice(item) * item.quantity;
		}, 0);
	}, [usingServer, serverItems, guestItems]);

	const hasMissingRequiredMeasurements = useMemo(() => {
		if (usingServer) {
			return serverItems.some((item) => {
				const sizeName = item.product_size.size?.name;

				return isCustomSize(sizeName) && !hasRequiredMeasurements(item);
			});
		}

		return guestItems.some((item) => {
			return isCustomSize(item.sizeName) && !hasRequiredMeasurements(item);
		});
	}, [usingServer, serverItems, guestItems]);

	const handleQuantityChange = (
		id: number,
		nextQty: number,
		guestProductSizeId?: number,
		maxQty?: number,
	) => {
		const clamped = clampQty(nextQty, maxQty);

		if (usingServer) {
			dispatch(
				serverCart.updateCartItem({
					item_id: id,
					quantity: clamped,
				}),
			);

			return;
		}

		if (guestProductSizeId == null) {
			return;
		}

		dispatch(
			updateGuestQty({
				id,

				product_size_id: guestProductSizeId,

				quantity: clamped,
			}),
		);
	};

	const handleRemove = (id: number, guestProductSizeId?: number) => {
		if (usingServer) {
			dispatch(serverCart.removeCartItem(id));

			return;
		}

		if (guestProductSizeId == null) {
			return;
		}

		dispatch(
			removeGuestItem({
				id,

				product_size_id: guestProductSizeId,
			}),
		);
	};

	const handleSaveMeasurements = async (data: Required<CustomMeasurements>) => {
		if (!measurementsItem) {
			return;
		}

		if (usingServer) {
			await dispatch(
				serverCart.updateCartItemMeasurements({
					item_id: measurementsItem.id,

					...data,
				}),
			).unwrap();
		} else {
			const guestItem = measurementsItem as ExtendedGuestCartItem;

			dispatch(
				updateCustomMeasurements({
					id: guestItem.id,

					product_size_id: guestItem.product_size_id,

					...data,
				}),
			);
		}

		setMeasurementsItem(null);
	};

	const onPay = () => {
		if (hasMissingRequiredMeasurements) {
			return;
		}

		if (!isAuthed) {
			navigate(`/login-choice?next=${encodeURIComponent("/order")}`);

			return;
		}

		navigate("/order");
	};

	return (
		<section className="cart" aria-label="Shopping cart">
			<header className="cart__head">
				<h1 className="cart__title">Shopping Cart</h1>

				{isAuthed && loading ? <p className="cart__status">Loading…</p> : null}
			</header>

			{usingServer ? (
				serverItems.length === 0 && !(isAuthed && loading) ? (
					<div className="cart__empty" role="status" aria-live="polite">
						<p className="cart__emptyText">Your cart is empty.</p>
					</div>
				) : (
					<>
						<ul className="cart__grid">
							{serverItems.map((item) => {
								const name = item.product_size.product.name;

								const imgSrc =
									item.product_size.product.main_image_url ?? fallbackImg;

								const sizeName = item.product_size.size?.name;

								const maxQty = item.product_size.quantity;

								const itemNeedsMeasurements =
									isCustomSize(sizeName) && !hasRequiredMeasurements(item);

								const customLengthSelected = hasCustomLength(item);

								const customLengthCm = item.custom_length_cm;

								const customLengthSurcharge = getCustomLengthSurcharge(item);

								const unitPrice = getServerUnitPrice(item);

								return (
									<li key={item.id} className="cart-item">
										<div className="cart-item__media">
											<img
												src={imgSrc}
												alt={name}
												className="cart-item__img"
												onError={(event) => {
													event.currentTarget.src = fallbackImg;
												}}
											/>
										</div>

										<div className="cart-item__body">
											<div className="cart-item__row">
												<div className="cart-item__name">{name}</div>

												<button
													type="button"
													className="cart-item__remove"
													onClick={() => handleRemove(item.id)}
												>
													Remove
												</button>
											</div>

											{sizeName || typeof maxQty === "number" ? (
												<div className="cart-item__meta">
													{sizeName ? (
														<span className="cart-item__sub">
															Size: {sizeName}
														</span>
													) : null}

													{typeof maxQty === "number" ? (
														<span className="cart-item__sub">
															In stock: {maxQty}
														</span>
													) : null}
												</div>
											) : null}

											{isCustomSize(sizeName) ? (
												<button
													type="button"
													className={`cart-item__measurements ${
														itemNeedsMeasurements
															? "cart-item__measurements--missing"
															: "cart-item__measurements--done"
													}`}
													onClick={() => setMeasurementsItem(item)}
												>
													{itemNeedsMeasurements
														? "Add measurements"
														: "Edit measurements"}
												</button>
											) : null}

											{customLengthSelected ? (
												<div className="cart-item__custom-length">
													<span className="cart-item__sub">
														Custom length
														{customLengthCm !== null &&
														customLengthCm !== undefined &&
														String(customLengthCm).trim() !== ""
															? `: ${customLengthCm} cm`
															: ""}
													</span>

													{customLengthSurcharge > 0 ? (
														<span className="cart-item__surcharge">
															+$
															{customLengthSurcharge.toFixed(2)}
														</span>
													) : null}
												</div>
											) : null}

											<div
												className={"cart-item__row " + "cart-item__row--bottom"}
											>
												<div className="cart-item__price">
													${unitPrice.toFixed(2)}
												</div>

												<div className="cart-qty">
													<button
														type="button"
														className="cart-qty__btn"
														aria-label={`Decrease quantity for ${name}`}
														disabled={item.quantity <= 1}
														onClick={() =>
															handleQuantityChange(
																item.id,
																item.quantity - 1,
																undefined,
																maxQty,
															)
														}
													>
														−
													</button>

													<input
														className="cart-qty__input"
														type="text"
														inputMode="numeric"
														pattern="\d*"
														aria-label={`Quantity for ${name}`}
														value={item.quantity}
														onChange={(event) => {
															const raw = event.target.value;

															if (raw.trim() === "") {
																handleQuantityChange(
																	item.id,
																	1,
																	undefined,
																	maxQty,
																);

																return;
															}

															const digitsOnly = raw.replace(/[^\d]/g, "");

															handleQuantityChange(
																item.id,

																digitsOnly === "" ? 1 : Number(digitsOnly),

																undefined,
																maxQty,
															);
														}}
													/>

													<button
														type="button"
														className="cart-qty__btn"
														aria-label={`Increase quantity for ${name}`}
														disabled={
															typeof maxQty === "number" &&
															item.quantity >= maxQty
														}
														onClick={() =>
															handleQuantityChange(
																item.id,
																item.quantity + 1,
																undefined,
																maxQty,
															)
														}
													>
														+
													</button>
												</div>
											</div>
										</div>
									</li>
								);
							})}
						</ul>

						<aside className="cart-summary">
							<span className="cart-summary__label">Total</span>

							<span className="cart-summary__total">${total.toFixed(2)}</span>

							<button
								className="cart-summary__pay"
								type="button"
								onClick={onPay}
								disabled={hasMissingRequiredMeasurements}
							>
								Pay
							</button>
						</aside>
					</>
				)
			) : guestItems.length === 0 ? (
				<div className="cart__empty" role="status" aria-live="polite">
					<p className="cart__emptyText">Your cart is empty.</p>
				</div>
			) : (
				<>
					<ul className="cart__grid">
						{guestItems.map((item) => {
							const name = item.name;

							const imgSrc =
								item.main_image_url ?? getFirstGuestImage(item) ?? fallbackImg;

							const sizeName = item.sizeName;

							const maxQty = item.maxQty;

							const itemNeedsMeasurements =
								isCustomSize(sizeName) && !hasRequiredMeasurements(item);

							const customLengthSelected = hasCustomLength(item);

							const customLengthCm = item.custom_length_cm;

							const customLengthSurcharge = getCustomLengthSurcharge(item);

							const unitPrice = getGuestUnitPrice(item);

							return (
								<li
									key={`${item.id}-${item.product_size_id}`}
									className="cart-item"
								>
									<div className="cart-item__media">
										<img
											src={imgSrc}
											alt={name}
											className="cart-item__img"
											onError={(event) => {
												event.currentTarget.src = fallbackImg;
											}}
										/>
									</div>

									<div className="cart-item__body">
										<div className="cart-item__row">
											<div className="cart-item__name">{name}</div>

											<button
												type="button"
												className="cart-item__remove"
												onClick={() =>
													handleRemove(item.id, item.product_size_id)
												}
											>
												Remove
											</button>
										</div>

										{sizeName || typeof maxQty === "number" ? (
											<div className="cart-item__meta">
												{sizeName ? (
													<span className="cart-item__sub">
														Size: {sizeName}
													</span>
												) : null}

												{typeof maxQty === "number" ? (
													<span className="cart-item__sub">
														In stock: {maxQty}
													</span>
												) : null}
											</div>
										) : null}

										{isCustomSize(sizeName) ? (
											<button
												type="button"
												className={`cart-item__measurements ${
													itemNeedsMeasurements
														? "cart-item__measurements--missing"
														: "cart-item__measurements--done"
												}`}
												onClick={() => setMeasurementsItem(item)}
											>
												{itemNeedsMeasurements
													? "Add measurements"
													: "Edit measurements"}
											</button>
										) : null}

										{customLengthSelected ? (
											<div className="cart-item__custom-length">
												<span className="cart-item__sub">
													Custom length
													{customLengthCm !== null &&
													customLengthCm !== undefined &&
													String(customLengthCm).trim() !== ""
														? `: ${customLengthCm} cm`
														: ""}
												</span>

												{customLengthSurcharge > 0 ? (
													<span className="cart-item__surcharge">
														+$
														{customLengthSurcharge.toFixed(2)}
													</span>
												) : null}
											</div>
										) : null}

										<div
											className={"cart-item__row " + "cart-item__row--bottom"}
										>
											<div className="cart-item__price">
												${unitPrice.toFixed(2)}
											</div>

											<div className="cart-qty">
												<button
													type="button"
													className="cart-qty__btn"
													aria-label={`Decrease quantity for ${name}`}
													disabled={item.quantity <= 1}
													onClick={() =>
														handleQuantityChange(
															item.id,
															item.quantity - 1,
															item.product_size_id,
															maxQty,
														)
													}
												>
													−
												</button>

												<input
													className="cart-qty__input"
													type="text"
													inputMode="numeric"
													pattern="\d*"
													aria-label={`Quantity for ${name}`}
													value={item.quantity}
													onChange={(event) => {
														const raw = event.target.value;

														if (raw.trim() === "") {
															handleQuantityChange(
																item.id,
																1,
																item.product_size_id,
																maxQty,
															);

															return;
														}

														const digitsOnly = raw.replace(/[^\d]/g, "");

														handleQuantityChange(
															item.id,

															digitsOnly === "" ? 1 : Number(digitsOnly),

															item.product_size_id,
															maxQty,
														);
													}}
												/>

												<button
													type="button"
													className="cart-qty__btn"
													aria-label={`Increase quantity for ${name}`}
													disabled={
														typeof maxQty === "number" &&
														item.quantity >= maxQty
													}
													onClick={() =>
														handleQuantityChange(
															item.id,
															item.quantity + 1,
															item.product_size_id,
															maxQty,
														)
													}
												>
													+
												</button>
											</div>
										</div>
									</div>
								</li>
							);
						})}
					</ul>

					<aside className="cart-summary">
						<span className="cart-summary__label">Total</span>

						<span className="cart-summary__total">${total.toFixed(2)}</span>

						<button
							className="cart-summary__pay"
							type="button"
							onClick={onPay}
							disabled={hasMissingRequiredMeasurements}
						>
							Pay
						</button>
					</aside>
				</>
			)}

			<CustomMeasurementsModal
				open={Boolean(measurementsItem)}
				initialValues={measurementsItem}
				onClose={() => setMeasurementsItem(null)}
				onSubmit={handleSaveMeasurements}
			/>
		</section>
	);
}
