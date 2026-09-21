import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OrderHistory from "./OrderHistory";

vi.mock("../api/axiosInstance", () => ({
	default: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

import api from "../api/axiosInstance";

const mockedApi = api as unknown as {
	get: ReturnType<typeof vi.fn>;
	post: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
};

const FIXED_NOW = new Date("2026-08-12T12:00:00.000Z").getTime();

function makeOrder(overrides: Partial<any> = {}) {
	return {
		id: 1,
		public_id: "TR-20260812-ABC123",
		created_at: new Date(FIXED_NOW).toISOString(),
		status: "paid",
		total_amount: "50.00",
		currency: "usd",
		card_brand: "visa",
		card_last4: "4242",
		items: [
			{
				id: 1,
				product_name: "Sweater",
				size: "M",
				quantity: 1,
				unit_price: "50.00",
			},
		],
		...overrides,
	};
}

function renderOrderHistory() {
	return render(
		<MemoryRouter>
			<OrderHistory />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({
		shouldAdvanceTime: true,
	});
	vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("OrderHistory - loading and empty states", () => {
	it("shows an error message when the request fails", async () => {
		mockedApi.get.mockRejectedValueOnce(new Error("network error"));

		renderOrderHistory();

		expect(
			await screen.findByText("Unable to load your orders."),
		).toBeInTheDocument();
	});

	it("shows empty state when there are no orders", async () => {
		mockedApi.get.mockResolvedValueOnce({ data: [] });

		renderOrderHistory();

		expect(
			await screen.findByText("You don’t have any orders yet."),
		).toBeInTheDocument();
	});
});

describe("OrderHistory - order display", () => {
	it("renders order details: public id, status, total, payment method", async () => {
		mockedApi.get.mockResolvedValueOnce({ data: [makeOrder()] });

		renderOrderHistory();

		expect(await screen.findByText("TR-20260812-ABC123")).toBeInTheDocument();
		expect(screen.getByText("Paid")).toBeInTheDocument();
		expect(screen.getAllByText("$50.00").length).toBeGreaterThanOrEqual(2);
		expect(screen.getByText("Visa •••• 4242")).toBeInTheDocument();
	});

	it("falls back to #id when public_id is missing", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [makeOrder({ public_id: "" })],
		});

		renderOrderHistory();

		expect(await screen.findByText("#1")).toBeInTheDocument();
	});

	it("shows 'Card: —' when no card info is available", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [makeOrder({ card_brand: "", card_last4: "" })],
		});

		renderOrderHistory();

		await screen.findByText("TR-20260812-ABC123");
		expect(screen.getByText("Card: —")).toBeInTheDocument();
	});

	it("renders order items with quantity and price", async () => {
		mockedApi.get.mockResolvedValueOnce({ data: [makeOrder()] });

		renderOrderHistory();

		expect(await screen.findByText("Sweater")).toBeInTheDocument();
		expect(screen.getByText("1×")).toBeInTheDocument();
		expect(screen.getByText("M")).toBeInTheDocument();
	});

	it("shows canceled status badge for a canceled order", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [makeOrder({ status: "canceled" })],
		});

		renderOrderHistory();

		expect(await screen.findByText("Canceled")).toBeInTheDocument();
	});

	it("shows pending status badge for a pending order", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [makeOrder({ status: "pending" })],
		});

		renderOrderHistory();

		expect(await screen.findByText("Pending")).toBeInTheDocument();
	});

	it("renders the tracking number and carrier link when present", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [
				makeOrder({
					tracking_number: "9400111899223197428490",
					tracking_carrier: "usps",
					shipped_at: new Date(FIXED_NOW - 24 * 60 * 60 * 1000).toISOString(),
				}),
			],
		});

		renderOrderHistory();

		const trackingLink = await screen.findByRole("link", {
			name: "9400111899223197428490",
		});

		expect(trackingLink).toBeInTheDocument();
		expect(trackingLink.getAttribute("href")).toContain(
			"9400111899223197428490",
		);
		expect(screen.getByText("Shipped")).toBeInTheDocument();
	});

	it("does not render tracking number or link when absent", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [
				makeOrder({
					tracking_number: "",
					tracking_carrier: "",
					shipped_at: "",
				}),
			],
		});

		renderOrderHistory();

		await screen.findByText("TR-20260812-ABC123");
		expect(screen.queryByText("Tracking")).not.toBeInTheDocument();
		expect(screen.queryByText("Shipped")).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /\d/ })).not.toBeInTheDocument();
	});
});

