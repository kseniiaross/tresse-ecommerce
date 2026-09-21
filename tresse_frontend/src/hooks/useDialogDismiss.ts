import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
	);
}

/**
 * Wires up the standard keyboard/focus behavior for a modal dialog:
 *  - moves focus into the dialog when it opens, and restores it to
 *    whatever was focused beforehand once it closes;
 *  - closes on Escape;
 *  - closes when a click starts on the overlay itself (attached
 *    imperatively via addEventListener, so the overlay stays a plain,
 *    non-interactive backdrop for assistive tech rather than an element
 *    with a JSX onClick/role combo);
 *  - traps Tab/Shift+Tab so focus cycles among the dialog's own
 *    focusable descendants instead of escaping to the page underneath:
 *    Tab on the last descendant wraps to the first, Shift+Tab on the
 *    first wraps to the last, and either from the dialog container
 *    itself (its initial focus target) moves to the first (Tab) or last
 *    (Shift+Tab) descendant. With no focusable descendants, focus stays
 *    on the container.
 *
 * `onClose` is read through a ref that's updated every render, so callers
 * can pass a fresh inline callback each render (as is typical) without the
 * effect re-running — which would otherwise steal focus back to the dialog
 * on every keystroke of an unrelated, lifted-to-parent input.
 *
 * `active` defaults to `true` for dialogs that are only ever mounted while
 * open (mount = open, unmount = closed). Pass `active={open}` explicitly
 * for a dialog component that stays mounted and toggles an `open`/`product`
 * prop instead.
 */
export function useDialogDismiss(
	overlayRef: RefObject<HTMLElement | null>,
	contentRef: RefObject<HTMLElement | null>,
	onClose: () => void,
	active = true,
) {
	const onCloseRef = useRef(onClose);

	useEffect(() => {
		onCloseRef.current = onClose;
	});

	// overlayRef/contentRef are stable RefObjects from the caller's useRef(),
	// and onClose is intentionally tracked via onCloseRef instead — this
	// effect should only re-run when `active` toggles.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
	useEffect(() => {
		if (!active) return;

		const previouslyFocused = document.activeElement as HTMLElement | null;
		contentRef.current?.focus();

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onCloseRef.current();
				return;
			}

			if (e.key !== "Tab") return;

			const container = contentRef.current;
			if (!container) return;

			const focusables = getFocusableElements(container);
			const activeEl = document.activeElement as HTMLElement | null;

			if (focusables.length === 0) {
				e.preventDefault();
				container.focus();
				return;
			}

			const first = focusables[0];
			const last = focusables[focusables.length - 1];

			if (activeEl === container) {
				e.preventDefault();
				(e.shiftKey ? last : first).focus();
				return;
			}

			if (e.shiftKey && activeEl === first) {
				e.preventDefault();
				last.focus();
				return;
			}

			if (!e.shiftKey && activeEl === last) {
				e.preventDefault();
				first.focus();
			}
		};

		const onOverlayMouseDown = (e: MouseEvent) => {
			if (e.target === overlayRef.current) onCloseRef.current();
		};

		window.addEventListener("keydown", onKeyDown);
		overlayRef.current?.addEventListener("mousedown", onOverlayMouseDown);

		return () => {
			window.removeEventListener("keydown", onKeyDown);
			overlayRef.current?.removeEventListener("mousedown", onOverlayMouseDown);
			previouslyFocused?.focus();
		};
		// onClose is deliberately excluded: it's tracked via onCloseRef above
		// so this doesn't re-run just because the caller passed a new
		// function identity (refs are exempt from the dependency check).
	}, [active]);
}
