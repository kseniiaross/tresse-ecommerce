import { type ChangeEvent, useEffect, useMemo, useState } from "react";

import { Link } from "react-router-dom";

import api from "../api/axiosInstance";
import type { RootState } from "../store";
import * as serverCart from "../store/serverCartSlice";
import { useAppDispatch, useAppSelector } from "../utils/hooks";
import { trackTikTok } from "../utils/tiktokPixel";

import "../../styles/Order.css";

const WELCOME_PROMO_CODE = "TRESSE15";

type ServerCartItem = {
	id: number;
	quantity: number;

	custom_length_selected?: boolean;
	custom_length_cm?: string | number | null;
	custom_length_surcharge?: string | number | null;

	product_size: {
		size?: {
			name: string;
		};

		product: {
			id: number;
			name: string;
			price: string;
			main_image_url?: string | null;
		};
	};
};

const toMoney = (value: unknown): number => {
	const parsed = typeof value === "number" ? value : Number(value);

	return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeSizeLabel = (name?: string) =>
	String(name || "")
		.trim()
		.toUpperCase()
		.replace(/\s+/g, " ");

const isCustomSize = (name?: string) =>
	normalizeSizeLabel(name) === "CUSTOM SIZE";

export default function Order() {
	const dispatch = useAppDispatch();

	const serverItems = useAppSelector(
		(state: RootState) =>
			(state.serverCart.cart?.items ?? []) as ServerCartItem[],
	);

	const [loadingCheckout, setLoadingCheckout] = useState(false);
	const [errorMsg, setErrorMsg] = useState("");
	const [promoCopied, setPromoCopied] = useState(false);
	const [isFirstOrder, setIsFirstOrder] = useState<boolean | null>(null);

	const [policyAccepted, setPolicyAccepted] = useState(false);
	const [customFinalSaleAccepted, setCustomFinalSaleAccepted] = useState(false);

	const [policyError, setPolicyError] = useState("");
	const [customFinalSaleError, setCustomFinalSaleError] = useState("");

	useEffect(() => {
		dispatch(serverCart.fetchCart());
	}, [dispatch]);

	useEffect(() => {
		let active = true;

		const checkOrderHistory = async () => {
			try {
				const { data } = await api.get("/orders/my-orders/");

				const orders = Array.isArray(data) ? data : [];

				const hasPaidOrder = orders.some(
					(order) =>
						String(order?.status || "")
							.trim()
							.toLowerCase() === "paid",
				);

				if (active) {
					setIsFirstOrder(!hasPaidOrder);
				}
			} catch {
				if (active) {
					setIsFirstOrder(false);
				}
			}
		};

		checkOrderHistory();

		return () => {
			active = false;
		};
	}, []);

	const cartLines = useMemo(
		() =>
			serverItems.map((item) => {
				const basePrice = toMoney(item.product_size.product.price);

				const customLengthSelected = Boolean(item.custom_length_selected);

				const customLengthSurcharge = customLengthSelected
					? toMoney(item.custom_length_surcharge)
					: 0;

				return {
					productId: item.product_size.product.id,
					name: item.product_size.product.name,
					basePrice,

					customLengthSelected,
					customLengthCm: item.custom_length_cm,
					customLengthSurcharge,

					price: basePrice + customLengthSurcharge,

					quantity: Number(item.quantity ?? 1),

					image: item.product_size.product.main_image_url || "",
					size: item.product_size.size?.name || "",
				};
			}),
		[serverItems],
	);

	const subtotal = useMemo(
		() => cartLines.reduce((acc, item) => acc + item.price * item.quantity, 0),
		[cartLines],
	);

	const hasCustomSizedItems = useMemo(
		() => cartLines.some((item) => isCustomSize(item.size)),
		[cartLines],
	);

	const hasCustomLengthItems = useMemo(
		() => cartLines.some((item) => item.customLengthSelected),
		[cartLines],
	);

	const hasCustomItems = hasCustomSizedItems || hasCustomLengthItems;

	const cartIsEmpty = cartLines.length === 0 || subtotal <= 0;

	const handleCopyPromo = async () => {
		try {
			await navigator.clipboard.writeText(WELCOME_PROMO_CODE);

			setPromoCopied(true);

			window.setTimeout(() => {
				setPromoCopied(false);
			}, 1800);
		} catch {
			setPromoCopied(false);
		}
	};

	const handlePolicyChange = (event: ChangeEvent<HTMLInputElement>) => {
		const checked = event.target.checked;

		setPolicyAccepted(checked);

		if (checked) {
			setPolicyError("");
		}
	};

	const handleCustomFinalSaleChange = (
		event: ChangeEvent<HTMLInputElement>,
	) => {
		const checked = event.target.checked;

		setCustomFinalSaleAccepted(checked);

		if (checked) {
			setCustomFinalSaleError("");
		}
	};

	const handleCheckout = async () => {
		if (cartIsEmpty || loadingCheckout) {
			return;
		}

		let hasConsentError = false;

		if (!policyAccepted) {
			setPolicyError(
				"Please confirm that you have reviewed the Return Policy.",
			);

			hasConsentError = true;
		} else {
			setPolicyError("");
		}

		if (hasCustomItems && !customFinalSaleAccepted) {
			setCustomFinalSaleError(
				"Please confirm that you understand custom items are final sale.",
			);

			hasConsentError = true;
		} else {
			setCustomFinalSaleError("");
		}

		if (hasConsentError) {
			return;
		}

		try {
			setLoadingCheckout(true);
			setErrorMsg("");

			trackTikTok("InitiateCheckout", {
				content_type: "product",
				currency: "USD",
				value: subtotal,

				num_items: cartLines.reduce((sum, item) => sum + item.quantity, 0),

				content_id: cartLines.map((item) => String(item.productId)).join(","),

				content_name: cartLines.map((item) => item.name).join(", "),
			});

			const { data } = await api.post("/orders/create-checkout-session/", {
				policy_accepted: policyAccepted,

				custom_size_final_sale_acknowledged: hasCustomItems
					? customFinalSaleAccepted
					: false,
			});

			if (!data?.url) {
				throw new Error("Missing checkout URL");
			}

			window.location.assign(data.url);
		} catch (error: unknown) {
			const err = error as { response?: { data?: { detail?: string } } };
			setErrorMsg(
				err?.response?.data?.detail ||
					"Checkout could not be prepared. Please try again.",
			);
		} finally {
			setLoadingCheckout(false);
		}
	};

	return (
		<section className="checkout" aria-labelledby="checkout_title">
			<div className="checkout__container">
				<h2 id="checkout_title" className="checkout__title">
					Place your order
				</h2>

				<div className="checkout__grid">
					<aside className="summary" aria-label="Order summary">
						<h3 className="summary__title">Order Summary</h3>

						{cartIsEmpty ? (
							<p className="summary__empty">Your cart is empty</p>
						) : (
							<ul className="summary__list">
								{cartLines.map((item) => (
									<li
										className="summary__item"
										key={
											`${item.productId}-` +
											`${item.name}-` +
											`${item.size}-` +
											`${item.customLengthSelected}`
										}
									>
										<div className="summary__product">
											{item.image ? (
												<img
													src={item.image}
													alt={item.name}
													className="summary__image"
												/>
											) : null}

											<div className="summary__info">
												<span className="summary__name">{item.name}</span>

												{item.size ? (
													<span className="summary__size">
														Size: {item.size}
													</span>
												) : null}

												{item.customLengthSelected ? (
													<span className="summary__size">
														Custom length
														{item.customLengthCm
															? `: ${item.customLengthCm} cm`
															: ""}
														{item.customLengthSurcharge > 0
															? ` (+$${item.customLengthSurcharge.toFixed(2)})`
															: ""}
													</span>
												) : null}
											</div>
										</div>

										<span className="summary__qty">{item.quantity} ×</span>

										<span className="summary__price">
											${item.price.toFixed(2)}
										</span>
									</li>
								))}
							</ul>
						)}

						<div className="summary__total">
							<span className="summary__totalLabel">Subtotal:</span>

							<span className="summary__totalValue">
								${subtotal.toFixed(2)}
							</span>
						</div>

						<p className="summary__tax-note">
							Shipping address and sales tax will be calculated securely at
							checkout.
						</p>
					</aside>

					<section className="panel" aria-label="Checkout panel">
						<div className="checkoutBox">
							<h3 className="checkoutBox__title">Secure checkout</h3>

							<p className="checkoutBox__text">
								You’ll be redirected to Stripe to enter your shipping address
								and payment details securely.
							</p>

							{!cartIsEmpty && isFirstOrder === true ? (
								<section
									className="promoBox"
									aria-label="Welcome discount code"
								>
									<div className="promoBox__content">
										<span className="promoBox__eyebrow">Welcome gift</span>

										<strong className="promoBox__title">
											15% off your first order
										</strong>

										<p className="promoBox__text">
											Use this code in the promotion code field at Stripe
											checkout.
										</p>
									</div>

									<button
										type="button"
										className="promoBox__code"
										onClick={handleCopyPromo}
										aria-label={`Copy promo code ${WELCOME_PROMO_CODE}`}
									>
										{WELCOME_PROMO_CODE}
									</button>

									{promoCopied ? (
										<span
											className="promoBox__copied"
											role="status"
											aria-live="polite"
										>
											Copied
										</span>
									) : null}
								</section>
							) : null}

							{!cartIsEmpty ? (
								<div className="checkoutConsent">
									<label className="checkoutConsent__label">
										<input
											className="checkoutConsent__input"
											type="checkbox"
											checked={policyAccepted}
											onChange={handlePolicyChange}
											aria-invalid={Boolean(policyError)}
											aria-describedby={
												policyError ? "checkout_policy_error" : undefined
											}
										/>

										<span className="checkoutConsent__box" aria-hidden="true" />

										<span className="checkoutConsent__text">
											I have reviewed the{" "}
											<Link
												className="checkoutConsent__link"
												to="/policies/return-policy"
												target="_blank"
												rel="noopener noreferrer"
											>
												Return Policy
											</Link>{" "}
											and agree to the applicable return conditions.
										</span>
									</label>

									{policyError ? (
										<p
											id="checkout_policy_error"
											className="checkoutConsent__error"
											role="alert"
										>
											{policyError}
										</p>
									) : null}

									{hasCustomItems ? (
										<div className="checkoutConsent__custom">
											<label className="checkoutConsent__label">
												<input
													className="checkoutConsent__input"
													type="checkbox"
													checked={customFinalSaleAccepted}
													onChange={handleCustomFinalSaleChange}
													aria-invalid={Boolean(customFinalSaleError)}
													aria-describedby={
														customFinalSaleError
															? "checkout_custom_final_sale_error"
															: undefined
													}
												/>

												<span
													className="checkoutConsent__box"
													aria-hidden="true"
												/>

												<span className="checkoutConsent__text">
													I understand that custom items, including custom
													sizing or custom length, are made specifically to my
													requested specifications and are final sale.
												</span>
											</label>

											{customFinalSaleError ? (
												<p
													id="checkout_custom_final_sale_error"
													className="checkoutConsent__error"
													role="alert"
												>
													{customFinalSaleError}
												</p>
											) : null}
										</div>
									) : null}
								</div>
							) : null}

							<button
								className="button"
								type="button"
								disabled={
									cartIsEmpty ||
									loadingCheckout ||
									!policyAccepted ||
									(hasCustomItems && !customFinalSaleAccepted)
								}
								onClick={handleCheckout}
							>
								{loadingCheckout
									? "Preparing checkout…"
									: "Continue to payment"}
							</button>

							{errorMsg ? (
								<p
									className="message message--error"
									role="alert"
									aria-live="assertive"
								>
									{errorMsg}
								</p>
							) : null}
						</div>
					</section>
				</div>
			</div>
		</section>
	);
}
