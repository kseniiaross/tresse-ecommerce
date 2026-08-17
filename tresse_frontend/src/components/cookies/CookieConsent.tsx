import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import CookieSettingsModal from "./CookieSettingsModal";
import {
	acceptAllCookies,
	type CookieConsentPreferences,
	defaultCookieConsent,
	getCookieConsent,
	rejectOptionalCookies,
	saveCookieConsent,
} from "./cookiePreferences";

export default function CookieConsent() {
	const [visible, setVisible] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [preferences, setPreferences] =
		useState<CookieConsentPreferences>(defaultCookieConsent);

	useEffect(() => {
		const saved = getCookieConsent();

		if (saved) {
			setPreferences(saved);
			setVisible(false);
		} else {
			setVisible(true);
		}
	}, []);

	const handleAcceptAll = () => {
		acceptAllCookies();
		setPreferences({
			necessary: true,
			analytics: true,
			marketing: true,
		});
		setVisible(false);
	};

	const handleRejectOptional = () => {
		rejectOptionalCookies();
		setPreferences(defaultCookieConsent);
		setVisible(false);
	};

	const handleSavePreferences = (next: CookieConsentPreferences) => {
		saveCookieConsent(next);
		setPreferences(next);
		setSettingsOpen(false);
		setVisible(false);
	};

	if (!visible && !settingsOpen) return null;

	return (
		<>
			{visible ? (
				<section className="cookieConsent" aria-label="Cookie consent">
					<div className="cookieConsent__content">
						<h2 className="cookieConsent__title">Cookies</h2>

						<p className="cookieConsent__text">
							We use necessary cookies to keep TRESSE secure and functional.
							Optional analytics and marketing cookies help us improve your
							experience. Read our{" "}
							<Link
								to="/policies/cookie-policy"
								className="cookieConsent__link"
							>
								Cookie Policy
							</Link>
							.
						</p>
					</div>

					<div className="cookieConsent__actions">
						<button
							className="cookieBtn cookieBtn--ghost"
							type="button"
							onClick={handleRejectOptional}
						>
							Reject Optional
						</button>

						<button
							className="cookieBtn cookieBtn--light"
							type="button"
							onClick={() => setSettingsOpen(true)}
						>
							Cookie Settings
						</button>

						<button
							className="cookieBtn cookieBtn--dark"
							type="button"
							onClick={handleAcceptAll}
						>
							Accept All
						</button>
					</div>
				</section>
			) : null}

			{settingsOpen ? (
				<CookieSettingsModal
					initialPreferences={preferences}
					onClose={() => setSettingsOpen(false)}
					onSave={handleSavePreferences}
				/>
			) : null}
		</>
	);
}
