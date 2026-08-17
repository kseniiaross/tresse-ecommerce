import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import api from "../api/axiosInstance";

import "../../styles/OrderHistory.css";

type OrderItem = {
	id: number;
	product_name?: string;
	size: string;
	quantity: number;
	unit_price: string;
};

type OrderStatus = "pending" | "paid" | "canceled";

type Order = {
	id: number;
	public_id?: string;
	created_at: string;
	status: OrderStatus;
	total_amount: string;
	currency: string;
	card_brand?: string;
	card_last4?: string;
	items: OrderItem[];
};

const CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

const RETURN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const CLOCK_REFRESH_MS = 60 * 1000;

const formatMoney = (value: string) => {
	const amount = Number(value || 0);

	return `$${amount.toFixed(2)}`;
};

const formatDateTime = (iso: string) =>
	new Date(iso).toLocaleString(undefined, {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});

const titleCase = (value: string) =>
	value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

const getStatusLabel = (status: OrderStatus) => {
	if (status === "paid") {
		return "Paid";
	}

	if (status === "canceled") {
		return "Canceled";
	}

	return "Pending";
};

const getStatusClass = (status: OrderStatus) => {
	if (status === "paid") {
		return "order-history__badge--paid";
	}

	if (status === "canceled") {
		return "order-history__badge--canceled";
	}

	return "order-history__badge--pending";
};

const getCreatedAtMs = (order: Order) => {
	const createdAt = new Date(order.created_at).getTime();

	return Number.isFinite(createdAt) ? createdAt : null;
};

