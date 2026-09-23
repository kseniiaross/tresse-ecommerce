import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

// setAccessToken/setRefreshToken are spied on (not delegated to real
// storage) so tests can assert on what was stored without depending on
// localStorage state; getAccessToken/getRefreshToken are controlled per
// test to script what's "currently in storage" when a refresh is needed.
vi.mock("../types/token", () => ({
	getAccessToken: vi.fn(),
	getRefreshToken: vi.fn(),
	setAccessToken: vi.fn(),
	setRefreshToken: vi.fn(),
}));

import {
	getAccessToken,
	getRefreshToken,
	setAccessToken,
	setRefreshToken,
} from "../types/token";
import axiosInstance, { setOnUnauthorized } from "./axiosInstance";

const mockedGetAccessToken = getAccessToken as unknown as ReturnType<
	typeof vi.fn
>;
const mockedGetRefreshToken = getRefreshToken as unknown as ReturnType<
	typeof vi.fn
>;
const mockedSetAccessToken = setAccessToken as unknown as ReturnType<
	typeof vi.fn
>;
const mockedSetRefreshToken = setRefreshToken as unknown as ReturnType<
	typeof vi.fn
>;

// A scriptable fake transport so requests through `axiosInstance` never hit
// the network, and the real (unmocked) interceptors run against it exactly
// as they would in production.
type FakeAdapter = (config: InternalAxiosRequestConfig) => Promise<unknown>;

let currentAdapter: FakeAdapter = () =>
	Promise.resolve({ data: {}, status: 200, statusText: "", headers: {} });

// @ts-expect-error — test-only override of axios's adapter config.
axiosInstance.defaults.adapter = (config: InternalAxiosRequestConfig) =>
	currentAdapter(config);

// Adapters are only responsible for the transport step — real ones (xhr,
// http) reject with an AxiosError themselves for a non-2xx status; axios's
// core dispatch doesn't do that validation for you. Mirror that here so the
// response interceptor under test sees exactly what it would in production.
function respond(status: number, data: unknown = {}): FakeAdapter {
	return (config) => {
		const response = { data, status, statusText: "", headers: {}, config };

		if (status >= 200 && status < 300) {
			return Promise.resolve(response);
		}

		return Promise.reject(
			new AxiosError(
				`Request failed with status code ${status}`,
				undefined,
				config,
				undefined,
				response as any,
			),
		);
	};
}

// Matches by substring against config.url, since axios may or may not have
// already combined baseURL into it by the time the adapter runs.
function scriptByUrl(script: Record<string, FakeAdapter[]>): FakeAdapter {
	const counts: Record<string, number> = {};
	return (config) => {
		const url = String(config.url ?? "");
		const key = Object.keys(script).find((k) => url.includes(k)) ?? "";
		const calls = script[key] ?? [];
		const i = counts[key] ?? 0;
		counts[key] = i + 1;
		const fn = calls[i] ?? calls[calls.length - 1] ?? respond(200, {});
		return fn(config);
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	setOnUnauthorized(null);
	mockedGetAccessToken.mockReturnValue("old-access");
	mockedGetRefreshToken.mockReturnValue("old-refresh");
});

describe("axiosInstance - 401 on a protected request", () => {
	it("refreshes exactly once and replays the original request", async () => {
		const postSpy = vi.spyOn(axios, "post").mockResolvedValueOnce({
			data: { access: "new-access", refresh: "new-refresh" },
		});

		currentAdapter = scriptByUrl({
			"/accounts/profile/": [
				respond(401, { detail: "Expired" }),
				respond(200, { ok: true }),
			],
		});

		const res = await axiosInstance.get("/accounts/profile/");

		expect(res.status).toBe(200);
		expect(res.data).toEqual({ ok: true });
		expect(postSpy).toHaveBeenCalledTimes(1);
		expect(postSpy).toHaveBeenCalledWith(
			expect.stringContaining("/accounts/token/refresh/"),
			{ refresh: "old-refresh" },
		);
	});

	it("stores the rotated access and refresh tokens", async () => {
		vi.spyOn(axios, "post").mockResolvedValueOnce({
			data: { access: "new-access", refresh: "new-refresh" },
		});
		currentAdapter = scriptByUrl({
			"/accounts/profile/": [respond(401), respond(200, {})],
		});

		await axiosInstance.get("/accounts/profile/");

		expect(mockedSetAccessToken).toHaveBeenCalledWith("new-access");
		expect(mockedSetRefreshToken).toHaveBeenCalledWith("new-refresh");
	});

	it("shares a single in-flight refresh across two concurrent 401s", async () => {
		let resolveRefresh!: (v: unknown) => void;
		const refreshPromise = new Promise((resolve) => {
			resolveRefresh = resolve;
		});
		const postSpy = vi
			.spyOn(axios, "post")
			.mockReturnValueOnce(refreshPromise as ReturnType<typeof axios.post>);

		currentAdapter = scriptByUrl({
			"/accounts/profile/": [respond(401), respond(200, { who: "profile" })],
			"/accounts/orders/": [respond(401), respond(200, { who: "orders" })],
		});

		const p1 = axiosInstance.get("/accounts/profile/");
		const p2 = axiosInstance.get("/accounts/orders/");

		// Let both 401s land and queue on the in-flight refresh before it
		// resolves.
		await new Promise((r) => setTimeout(r, 0));
		resolveRefresh({ data: { access: "new-access" } });

		const [r1, r2] = await Promise.all([p1, p2]);

		expect(postSpy).toHaveBeenCalledTimes(1);
		expect(r1.data).toEqual({ who: "profile" });
		expect(r2.data).toEqual({ who: "orders" });
	});

	it("calls onUnauthorized exactly once when the refresh itself fails, for concurrent 401s", async () => {
		const onUnauthorized = vi.fn();
		setOnUnauthorized(onUnauthorized);

		vi.spyOn(axios, "post").mockRejectedValueOnce(new Error("refresh failed"));

		currentAdapter = scriptByUrl({
			"/accounts/profile/": [respond(401)],
			"/accounts/orders/": [respond(401)],
		});

		const results = await Promise.allSettled([
			axiosInstance.get("/accounts/profile/"),
			axiosInstance.get("/accounts/orders/"),
		]);

		expect(results.every((r) => r.status === "rejected")).toBe(true);
		expect(onUnauthorized).toHaveBeenCalledTimes(1);
	});

	it("calls onUnauthorized when no refresh token is stored", async () => {
		const onUnauthorized = vi.fn();
		setOnUnauthorized(onUnauthorized);
		mockedGetRefreshToken.mockReturnValue(null);

		const postSpy = vi.spyOn(axios, "post");
		currentAdapter = scriptByUrl({
			"/accounts/profile/": [respond(401)],
		});

		await expect(axiosInstance.get("/accounts/profile/")).rejects.toBeTruthy();

		expect(postSpy).not.toHaveBeenCalled();
		expect(onUnauthorized).toHaveBeenCalledTimes(1);
	});
});

describe("axiosInstance - NO_AUTH routes", () => {
	it("never attempts a refresh for a 401 on a NO_AUTH path", async () => {
		const onUnauthorized = vi.fn();
		setOnUnauthorized(onUnauthorized);
		const postSpy = vi.spyOn(axios, "post");

		currentAdapter = scriptByUrl({
			"/accounts/login/": [respond(401, { detail: "Invalid credentials" })],
		});

		await expect(
			axiosInstance.post("/accounts/login/", {}),
		).rejects.toBeTruthy();

		expect(postSpy).not.toHaveBeenCalled();
		expect(onUnauthorized).not.toHaveBeenCalled();
	});
});
