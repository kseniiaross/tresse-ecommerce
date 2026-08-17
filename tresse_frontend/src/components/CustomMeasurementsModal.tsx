import { useEffect, useRef, useState } from "react";
import { useDialogDismiss } from "../hooks/useDialogDismiss";
import type { CustomMeasurements } from "../utils/cartSlice";
import "../../styles/CustomMeasurementsModal.css";

type Props = {
	open: boolean;
	initialValues?: CustomMeasurements | null;
	onClose: () => void;
	onSubmit: (data: Required<CustomMeasurements>) => void;
};

const empty: Required<CustomMeasurements> = {
	custom_bust: "",
	custom_underbust: "",
	custom_waist: "",
	custom_hips: "",
	custom_height: "",
	custom_cup: "",
	custom_fit_notes: "",
};

const normalizeInitial = (
	values?: CustomMeasurements | null,
): Required<CustomMeasurements> => ({
	custom_bust: values?.custom_bust ?? "",
	custom_underbust: values?.custom_underbust ?? "",
	custom_waist: values?.custom_waist ?? "",
	custom_hips: values?.custom_hips ?? "",
	custom_height: values?.custom_height ?? "",
	custom_cup: values?.custom_cup ?? "",
	custom_fit_notes: values?.custom_fit_notes ?? "",
});

export default function CustomMeasurementsModal({
	open,
	initialValues,
	onClose,
	onSubmit,
}: Props) {
	const [form, setForm] = useState<Required<CustomMeasurements>>(empty);

	const overlayRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		setForm(normalizeInitial(initialValues));
	}, [open, initialValues]);

	useDialogDismiss(overlayRef, contentRef, onClose, open);

	useEffect(() => {
		if (!open) return;

		// Lock body scroll while the modal is open.
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		return () => {
			document.body.style.overflow = prevOverflow;
		};
	}, [open]);

	if (!open) return null;

	const requiredFilled =
		form.custom_bust.trim() &&
		form.custom_underbust.trim() &&
		form.custom_waist.trim() &&
		form.custom_hips.trim();

	return (
		<div className="customModal__overlay" ref={overlayRef}>
			<div
				className="customModal"
				ref={contentRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-labelledby="customModalTitle"
			>
				<div className="customModal__header">
					<h2 id="customModalTitle" className="customModal__title">
						Custom Sizing
					</h2>

					<button
						type="button"
						className="customModal__close"
						onClick={onClose}
						aria-label="Close"
					>
						×
					</button>
				</div>

				<div className="customModal__grid">
					<input
						className="customModal__input"
						placeholder="Bust / Chest *"
						value={form.custom_bust}
						onChange={(e) => setForm({ ...form, custom_bust: e.target.value })}
					/>

					<input
						className="customModal__input"
						placeholder="Underbust *"
						value={form.custom_underbust}
						onChange={(e) =>
							setForm({ ...form, custom_underbust: e.target.value })
						}
					/>

					<input
						className="customModal__input"
						placeholder="Waist *"
						value={form.custom_waist}
						onChange={(e) => setForm({ ...form, custom_waist: e.target.value })}
					/>

					<input
						className="customModal__input"
						placeholder="Hips *"
						value={form.custom_hips}
						onChange={(e) => setForm({ ...form, custom_hips: e.target.value })}
					/>

					<input
						className="customModal__input"
						placeholder="Height (optional)"
						value={form.custom_height}
						onChange={(e) =>
							setForm({ ...form, custom_height: e.target.value })
						}
					/>

					<input
						className="customModal__input"
						placeholder="Cup Size (optional)"
						value={form.custom_cup}
						onChange={(e) => setForm({ ...form, custom_cup: e.target.value })}
					/>

					<textarea
						className="customModal__textarea"
						placeholder="Fit Notes (optional)"
						value={form.custom_fit_notes}
						onChange={(e) =>
							setForm({ ...form, custom_fit_notes: e.target.value })
						}
					/>
				</div>

				<p className="customModal__note">
					* Bust, underbust, waist and hips are required for custom-made
					swimwear.
				</p>

				<button
					type="button"
					className="customModal__button"
					disabled={!requiredFilled}
					onClick={() => onSubmit(form)}
				>
					Save Measurements
				</button>
			</div>
		</div>
	);
}