export default function OrderHistory() {
	const navigate = useNavigate();

	const [orders, setOrders] = useState<Order[]>([]);

	const [loading, setLoading] = useState(true);

	const [errorMsg, setErrorMsg] = useState("");

	const [busyId, setBusyId] = useState<number | null>(null);

	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const intervalId = window.setInterval(() => {
			setNow(Date.now());
		}, CLOCK_REFRESH_MS);

		return () => {
			window.clearInterval(intervalId);
		};
	}, []);

	useEffect(() => {
		let cancelled = false;

		const loadOrders = async () => {
			try {
				setErrorMsg("");
				setLoading(true);

				const { data } = await api.get("/orders/my/");

				if (!cancelled) {
					setOrders(Array.isArray(data) ? (data as Order[]) : []);
				}
			} catch {
				if (!cancelled) {
					setErrorMsg("Unable to load your orders.");
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		};

		void loadOrders();

		return () => {
			cancelled = true;
		};
	}, []);

	const isCancelable = useCallback(
		(order: Order) => {
			if (order.status !== "paid") {
				return false;
			}

			const createdAt = getCreatedAtMs(order);

			if (createdAt === null) {
				return false;
			}

			const age = now - createdAt;

			return age >= 0 && age <= CANCEL_WINDOW_MS;
		},
		[now],
	);

	const isReturnable = useCallback(
		(order: Order) => {
			if (order.status !== "paid") {
				return false;
			}

			const createdAt = getCreatedAtMs(order);

			if (createdAt === null) {
				return false;
			}

			const age = now - createdAt;

			return age >= 0 && age <= RETURN_WINDOW_MS;
		},
		[now],
	);

	const getPaymentText = (order: Order) => {
		const last4 = (order.card_last4 || "").trim();

		const brand = (order.card_brand || "").trim();

		if (!last4) {
			return "Card: —";
		}

		const brandLabel = brand ? titleCase(brand) : "Card";

		return `${brandLabel} •••• ${last4}`;
	};

	const cancelOrder = async (orderId: number) => {
		if (busyId !== null) {
			return;
		}

		try {
			setBusyId(orderId);
			setErrorMsg("");

			const { data } = await api.post(`/orders/${orderId}/cancel/`, {});

			setOrders((previous) =>
				previous.map((order) =>
					order.id === orderId ? (data as Order) : order,
				),
			);
		} catch {
			setErrorMsg("Unable to cancel the order. Please try again.");
		} finally {
			setBusyId(null);
		}
	};

	const goToReturns = (order: Order) => {
		const orderReference = (order.public_id || String(order.id)).trim();

		navigate(`/help?topic=return&order=${encodeURIComponent(orderReference)}`);
	};

	const hasOrders = useMemo(() => orders.length > 0, [orders]);

	if (loading) {
		return (
			<section className="order-history" aria-labelledby="order-history-title">
				<div className="order-history__wrap">
					<p
						className="order-history__loading"
						role="status"
						aria-live="polite"
					>
						Loading…
					</p>
				</div>
			</section>
		);
	}

	return (
		<section className="order-history" aria-labelledby="order-history-title">
			<div className="order-history__wrap">
				<header className="order-history__header">
					<h2 id="order-history-title" className="order-history__title">
						My Orders
					</h2>

					<p className="order-history__subtitle">
						Your order history and payment details.
					</p>
				</header>

				{errorMsg ? (
					<p
						className="order-history__error"
						role="alert"
						aria-live="assertive"
					>
						{errorMsg}
					</p>
				) : null}

				{!errorMsg && !hasOrders ? (
					<div className="order-history__empty">
						<p className="order-history__empty-text">
							You don’t have any orders yet.
						</p>
					</div>
				) : null}

				<div className="order-history__list">
					{orders.map((order) => {
						const publicId = (order.public_id || "").trim();

						const canCancel = isCancelable(order);

						const canReturn = isReturnable(order);

						const showActions = canCancel || canReturn;

						return (
							<article className="order-history__card" key={order.id}>
								<div className="order-history__top">
									<div className="order-history__meta">
										<div className="order-history__label">Order</div>

										<div
											className="
                        order-history__value
                        order-history__value--strong
                      "
										>
											{publicId ? publicId : `#${order.id}`}
										</div>
									</div>

									<div className="order-history__meta">
										<div className="order-history__label">Status</div>

										<div
											className={`order-history__badge ${getStatusClass(
												order.status,
											)}`}
										>
											{getStatusLabel(order.status)}
										</div>
									</div>

									<div className="order-history__meta">
										<div className="order-history__label">Total</div>

										<div
											className="
                        order-history__value
                        order-history__value--strong
                      "
										>
											{formatMoney(order.total_amount)}
										</div>
									</div>

									<div className="order-history__meta">
										<div className="order-history__label">Date</div>

										<div
											className="
                        order-history__value
                        order-history__value--date
                      "
										>
											{formatDateTime(order.created_at)}
										</div>
									</div>
								</div>

								<div className="order-history__pay-row">
									<div className="order-history__pay-text">
										<span className="order-history__pay-label">Paid with</span>

										<span className="order-history__pay-value">
											{getPaymentText(order)}
										</span>
									</div>

									{showActions ? (
										<div className="order-history__actions">
											{canCancel ? (
												<button
													type="button"
													className="
                            order-history__btn
                            order-history__btn--danger
                          "
													onClick={() => {
														void cancelOrder(order.id);
													}}
													disabled={busyId !== null}
												>
													{busyId === order.id ? "Canceling…" : "Cancel"}
												</button>
											) : null}

											{canReturn ? (
												<button
													type="button"
													className="
                            order-history__btn
                            order-history__btn--secondary
                          "
													onClick={() => {
														goToReturns(order);
													}}
													disabled={busyId !== null}
												>
													Return
												</button>
											) : null}
										</div>
									) : null}
								</div>

								{order.items?.length > 0 ? (
									<div className="order-history__items">
										<div className="order-history__items-title">Items</div>

										<ul className="order-history__items-list">
											{order.items.map((item) => {
												const name = (item.product_name || "").trim();

												return (
													<li className="order-history__item" key={item.id}>
														<span className="order-history__item-left">
															<span className="order-history__item-qty">
																{item.quantity}×
															</span>

															<span className="order-history__item-name">
																{name || "Item"}
															</span>

															<span className="order-history__item-size">
																{item.size || "One size"}
															</span>
														</span>

														<span className="order-history__item-right">
															{formatMoney(item.unit_price)}
														</span>
													</li>
												);
											})}
										</ul>
									</div>
								) : null}
							</article>
						);
					})}
				</div>
			</div>
		</section>
	);
}
