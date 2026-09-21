import { getCookieConsent } from "../components/cookies/cookiePreferences";

export const trackMeta = (
	eventName: string,
	data?: Record<string, unknown>,
) => {
	if (!getCookieConsent()?.marketing) return;

	const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;

	if (typeof fbq !== "function") return;

	fbq("track", eventName, data);
};
