// src/components/ProductModal.tsx

import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { useDialogDismiss } from "../hooks/useDialogDismiss";
import type { AppDispatch } from "../store";
import * as serverCart from "../store/serverCartSlice";
import type { Product, ProductSizeInline } from "../types/product";
import { getAccessToken } from "../types/token";
import { addToCart as addToGuestCart } from "../utils/cartSlice";

import "../../styles/ProductModal.css";

interface ProductModalProps {
	product: Product | null;
	onClose: () => void;
}

const ProductModal: React.FC<ProductModalProps> = ({ product, onClose }) => {
	const dispatch = useDispatch<AppDispatch>();

	const [selectedSizeId, setSelectedSizeId] = useState<number | null>(null);
	const [notifyLoading, setNotifyLoading] = useState(false);
	const [notifyDone, setNotifyDone] = useState(false);
	const [addBusy, setAddBusy] = useState(false);

	const overlayRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	// Using token presence as a quick auth hint (keeps existing behavior unchanged).
	const isAuthed = !!getAccessToken();

	const availableSizes = useMemo<ProductSizeInline[]>(() => {
		// Product sizes are already typed via Product.sizes.
		return (product?.sizes ?? [])
			.filter((s) => (s?.quantity ?? 0) > 0)
			.slice()
			.sort((a, b) => String(a.size.name).localeCompare(String(b.size.name)));
	}, [product]);

	const isOutOfStock = availableSizes.length === 0;

	const selectedSize = useMemo<ProductSizeInline | undefined>(() => {
		return availableSizes.find((s) => s.id === selectedSizeId);
	}, [availableSizes, selectedSizeId]);

	useDialogDismiss(overlayRef, contentRef, onClose, !!product);

	useEffect(() => {
		if (!product) return;

		// Lock body scroll while modal is open.
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		return () => {
			document.body.style.overflow = prev;
		};
	}, [product]);

	useEffect(() => {
		if (!product) return;

		// Reset local state when product changes.
		setSelectedSizeId(null);
		setNotifyDone(false);
		setNotifyLoading(false);
		setAddBusy(false);
	}, [product]);

	if (!product) return null;

	const handleAdd = async () => {
		// Strict null check (prevents false negatives if id could ever be 0).
		if (selectedSizeId == null) return;
		if (addBusy) return;

		try {
			setAddBusy(true);

			if (isAuthed) {
				await dispatch(
					serverCart.addCartItem({ product_size_id: selectedSizeId }),
				).unwrap();
				await dispatch(serverCart.fetchCart()).unwrap();
			} else {
				dispatch(
					addToGuestCart({
						product,
						product_size_id: selectedSizeId,
						sizeName: selectedSize?.size?.name,
						maxQty: selectedSize?.quantity,
					}),
				);
			}

			onClose();
		} catch (e) {
			// Keeping alert to avoid changing UX flow; swap to toast later if needed.
			console.error("Add to cart (modal) error:", e);
			alert("Could not add to cart.");
		} finally {
			setAddBusy(false);
		}
	};

	const handleNotifyMe = async () => {
		if (!product || notifyLoading) return;

		try {
			setNotifyLoading(true);

			// UI-only stub: keeps existing behavior (no API call yet).
			setNotifyDone(true);
			window.setTimeout(() => setNotifyDone(false), 2500);
		} catch (e) {
			console.error("Notify me error:", e);
		} finally {
			setNotifyLoading(false);
		}
	};

	return (
		<div className="productModal productModal__overlay" ref={overlayRef}>
			<div
				className="productModal__content"
				ref={contentRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-label="Product options"
			>
				<button
					className="productModal__close"
					type="button"
					onClick={onClose}
					aria-label="Close"
				>
					×
				</button>

				<div className="productModal__head">
					<div className="productModal__title" title={product.name}>
						{product.name}
					</div>
					<div className="productModal__price">${product.price}</div>
				</div>

				<div className="productModal__section">
					<div className="productModal__label">Choose size</div>

					{isOutOfStock ? (
						<div className="productModal__muted">Out of stock.</div>
					) : (
						<fieldset className="productModal__sizes" aria-label="Sizes">
							{availableSizes.map((s) => (
								<button
									key={s.id}
									type="button"
									aria-pressed={selectedSizeId === s.id}
									className={`productModal__size ${selectedSizeId === s.id ? "productModal__size--active" : ""}`}
									onClick={() => setSelectedSizeId(s.id)}
									title={`In stock: ${s.quantity}`}
								>
									{s.size?.name}
								</button>
							))}
						</fieldset>
					)}
				</div>

				<div className="productModal__actions">
					<button
						className="productModal__primary"
						type="button"
						disabled={isOutOfStock || selectedSizeId == null || addBusy}
						onClick={() => void handleAdd()}
					>
						{addBusy ? "ADDING..." : "ADD TO CART"}
					</button>

					{isOutOfStock && (
						<button
							className="productModal__notify"
							type="button"
							onClick={handleNotifyMe}
							disabled={notifyLoading}
						>
							{notifyDone
								? "SUBSCRIBED"
								: notifyLoading
									? "SAVING..."
									: "NOTIFY ME"}
						</button>
					)}

					<button
						className="productModal__secondary"
						type="button"
						onClick={onClose}
					>
						CLOSE
					</button>
				</div>
			</div>
		</div>
	);
};

export default ProductModal;
