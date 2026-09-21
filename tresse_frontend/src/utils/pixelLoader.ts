import { getCookieConsent } from "../components/cookies/cookiePreferences";

// Same pixel ids previously hardcoded in index.html.
const META_PIXEL_ID = "4422176017804002";
const META_SCRIPT_ID = "tresse-meta-pixel-script";
const META_SCRIPT_SRC = "https://connect.facebook.net/en_US/fbevents.js";

const TIKTOK_PIXEL_ID = "D8QLFQJC77UDQUH99PN0";
const TIKTOK_SCRIPT_ID = "tresse-tiktok-pixel-script";

const CONSENT_EVENT = "tresse:cookieConsentUpdated";

type FbqFunction = ((...args: unknown[]) => void) & {
	callMethod?: (...args: unknown[]) => void;
	queue?: unknown[];
	push?: FbqFunction;
	loaded?: boolean;
	version?: string;
};

declare global {
	interface Window {
		fbq?: FbqFunction;
		_fbq?: unknown;
	}
}

type TtqStub = NonNullable<Window["ttq"]>;

let metaLoaded = false;
let tiktokLoaded = false;
let listenerAttached = false;

function canUseDom(): boolean {
	return typeof window !== "undefined" && typeof document !== "undefined";
}

// Injects a <script> tag at most once per `id`, regardless of how many
// times this is called.
function injectScript(src: string, id: string): void {
	if (document.getElementById(id)) return;

	const script = document.createElement("script");
	script.id = id;
	script.async = true;
	script.src = src;
	document.head.appendChild(script);
}

// Minimal reimplementation of Meta's bootstrap snippet: defines the fbq
// queue stub (so calls made before fbevents.js finishes loading are
// queued instead of dropped) and points it at the real fbq once loaded.
function ensureFbqStub(): FbqFunction {
	if (typeof window.fbq === "function") return window.fbq;

	const stub = ((...args: unknown[]) => {
		if (stub.callMethod) {
			stub.callMethod(...args);
		} else {
			stub.queue?.push(args);
		}
	}) as FbqFunction;

	stub.push = stub;
	stub.loaded = true;
	stub.version = "2.0";
	stub.queue = [];

	window.fbq = stub;
	if (!window._fbq) window._fbq = stub;

	return stub;
}

function loadMetaPixel(): void {
	if (metaLoaded || !canUseDom()) return;

	const fbq = ensureFbqStub();
	injectScript(META_SCRIPT_SRC, META_SCRIPT_ID);

	fbq("init", META_PIXEL_ID);
	fbq("track", "PageView");

	metaLoaded = true;
}

// Minimal reimplementation of TikTok's bootstrap snippet: defines the
// ttq queue stub with the same method names TikTok's own snippet defines,
// so calls made before events.js finishes loading are queued.
function createTtqStub(): TtqStub {
	const queue: unknown[][] = [];
	const stub: Record<string, unknown> = {};

	const methods = [
		"page",
		"track",
		"identify",
		"debug",
		"on",
		"off",
		"once",
		"ready",
		"alias",
		"group",
		"enableCookie",
		"disableCookie",
		"holdConsent",
		"revokeConsent",
		"grantConsent",
	];

	const setAndDefer = (target: Record<string, unknown>, method: string) => {
		target[method] = (...args: unknown[]) => {
			queue.push([method, ...args]);
		};
	};

	for (const method of methods) {
		setAndDefer(stub, method);
	}

	stub.methods = methods;
	stub.setAndDefer = setAndDefer;
	stub._q = queue;

	stub.load = (id: string, options?: Record<string, unknown>) => {
		const src = "https://analytics.tiktok.com/i18n/pixel/events.js";

		const i = (stub._i as Record<string, unknown[]>) || {};
		i[id] = [];
		stub._i = i;

		const t = (stub._t as Record<string, number>) || {};
		t[id] = Date.now();
		stub._t = t;

		const o = (stub._o as Record<string, Record<string, unknown>>) || {};
		o[id] = options || {};
		stub._o = o;

		injectScript(`${src}?sdkid=${id}&lib=ttq`, TIKTOK_SCRIPT_ID);
	};

	return stub as TtqStub;
}

function ensureTtqStub(): TtqStub {
	if (window.ttq) return window.ttq;

	window.TiktokAnalyticsObject = "ttq";
	window.ttq = createTtqStub();

	return window.ttq;
}

function loadTikTokPixel(): void {
	if (tiktokLoaded || !canUseDom()) return;

	const ttq = ensureTtqStub();
	ttq.load?.(TIKTOK_PIXEL_ID);
	ttq.page?.();

	tiktokLoaded = true;
}

function revokeMarketingConsent(): void {
	if (metaLoaded) window.fbq?.("consent", "revoke");
	if (tiktokLoaded) window.ttq?.revokeConsent?.();
}

function applyConsent(): void {
	if (!canUseDom()) return;

	const consent = getCookieConsent();

	if (consent?.marketing) {
		loadMetaPixel();
		loadTikTokPixel();
	} else {
		revokeMarketingConsent();
	}
}

function attachConsentListener(): void {
	if (listenerAttached || !canUseDom()) return;

	window.addEventListener(CONSENT_EVENT, applyConsent);
	listenerAttached = true;
}

// Call once on app start. Loads the pixels immediately for a returning
// visitor who already granted marketing consent, and re-evaluates consent
// (loading or revoking as needed) every time it changes afterwards.
export function initMarketingPixels(): void {
	if (!canUseDom()) return;

	attachConsentListener();
	applyConsent();
}
