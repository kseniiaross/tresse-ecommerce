import { useEffect, useRef, useState } from "react";
import { useDialogDismiss } from "../../hooks/useDialogDismiss";
import type { CookieConsentPreferences } from "./cookiePreferences";

type Props = {
	initialPreferences: CookieConsentPreferences;
	onClose: () => void;
	onSave: (preferences: CookieConsentPreferences) => void;
};

export default function CookieSettingsModal({
	initialPreferences,
	onClose,
	onSave,
}: Props) {
	const [analytics, setAnalytics] = useState(initialPreferences.analytics);
	const [marketing, setMarketing] = useState(initialPreferences.marketing);

	const overlayRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLElement>(null);

	useDialogDismiss(overlayRef, contentRef, onClose);

	useEffect(() => {
		// Lock body scroll while the modal is open.
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		return () => {
			document.body.style.overflow = prevOverflow;
		};
	}, []);

	return (
		<div className="cookieModalOverlay" ref={overlayRef}>
			<section
				className="cookieModal"
				ref={contentRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-labelledby="cookie-settings-title"
			>
				<button
					className="cookieModal__close"
					type="button"
					onClick={onClose}
					aria-label="Close"
				>
					×
				</button>

				<h2 id="cookie-settings-title" className="cookieModal__title">
					Cookie Settings
				</h2>

				<p className="cookieModal__text">
					Manage how TRESSE uses optional cookies. Necessary cookies are always
					active because they keep the store secure and functional.
				</p>

				<div className="cookieModal__option">
					<div>
						<h3>Necessary Cookies</h3>
						<p>
							Required for security, checkout, authentication, and core store
							functionality.
						</p>
					</div>
					<span className="cookieModal__always">Always active</span>
				</div>

				<label className="cookieModal__option cookieModal__option--clickable">
					<div>
						<h3>Analytics Cookies</h3>
						<p>
							Help us understand store performance and improve the shopping
							experience.
						</p>
					</div>
					<input
						type="checkbox"
						checked={analytics}
						onChange={(e) => setAnalytics(e.target.checked)}
					/>
				</label>

				<label className="cookieModal__option cookieModal__option--clickable">
					<div>
						<h3>Marketing Cookies</h3>
						<p>
							May be used for personalized offers and advertising if marketing
							tools are enabled.
						</p>
					</div>
					<input
						type="checkbox"
						checked={marketing}
						onChange={(e) => setMarketing(e.target.checked)}
					/>
				</label>

				<div className="cookieModal__actions">
					<button
						className="cookieBtn cookieBtn--ghost"
						type="button"
						onClick={onClose}
					>
						Cancel
					</button>

					<button
						className="cookieBtn cookieBtn--dark"
						type="button"
						onClick={() =>
							onSave({
								necessary: true,
								analytics,
								marketing,
							})
						}
					>
						Save Preferences
					</button>
				</div>
			</section>
		</div>
	);
}
