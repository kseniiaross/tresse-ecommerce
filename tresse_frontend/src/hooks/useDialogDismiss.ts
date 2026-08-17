import { type RefObject, useEffect, useRef } from "react";

/**
 * Wires up the standard keyboard/focus behavior for a modal dialog:
 *  - moves focus into the dialog when it opens, and restores it to
 *    whatever was focused beforehand once it closes;
 *  - closes on Escape;
 *  - closes when a click starts on the overlay itself (attached
 *    imperatively via addEventListener, so the overlay stays a plain,
 *    non-interactive backdrop for assistive tech rather than an element
 *    with a JSX onClick/role combo).
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
			if (e.key === "Escape") onCloseRef.current();
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
