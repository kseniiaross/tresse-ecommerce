import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NewsletterUnsubscribe from "./NewsletterUnsubscribe";

vi.mock("../api/axiosInstance", () => ({
	default: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

vi.mock("../types/token", () => ({
	getAccessToken: vi.fn(() => null),
	isAuthenticated: vi.fn(() => false),
	setAccessToken: vi.fn(),
	setRefreshToken: vi.fn(),
	removeRefreshToken: vi.fn(),
	clearAuthStorage: vi.fn(),
	AUTH_STORAGE_KEYS: { USER_KEY: "auth_user" },
}));

import api from "../api/axiosInstance";

const mockedApi = api as unknown as {
	get: ReturnType<typeof vi.fn>;
	post: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
};

function renderUnsubscribe(token = "valid-token") {
	return render(
		<MemoryRouter initialEntries={[`/newsletter/unsubscribe/${token}`]}>
			<Routes>
				<Route
					path="/newsletter/unsubscribe/:token"
					element={<NewsletterUnsubscribe />}
				/>
			</Routes>
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("NewsletterUnsubscribe - in progress", () => {
	it("shows an in-progress message while the request is pending", () => {
		mockedApi.post.mockReturnValue(new Promise(() => {}));

		renderUnsubscribe();

		expect(
			screen.getByText("Unsubscribing you from the TRESSE newsletter…"),
		).toBeInTheDocument();
	});

	it("calls the unsubscribe endpoint with the token from the URL", async () => {
		mockedApi.post.mockReturnValue(new Promise(() => {}));

		renderUnsubscribe("abc123.signed-token");

		await waitFor(() => {
			expect(mockedApi.post).toHaveBeenCalledWith(
				"/newsletter/unsubscribe/abc123.signed-token/",
			);
		});
	});
});

describe("NewsletterUnsubscribe - success", () => {
	it("shows a success message with the unsubscribed email", async () => {
		mockedApi.post.mockResolvedValueOnce({
			data: { ok: true, email: "jane@example.com" },
		});

		renderUnsubscribe();

		expect(
			await screen.findByText(
				(_, node) =>
					node?.textContent ===
					"You've been unsubscribed. jane@example.com will no longer receive TRESSE newsletter emails.",
			),
		).toBeInTheDocument();
	});

	it("offers a resubscribe action and a link back to the catalog", async () => {
		mockedApi.post.mockResolvedValueOnce({
			data: { ok: true, email: "jane@example.com" },
		});

		renderUnsubscribe();

		expect(
			await screen.findByRole("button", { name: "Resubscribe" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Return to the catalog" }),
		).toHaveAttribute("href", "/catalog");
	});
});

describe("NewsletterUnsubscribe - failure", () => {
	it("shows the server's error message when the token is invalid or expired", async () => {
		mockedApi.post.mockRejectedValueOnce({
			response: { data: { detail: "This unsubscribe link has expired." } },
		});

		renderUnsubscribe();

		expect(
			await screen.findByText("This unsubscribe link has expired."),
		).toBeInTheDocument();
	});

	it("does not offer a resubscribe button on failure", async () => {
		mockedApi.post.mockRejectedValueOnce({
			response: { data: { detail: "This unsubscribe link is invalid." } },
		});

		renderUnsubscribe();

		await screen.findByText("This unsubscribe link is invalid.");

		expect(
			screen.queryByRole("button", { name: "Resubscribe" }),
		).not.toBeInTheDocument();
	});

	it("shows a fallback message and never calls the endpoint when the token is missing", async () => {
		render(
			<MemoryRouter initialEntries={["/newsletter/unsubscribe/"]}>
				<Routes>
					<Route
						path="/newsletter/unsubscribe/:token?"
						element={<NewsletterUnsubscribe />}
					/>
				</Routes>
			</MemoryRouter>,
		);

		expect(
			await screen.findByText(
				"This unsubscribe link is invalid or incomplete.",
			),
		).toBeInTheDocument();
		expect(mockedApi.post).not.toHaveBeenCalled();
	});
});

describe("NewsletterUnsubscribe - resubscribe action", () => {
	it("posts the unsubscribed email to the subscribe endpoint and shows a confirmation", async () => {
		mockedApi.post.mockResolvedValueOnce({
			data: { ok: true, email: "jane@example.com" },
		});
		mockedApi.post.mockResolvedValueOnce({ data: { ok: true } });

		const user = userEvent.setup();
		renderUnsubscribe();

		await user.click(
			await screen.findByRole("button", { name: "Resubscribe" }),
		);

		await waitFor(() => {
			expect(mockedApi.post).toHaveBeenCalledWith(
				"/newsletter/subscribe/",
				{ email: "jane@example.com", source: "unsubscribe" },
				expect.anything(),
			);
		});

		expect(
			await screen.findByText("You're subscribed again. Welcome back."),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Resubscribe" }),
		).not.toBeInTheDocument();
	});

	it("shows an error and keeps the resubscribe button when the subscribe request fails", async () => {
		mockedApi.post.mockResolvedValueOnce({
			data: { ok: true, email: "jane@example.com" },
		});
		mockedApi.post.mockRejectedValueOnce({
			response: { data: { detail: "Subscription failed." } },
		});

		const user = userEvent.setup();
		renderUnsubscribe();

		await user.click(
			await screen.findByRole("button", { name: "Resubscribe" }),
		);

		expect(await screen.findByText("Subscription failed.")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Resubscribe" }),
		).toBeInTheDocument();
	});
});
