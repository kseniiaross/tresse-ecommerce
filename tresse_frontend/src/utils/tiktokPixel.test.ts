import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/cookies/cookiePreferences", () => ({
	getCookieConsent: vi.fn(),
}));

import { getCookieConsent } from "../components/cookies/cookiePreferences";
import { trackTikTok } from "./tiktokPixel";

const mockedGetCookieConsent = getCookieConsent as unknown as ReturnType<
	typeof vi.fn
>;

beforeEach(() => {
	vi.clearAllMocks();
	window.ttq = undefined;
});

describe("trackTikTok - without marketing consent", () => {
	it("does nothing when there is no saved consent", () => {
		mockedGetCookieConsent.mockReturnValue(null);
		const track = vi.fn();
		window.ttq = { track };

		trackTikTok("ViewContent", { value: 10 });

		expect(track).not.toHaveBeenCalled();
	});

	it("does nothing when marketing consent is false", () => {
		mockedGetCookieConsent.mockReturnValue({
			necessary: true,
			analytics: true,
			marketing: false,
		});
		const track = vi.fn();
		window.ttq = { track };

		trackTikTok("AddToCart", { value: 20 });

		expect(track).not.toHaveBeenCalled();
	});
});

describe("trackTikTok - with marketing consent", () => {
	it("calls through to window.ttq.track with the event name and data", () => {
		mockedGetCookieConsent.mockReturnValue({
			necessary: true,
			analytics: false,
			marketing: true,
		});
		const track = vi.fn();
		window.ttq = { track };

		trackTikTok("Purchase", { value: 99 });

		expect(track).toHaveBeenCalledWith("Purchase", { value: 99 });
	});

	it("does nothing when consent is granted but window.ttq is not present", () => {
		mockedGetCookieConsent.mockReturnValue({
			necessary: true,
			analytics: false,
			marketing: true,
		});

		expect(() => trackTikTok("ViewContent")).not.toThrow();
	});
});
