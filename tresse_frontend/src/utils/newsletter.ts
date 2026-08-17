import axiosInstance from "../api/axiosInstance";

export type SubscribeSource = "modal" | "footer" | "unknown";

// Persisted timestamps (ms) used to control newsletter modal frequency across sessions.
const DISMISS_KEY = "tresse:newsletter:lastDismissedAt";
const SUBSCRIBED_KEY = "tresse:newsletter:lastSubscribedAt";

const DISMISS_COOLDOWN_DAYS = 14;
const SUBSCRIBED_COOLDOWN_DAYS = 365;

const REQUEST_TIMEOUT_MS = 12_000;

function daysToMs(days: number): number {
	return days * 24 * 60 * 60 * 1000;
}

function canUseLocalStorage(): boolean {
	return (
		typeof window !== "undefined" && typeof window.localStorage !== "undefined"
	);
}

function safeLocalStorageGet(key: string): string | null {
	if (!canUseLocalStorage()) return null;
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function safeLocalStorageSet(key: string, value: string): void {
	if (!canUseLocalStorage()) return;
	try {
		window.localStorage.setItem(key, value);
	} catch {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function isValidEmail(value: string): boolean {
	const email = value.trim();

	if (email.length < 3 || email.length > 254) return false;

	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function markNewsletterDismissed(): void {
	safeLocalStorageSet(DISMISS_KEY, String(Date.now()));
}

export function markNewsletterSubscribed(): void {
	safeLocalStorageSet(SUBSCRIBED_KEY, String(Date.now()));
}

function isCooldownPassed(key: string, cooldownDays: number): boolean {
	const raw = safeLocalStorageGet(key);
	if (!raw) return true;

	const last = Number(raw);
	if (!Number.isFinite(last) || last <= 0) return true;

	return Date.now() - last > daysToMs(cooldownDays);
}

// Centralized visibility rules for newsletter modal.
// Intentionally blocks logged-in users and respects dismiss/subscription cooldowns.
export function canShowNewsletterModal(isLoggedIn: boolean): boolean {
	if (isLoggedIn) return false;

	const subscribedOk = isCooldownPassed(
		SUBSCRIBED_KEY,
		SUBSCRIBED_COOLDOWN_DAYS,
	);
	if (!subscribedOk) return false;

	// respect dismiss cooldown
	return isCooldownPassed(DISMISS_KEY, DISMISS_COOLDOWN_DAYS);
}

// Attempts to extract the most user-friendly error message
// from various backend response formats (DRF-style, field errors, plain strings).
function extractBestErrorMessage(data: unknown): string | null {
	if (isString(data)) return data;

	if (!isRecord(data)) return null;

	const detail = data.detail;
	if (isString(detail)) return detail;

	const nonField = data.non_field_errors;
	if (isStringArray(nonField) && nonField.length > 0) return nonField[0];

	const emailField = data.email;
	if (isStringArray(emailField) && emailField.length > 0) return emailField[0];

	for (const key of Object.keys(data)) {
		const v = data[key];
		if (isStringArray(v) && v.length > 0) return v[0];
	}

	return null;
}

type AxiosishError = {
	code?: unknown;
	message?: unknown;
	response?: { status?: number; data?: unknown };
};

function isAxiosLikeError(err: unknown): err is AxiosishError {
	return (
		isRecord(err) && ("response" in err || "message" in err || "code" in err)
	);
}

function isTimeoutError(err: unknown): boolean {
	if (!isAxiosLikeError(err)) return false;

	const code = err.code;
	if (typeof code === "string" && code.toUpperCase() === "ECONNABORTED")
		return true;

	const msg = err.message;
	if (typeof msg === "string" && msg.toLowerCase().includes("timeout"))
		return true;

	return false;
}

export async function subscribeNewsletter(
	email: string,
	source: SubscribeSource,
): Promise<void> {
	const clean = email.trim();

	if (!isValidEmail(clean)) {
		throw new Error("Please enter a valid email address.");
	}

	try {
		await axiosInstance.post(
			"/newsletter/subscribe/",
			{ email: clean, source },
			{ timeout: REQUEST_TIMEOUT_MS },
		);

		markNewsletterSubscribed();
	} catch (err: unknown) {
		if (isTimeoutError(err)) {
			throw new Error(
				"Server is taking too long to respond. Please try again in a moment.",
			);
		}

		let msg = "Subscription failed. Please try again.";

		if (isAxiosLikeError(err)) {
			const status = err.response?.status;
			const data = err.response?.data;

			const extracted = extractBestErrorMessage(data);
			if (extracted) {
				msg = extracted;
			} else if (typeof status === "number") {
				if (status === 400) msg = "Please check your email and try again.";
				else if (status === 404)
					msg = "Subscribe endpoint not found. Please contact support.";
				else if (status === 405)
					msg = "Subscribe endpoint does not allow this method.";
				else if (status >= 500) msg = "Server error. Please try again later.";
			}
		}

		throw new Error(msg);
	}
}
