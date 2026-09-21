import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useDialogDismiss } from "./useDialogDismiss";

function TestDialog({
	onClose,
	focusableCount = 3,
}: {
	onClose: () => void;
	focusableCount?: number;
}) {
	const overlayRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	useDialogDismiss(overlayRef, contentRef, onClose);

	return (
		<div className="overlay" ref={overlayRef}>
			<div className="content" ref={contentRef} tabIndex={-1} role="dialog">
				{Array.from({ length: focusableCount }, (_, i) => (
					<button key={`control-${i}`} type="button">
						{`Control ${i + 1}`}
					</button>
				))}
			</div>
		</div>
	);
}

describe("useDialogDismiss - focus trap", () => {
	it("wraps Tab from the last control to the first", () => {
		render(<TestDialog onClose={vi.fn()} />);

		const first = screen.getByRole("button", { name: "Control 1" });
		const last = screen.getByRole("button", { name: "Control 3" });

		last.focus();
		expect(last).toHaveFocus();

		fireEvent.keyDown(window, { key: "Tab" });

		expect(first).toHaveFocus();
	});

	it("wraps Shift+Tab from the first control to the last", () => {
		render(<TestDialog onClose={vi.fn()} />);

		const first = screen.getByRole("button", { name: "Control 1" });
		const last = screen.getByRole("button", { name: "Control 3" });

		first.focus();
		expect(first).toHaveFocus();

		fireEvent.keyDown(window, { key: "Tab", shiftKey: true });

		expect(last).toHaveFocus();
	});

	it("does not move focus on Tab from a control in the middle", () => {
		render(<TestDialog onClose={vi.fn()} />);

		const middle = screen.getByRole("button", { name: "Control 2" });

		middle.focus();
		fireEvent.keyDown(window, { key: "Tab" });

		// Left to the browser's default tab order, which jsdom doesn't
		// simulate — the trap should simply not have redirected focus away.
		expect(middle).toHaveFocus();
	});

	it("moves Tab from the dialog container itself to the first control", () => {
		render(<TestDialog onClose={vi.fn()} />);

		const dialog = screen.getByRole("dialog");
		const first = screen.getByRole("button", { name: "Control 1" });

		expect(dialog).toHaveFocus();

		fireEvent.keyDown(window, { key: "Tab" });

		expect(first).toHaveFocus();
	});

	it("moves Shift+Tab from the dialog container itself to the last control", () => {
		render(<TestDialog onClose={vi.fn()} />);

		const dialog = screen.getByRole("dialog");
		const last = screen.getByRole("button", { name: "Control 3" });

		expect(dialog).toHaveFocus();

		fireEvent.keyDown(window, { key: "Tab", shiftKey: true });

		expect(last).toHaveFocus();
	});

	it("keeps focus on the container when there are no focusable descendants", () => {
		render(<TestDialog onClose={vi.fn()} focusableCount={0} />);

		const dialog = screen.getByRole("dialog");
		expect(dialog).toHaveFocus();

		fireEvent.keyDown(window, { key: "Tab" });

		expect(dialog).toHaveFocus();
	});
});

describe("useDialogDismiss - existing behaviour is unchanged", () => {
	it("still calls onClose on Escape", () => {
		const onClose = vi.fn();
		render(<TestDialog onClose={onClose} />);

		fireEvent.keyDown(window, { key: "Escape" });

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("still calls onClose on a mousedown on the overlay", () => {
		const onClose = vi.fn();
		const { container } = render(<TestDialog onClose={onClose} />);

		fireEvent.mouseDown(container.querySelector(".overlay") as Element);

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("still does not call onClose on a mousedown inside the content", () => {
		const onClose = vi.fn();
		render(<TestDialog onClose={onClose} />);

		fireEvent.mouseDown(screen.getByRole("dialog"));

		expect(onClose).not.toHaveBeenCalled();
	});

	it("still moves focus into the dialog on mount", () => {
		render(<TestDialog onClose={vi.fn()} />);

		expect(screen.getByRole("dialog")).toHaveFocus();
	});

	it("still restores focus to the previously focused element on unmount", () => {
		const trigger = document.createElement("button");
		trigger.textContent = "Open";
		document.body.appendChild(trigger);
		trigger.focus();
		expect(trigger).toHaveFocus();

		const { unmount } = render(<TestDialog onClose={vi.fn()} />);
		expect(screen.getByRole("dialog")).toHaveFocus();

		unmount();

		expect(trigger).toHaveFocus();
		trigger.remove();
	});
});