describe("OrderHistory - cancel window (24 hours)", () => {
	it("shows Cancel button for a paid order placed just now", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [makeOrder({ created_at: new Date(FIXED_NOW).toISOString() })],
		});

		renderOrderHistory();

		expect(
			await screen.findByRole("button", { name: /^cancel$/i }),
		).toBeInTheDocument();
	});

	it("hides Cancel button for a paid order older than 24 hours", async () => {
		const oldDate = new Date(FIXED_NOW - 25 * 60 * 60 * 1000).toISOString();
		mockedApi.get.mockResolvedValueOnce({
			data: [makeOrder({ created_at: oldDate })],
		});

		renderOrderHistory();

		await screen.findByText("TR-20260812-ABC123");
		expect(
			screen.queryByRole("button", { name: /^cancel$/i }),
		).not.toBeInTheDocument();
	});

	it("does not show Cancel button for a pending order", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [makeOrder({ status: "pending" })],
		});

		renderOrderHistory();

		await screen.findByText("Pending");
		expect(
			screen.queryByRole("button", { name: /^cancel$/i }),
		).not.toBeInTheDocument();
	});

	it("cancels the order and updates its status in place", async () => {
		mockedApi.get.mockResolvedValueOnce({ data: [makeOrder()] });
		mockedApi.post.mockResolvedValueOnce({
			data: makeOrder({ status: "canceled" }),
		});

		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderOrderHistory();

		const cancelButton = await screen.findByRole("button", {
			name: /^cancel$/i,
		});
		await user.click(cancelButton);

		expect(mockedApi.post).toHaveBeenCalledWith("/orders/1/cancel/", {});
		expect(await screen.findByText("Canceled")).toBeInTheDocument();
	});

	it("shows an error message when cancel fails", async () => {
		mockedApi.get.mockResolvedValueOnce({ data: [makeOrder()] });
		mockedApi.post.mockRejectedValueOnce(new Error("server error"));

		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderOrderHistory();

		const cancelButton = await screen.findByRole("button", {
			name: /^cancel$/i,
		});
		await user.click(cancelButton);

		expect(
			await screen.findByText("Unable to cancel the order. Please try again."),
		).toBeInTheDocument();
	});
});

const DAY_MS = 24 * 60 * 60 * 1000;

const daysAgo = (days: number) =>
	new Date(FIXED_NOW - days * DAY_MS).toISOString();

function makeAxiosError(status: number, detail: string) {
	return Object.assign(new Error(`Request failed with status code ${status}`), {
		isAxiosError: true,
		response: { status, data: { detail } },
	});
}

describe("OrderHistory - return window (14 days from delivery)", () => {
	let confirmSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
	});

	afterEach(() => {
		confirmSpy.mockRestore();
	});

	it("shows Return button within 14 days of delivery", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [makeOrder({ created_at: daysAgo(30), delivered_at: daysAgo(5) })],
		});

		renderOrderHistory();

		expect(
			await screen.findByRole("button", { name: /^return$/i }),
		).toBeInTheDocument();
	});

	it("shows Return button on the last day of the window", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [makeOrder({ delivered_at: daysAgo(14) })],
		});

		renderOrderHistory();

		expect(
			await screen.findByRole("button", { name: /^return$/i }),
		).toBeInTheDocument();
	});

	it("hides Return button when delivered_at is missing, even for a recent order", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [makeOrder({ created_at: daysAgo(1), delivered_at: null })],
		});

		renderOrderHistory();

		await screen.findByText("TR-20260812-ABC123");
		expect(
			screen.queryByRole("button", { name: /return/i }),
		).not.toBeInTheDocument();
	});

	it("hides Return button more than 14 days after delivery, even for a recent order", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [makeOrder({ created_at: daysAgo(1), delivered_at: daysAgo(15) })],
		});

		renderOrderHistory();

		await screen.findByText("TR-20260812-ABC123");
		expect(
			screen.queryByRole("button", { name: /return/i }),
		).not.toBeInTheDocument();
	});

	it("hides Return button once a return has already been requested", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [
				makeOrder({ delivered_at: daysAgo(2), return_status: "requested" }),
			],
		});

		renderOrderHistory();

		await screen.findByText("TR-20260812-ABC123");
		expect(
			screen.queryByRole("button", { name: /return/i }),
		).not.toBeInTheDocument();
		expect(screen.getByText("Requested")).toBeInTheDocument();
	});

	it("asks for confirmation and does not post when it is declined", async () => {
		confirmSpy.mockReturnValue(false);
		mockedApi.get.mockResolvedValueOnce({
			data: [makeOrder({ delivered_at: daysAgo(2) })],
		});

		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderOrderHistory();

		await user.click(await screen.findByRole("button", { name: /^return$/i }));

		expect(confirmSpy).toHaveBeenCalledTimes(1);
		expect(mockedApi.post).not.toHaveBeenCalled();
	});

	it("posts to the return endpoint and shows the return status in place", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [makeOrder({ delivered_at: daysAgo(2) })],
		});
		mockedApi.post.mockResolvedValueOnce({
			data: makeOrder({
				delivered_at: daysAgo(2),
				return_status: "requested",
				return_requested_at: new Date(FIXED_NOW).toISOString(),
			}),
		});

		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderOrderHistory();

		await user.click(await screen.findByRole("button", { name: /^return$/i }));

		expect(confirmSpy).toHaveBeenCalledTimes(1);
		expect(mockedApi.post).toHaveBeenCalledWith("/orders/1/return/", {});
		expect(await screen.findByText("Requested")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /return/i }),
		).not.toBeInTheDocument();
	});

	it("shows the server's message when the return is rejected", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [makeOrder({ delivered_at: daysAgo(2) })],
		});
		mockedApi.post.mockRejectedValueOnce(
			makeAxiosError(400, "Custom-sized items are final sale."),
		);

		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderOrderHistory();

		await user.click(await screen.findByRole("button", { name: /^return$/i }));

		expect(
			await screen.findByText("Custom-sized items are final sale."),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /^return$/i }),
		).toBeInTheDocument();
	});

	it("falls back to a generic message when the failure has no server message", async () => {
		mockedApi.get.mockResolvedValueOnce({
			data: [makeOrder({ delivered_at: daysAgo(2) })],
		});
		mockedApi.post.mockRejectedValueOnce(new Error("network error"));

		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderOrderHistory();

		await user.click(await screen.findByRole("button", { name: /^return$/i }));

		expect(
			await screen.findByText("Unable to request a return. Please try again."),
		).toBeInTheDocument();
	});
});
