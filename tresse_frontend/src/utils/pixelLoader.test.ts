import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	acceptAllCookies,
	rejectOptionalCookies,
} from "../components/cookies/cookiePreferences";

const CONSENT_EVENT = "tresse:cookieConsentUpdated";

async function loadPixelLoader() {
	vi.resetModules();
	return await import("./pixelLoader");
}

function metaScripts() {
	return document.querySelectorAll(
		'script[src^="https://connect.facebook.net/"]',
	);
}

function tiktokScripts() {
	return document.querySelectorAll(
		'script[src^="https://analytics.tiktok.com/"]',
	);
}

beforeEach(() => {
	localStorage.clear();
	document.head.innerHTML = "";
	window.fbq = undefined;
	window.ttq = undefined;
	window.TiktokAnalyticsObject = undefined;
});

describe("initMarketingPixels - without marketing consent", () => {
	it("injects no script when there is no saved consent", async () => {
		const { initMarketingPixels } = await loadPixelLoader();

		initMarketingPixels();

		expect(metaScripts()).toHaveLength(0);
		expect(tiktokScripts()).toHaveLength(0);
	});

	it("injects no script when marketing consent was explicitly rejected", async () => {
		rejectOptionalCookies();
		const { initMarketingPixels } = await loadPixelLoader();

		initMarketingPixels();

		expect(metaScripts()).toHaveLength(0);
		expect(tiktokScripts()).toHaveLength(0);
	});
});

describe("initMarketingPixels - with marketing consent", () => {
	it("injects each script exactly once and initialises it with the expected pixel id", async () => {
		acceptAllCookies();
		const { initMarketingPixels } = await loadPixelLoader();

		initMarketingPixels();

		expect(metaScripts()).toHaveLength(1);
		expect(tiktokScripts()).toHaveLength(1);
		expect(tiktokScripts()[0].getAttribute("src")).toContain(
			"sdkid=D8QLFQJC77UDQUH99PN0",
		);

		const fbqQueue = window.fbq?.queue ?? [];
		expect(fbqQueue).toContainEqual(["init", "4422176017804002"]);
		expect(fbqQueue).toContainEqual(["track", "PageView"]);

		const ttqQueue = window.ttq?._q ?? [];
		expect(ttqQueue.some((entry) => entry[0] === "page")).toBe(true);
	});

	it("does not inject again when initMarketingPixels is called a second time", async () => {
		acceptAllCookies();
		const { initMarketingPixels } = await loadPixelLoader();

		initMarketingPixels();
		initMarketingPixels();

		expect(metaScripts()).toHaveLength(1);
		expect(tiktokScripts()).toHaveLength(1);
	});

	it("does not inject again on a second consent-updated event", async () => {
		acceptAllCookies();
		const { initMarketingPixels } = await loadPixelLoader();

		initMarketingPixels();
		expect(metaScripts()).toHaveLength(1);
		expect(tiktokScripts()).toHaveLength(1);

		window.dispatchEvent(new CustomEvent(CONSENT_EVENT));
		window.dispatchEvent(new CustomEvent(CONSENT_EVENT));

		expect(metaScripts()).toHaveLength(1);
		expect(tiktokScripts()).toHaveLength(1);
	});
});

describe("initMarketingPixels - consent revoked after the scripts loaded", () => {
	it("calls fbq('consent', 'revoke') and ttq.revokeConsent() when consent is rejected afterwards", async () => {
		acceptAllCookies();
		const { initMarketingPixels } = await loadPixelLoader();

		initMarketingPixels();

		const revokeSpy = vi.spyOn(
			window.ttq as NonNullable<Window["ttq"]>,
			"revokeConsent",
		);

		// rejectOptionalCookies() itself dispatches "tresse:cookieConsentUpdated"
		rejectOptionalCookies();

		const fbqQueue = window.fbq?.queue ?? [];
		expect(fbqQueue).toContainEqual(["consent", "revoke"]);
		expect(revokeSpy).toHaveBeenCalled();
	});

	it("does not call revoke when consent was never granted (nothing was loaded)", async () => {
		const { initMarketingPixels } = await loadPixelLoader();

		initMarketingPixels();
		rejectOptionalCookies();

		expect(window.fbq).toBeUndefined();
		expect(window.ttq).toBeUndefined();
	});
});
