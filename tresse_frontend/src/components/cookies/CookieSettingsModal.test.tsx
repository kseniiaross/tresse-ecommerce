import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CookieSettingsModal from "./CookieSettingsModal";
import type { CookieConsentPreferences } from "./cookiePreferences";

const initialPreferences: CookieConsentPreferences = {
	necessary: true,
	analytics: false,
	marketing: false,
};

function renderModal(
	preferences: CookieConsentPreferences = initialPreferences,
) {
	const onClose = vi.fn();
	const onSave = vi.fn();

	render(
		<CookieSettingsModal
			initialPreferences={preferences}
			onClose={onClose}
			onSave={onSave}
		/>,
	);

	return { onClose, onSave };
}

beforeEach(() => {
	document.body.style.overflow = "";
});

describe("CookieSettingsModal - dismissal", () => {
	it("calls onClose when Escape is pressed", () => {
		const { onClose } = renderModal();

		fireEvent.keyDown(window, { key: "Escape" });

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("calls onClose on a mousedown on the overlay", () => {
		const { onClose } = renderModal();

		const overlay = document.querySelector(".cookieModalOverlay");
		expect(overlay).not.toBeNull();

		fireEvent.mouseDown(overlay as Element);

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("does not call onClose on a mousedown inside the dialog", () => {
		const { onClose } = renderModal();

		fireEvent.mouseDown(screen.getByRole("dialog"));

		expect(onClose).not.toHaveBeenCalled();
	});

	it("moves focus into the dialog on open", () => {
		renderModal();

		expect(screen.getByRole("dialog")).toHaveFocus();
	});
});

describe("CookieSettingsModal - saving preferences", () => {
	it("calls onSave with the chosen preferences", async () => {
		const user = userEvent.setup();
		const { onSave } = renderModal();

		await user.click(screen.getByRole("checkbox", { name: /analytics/i }));
		await user.click(screen.getByRole("checkbox", { name: /marketing/i }));
		await user.click(screen.getByRole("button", { name: "Save Preferences" }));

		expect(onSave).toHaveBeenCalledWith({
			necessary: true,
			analytics: true,
			marketing: true,
		});
	});

	it("calls onSave with the initial preferences when nothing is changed", async () => {
		const user = userEvent.setup();
		const { onSave } = renderModal({
			necessary: true,
			analytics: true,
			marketing: false,
		});

		await user.click(screen.getByRole("button", { name: "Save Preferences" }));

		expect(onSave).toHaveBeenCalledWith({
			necessary: true,
			analytics: true,
			marketing: false,
		});
	});
});
