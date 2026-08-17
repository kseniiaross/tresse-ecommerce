declare global {
	interface Window {
		ttq?: {
			track: (event: string, data?: Record<string, unknown>) => void;
			page?: () => void;
		};
	}
}

export function trackTikTok(event: string, data?: Record<string, unknown>) {
	if (typeof window === "undefined") return;
	if (!window.ttq?.track) return;

	window.ttq.track(event, data);
}
