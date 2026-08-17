export const toHttps = (url?: string | null): string | undefined => {
	if (url == null) return undefined;

	const v = String(url).trim();
	if (!v) return undefined;

	if (v.startsWith("https://")) return v;
	if (v.startsWith("http://")) return `https://${v.slice("http://".length)}`;
	if (v.startsWith("//")) return `https:${v}`;

	return v;
};
