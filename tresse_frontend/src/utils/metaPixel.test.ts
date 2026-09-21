import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/cookies/cookiePreferences", () => ({
	getCookieConsent: vi.fn(),
}));

import { getCookieConsent } from "../components/cookies/cookiePreferences";
import { trackMeta } from "./metaPixel";

const mockedGetCookieConsent = getCookieConsent as unknown as ReturnType<
	typeof vi.fn
>;

beforeEach(() => {
	vi.clearAllMocks();
	delete (window as unknown as { fbq?: unknown }).fbq;
});

describe("trackMeta - without marketing consent", () => {
	it("does nothing when there is no saved consent", () => {
		mockedGetCookieConsent.mockReturnValue(null);
		const fbq = vi.fn();
		(window as unknown as { fbq: typeof fbq }).fbq = fbq;

		trackMeta("ViewContent", { value: 10 });

		expect(fbq).not.toHaveBeenCalled();
	});

	it("does nothing when marketing consent is false", () => {
		mockedGetCookieConsent.mockReturnValue({
			necessary: true,
			analytics: true,
			marketing: false,
		});
		const fbq = vi.fn();
		(window as unknown as { fbq: typeof fbq }).fbq = fbq;

		trackMeta("AddToCart", { value: 20 });

		expect(fbq).not.toHaveBeenCalled();
	});
});

describe("trackMeta - with marketing consent", () => {
	it("calls through to window.fbq with the event name and data", () => {
		mockedGetCookieConsent.mockReturnValue({
			necessary: true,
			analytics: false,
			marketing: true,
		});
		const fbq = vi.fn();
		(window as unknown as { fbq: typeof fbq }).fbq = fbq;

		trackMeta("Purchase", { value: 99 });

		expect(fbq).toHaveBeenCalledWith("track", "Purchase", { value: 99 });
	});

	it("does nothing when consent is granted but fbq is not present", () => {
		mockedGetCookieConsent.mockReturnValue({
			necessary: true,
			analytics: false,
			marketing: true,
		});

		expect(() => trackMeta("ViewContent")).not.toThrow();
	});
});
