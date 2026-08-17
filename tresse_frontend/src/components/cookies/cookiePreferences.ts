export type CookieConsentPreferences = {
	necessary: true;
	analytics: boolean;
	marketing: boolean;
};

const STORAGE_KEY = "tresse_cookie_consent_v1";

export const defaultCookieConsent: CookieConsentPreferences = {
	necessary: true,
	analytics: false,
	marketing: false,
};

export function getCookieConsent(): CookieConsentPreferences | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;

		const parsed = JSON.parse(raw) as Partial<CookieConsentPreferences>;

		return {
			necessary: true,
			analytics: Boolean(parsed.analytics),
			marketing: Boolean(parsed.marketing),
		};
	} catch {
		return null;
	}
}

export function saveCookieConsent(preferences: CookieConsentPreferences) {
	localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({
			necessary: true,
			analytics: preferences.analytics,
			marketing: preferences.marketing,
			savedAt: new Date().toISOString(),
		}),
	);

	window.dispatchEvent(new CustomEvent("tresse:cookieConsentUpdated"));
}

export function acceptAllCookies() {
	saveCookieConsent({
		necessary: true,
		analytics: true,
		marketing: true,
	});
}

export function rejectOptionalCookies() {
	saveCookieConsent(defaultCookieConsent);
}
