export const trackMeta = (
	eventName: string,
	data?: Record<string, unknown>,
) => {
	const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;

	if (typeof fbq !== "function") return;

	fbq("track", eventName, data);
};
