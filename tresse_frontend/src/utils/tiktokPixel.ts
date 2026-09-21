import { getCookieConsent } from "../components/cookies/cookiePreferences";

declare global {
	interface Window {
		ttq?: {
			track: (event: string, data?: Record<string, unknown>) => void;
			page?: () => void;
			revokeConsent?: () => void;
			load?: (pixelId: string, options?: Record<string, unknown>) => void;
			methods?: string[];
			setAndDefer?: (target: Record<string, unknown>, method: string) => void;
			_i?: Record<string, unknown[]>;
			_t?: Record<string, number>;
			_o?: Record<string, Record<string, unknown>>;
			_q?: unknown[][];
		};
		TiktokAnalyticsObject?: string;
	}
}

export function trackTikTok(event: string, data?: Record<string, unknown>) {
	if (typeof window === "undefined") return;
	if (!getCookieConsent()?.marketing) return;
	if (!window.ttq?.track) return;

	window.ttq.track(event, data);
}
