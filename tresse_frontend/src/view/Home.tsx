import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";

import "../../styles/Home.css";

import discountVideo from "../assets/images/home_page/15_first_order.mp4";
import discountVideoMobile from "../assets/images/home_page/15_first_order_mob.mp4";
import homePageOne from "../assets/images/home_page/home_page1.webp";
import homePageTwo from "../assets/images/home_page/home_page2.webp";
import homePageThree from "../assets/images/home_page/home_page3.webp";
import type { RootState } from "../store";
import {
	canShowNewsletterModal,
	isValidEmail,
	markNewsletterDismissed,
	subscribeNewsletter,
} from "../utils/newsletter";

const COLUMN_STEP_MS = 1000;
const CYCLE_PAUSE_MS = 2000;

const POLICY_PRIVACY = "/policies/privacy-policy";
const POLICY_TERMS = "/policies/terms-of-service";
const WOMEN_CATALOG_PATH = "/catalog?category=woman";
const SUMMER_COLLECTION_PATH = "/catalog?category=woman&collection=summer";

type ImageGlob = Record<string, string>;

const allImages = import.meta.glob(
	"../assets/images/home_page/*.{jpg,jpeg,png,webp,avif}",
	{
		eager: true,
		query: "?url",
		import: "default",
	},
) as ImageGlob;

function pickHeroImages(): string[] {
	return Object.entries(allImages)
		.filter(([path]) => path.includes("/hero_"))
		.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
		.map(([, url]) => url);
}

function rotateImages(images: string[], offset: number): string[] {
	if (!images.length) return [""];

	return images.map((_, index) => images[(index + offset) % images.length]);
}

const heroImages = pickHeroImages();

const columns = [
	rotateImages(heroImages, 0),
	rotateImages(heroImages, 3),
	rotateImages(heroImages, 6),
];

function focusFirstPageElement() {
	const first = document.querySelector<HTMLElement>(
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
	);

	first?.focus?.();
}

function getModalFocusableElements(): HTMLElement[] {
	return Array.from(
		document.querySelectorAll<HTMLElement>(
			'.newsletter a[href], .newsletter button:not([disabled]), .newsletter input:not([disabled]), .newsletter select:not([disabled]), .newsletter textarea:not([disabled]), .newsletter [tabindex]:not([tabindex="-1"])',
		),
	);
}

export default function Home() {
	const isLoggedIn = useSelector(
		(state: RootState) => state.auth?.isLoggedIn ?? false,
	);

	const [activeIndex, setActiveIndex] = useState<[number, number, number]>([
		0, 0, 0,
	]);
	const [isNewsletterOpen, setIsNewsletterOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [isSubmitted, setIsSubmitted] = useState(false);

	const lastActiveElRef = useRef<HTMLElement | null>(null);
	const emailInputRef = useRef<HTMLInputElement | null>(null);

	const gallery = useMemo(() => {
		return columns.map((col) => (col.length ? col : [""])) as [
			string[],
			string[],
			string[],
		];
	}, []);

	useEffect(() => {
		[...gallery.flat(), homePageOne, homePageTwo, homePageThree]
			.filter(Boolean)
			.forEach((src) => {
				const img = new Image();
				img.src = src;
			});
	}, [gallery]);

	useEffect(() => {
		let timer: number | null = null;
		let step = 0;

		const tick = () => {
			if (step === 0 || step === 1 || step === 2) {
				const col = step;

				setActiveIndex((prev) => {
					const next: [number, number, number] = [prev[0], prev[1], prev[2]];
					const n = gallery[col].length || 1;

					next[col] = (prev[col] + 1) % n;

					return next;
				});

				step += 1;
				timer = window.setTimeout(tick, COLUMN_STEP_MS);
				return;
			}

			step = 0;
			timer = window.setTimeout(tick, CYCLE_PAUSE_MS);
		};

		tick();

		return () => {
			if (timer) window.clearTimeout(timer);
		};
	}, [gallery]);

	useEffect(() => {
		if (!canShowNewsletterModal(isLoggedIn)) return;

		const timer = window.setTimeout(() => setIsNewsletterOpen(true), 900);

		return () => window.clearTimeout(timer);
	}, [isLoggedIn]);

	const handleCloseNewsletter = useCallback(() => {
		setIsNewsletterOpen(false);
		setFormError(null);
		setIsSubmitted(false);
		markNewsletterDismissed();
	}, []);

	useEffect(() => {
		if (!isNewsletterOpen) return;

		lastActiveElRef.current = document.activeElement as HTMLElement | null;

		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		window.setTimeout(() => {
			emailInputRef.current?.focus();
		}, 0);

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				handleCloseNewsletter();
				return;
			}

			if (event.key !== "Tab") return;

			const focusables = getModalFocusableElements();

			if (focusables.length === 0) return;

			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			const active = document.activeElement as HTMLElement | null;

			if (event.shiftKey && active === first) {
				event.preventDefault();
				last.focus();
				return;
			}

			if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			}
		};

		window.addEventListener("keydown", onKeyDown);

		return () => {
			window.removeEventListener("keydown", onKeyDown);
			document.body.style.overflow = prevOverflow;

			const el = lastActiveElRef.current;

			if (el && typeof el.focus === "function" && document.contains(el)) {
				el.focus();
			} else {
				focusFirstPageElement();
			}

			lastActiveElRef.current = null;
		};
	}, [isNewsletterOpen, handleCloseNewsletter]);

	const currentImages = useMemo(() => {
		return [0, 1, 2].map(
			(col) => gallery[col][activeIndex[col]] || gallery[col][0] || "",
		);
	}, [gallery, activeIndex]);

	const handleSubmitNewsletter = async (event: React.FormEvent) => {
		event.preventDefault();
		setFormError(null);

		const clean = email.trim();

		if (!isValidEmail(clean)) {
			setFormError("Please enter a valid email address.");
			return;
		}

		try {
			await subscribeNewsletter(clean, "modal");
			setIsSubmitted(true);
			setEmail("");

			window.setTimeout(() => {
				handleCloseNewsletter();
			}, 1200);
		} catch (err) {
			const msg =
				err instanceof Error
					? err.message
					: "Subscription failed. Please try again.";
			setFormError(msg);
		}
	};

	return (
		<div className="home">
			<header className="home-hero">
				{[0, 1, 2].map((col) => {
					const src = currentImages[col];

					return (
						<div
							className={`home-hero__column home-hero__column--${col}`}
							key={col}
							aria-hidden="true"
						>
							{src ? (
								<img
									src={src}
									className="home-hero__image"
									width={1400}
									height={1080}
									loading={col === 0 ? "eager" : "lazy"}
									decoding="async"
									alt=""
								/>
							) : null}

							<div className="home-hero__shade" />
						</div>
					);
				})}

				<div className="home-hero__vignette" aria-hidden="true" />

				<div className="home-hero__content">
					<h1 className="home-hero__title">HANDMADE STYLE</h1>
				</div>
			</header>

			<section className="home-discount" aria-label="First order discount">
				<video
					className="home-discount__video home-discount__video--desktop"
					autoPlay
					muted
					loop
					playsInline
					preload="metadata"
					aria-hidden="true"
					tabIndex={-1}
				>
					<source src={discountVideo} type="video/mp4" />
				</video>

				<video
					className="home-discount__video home-discount__video--mobile"
					autoPlay
					muted
					loop
					playsInline
					preload="metadata"
					aria-hidden="true"
					tabIndex={-1}
				>
					<source src={discountVideoMobile} type="video/mp4" />
				</video>
			</section>

			<section className="home-collection" aria-label="Women collection">
				<article className="home-collection__panel home-collection__panel--one">
					<img
						className="home-collection__image"
						src={homePageOne}
						alt="Summer collection by Tresse Handmade"
						loading="lazy"
						decoding="async"
					/>

					<div className="home-collection__overlay" />

					<div className="home-collection__content home-collection__content--left">
						<p className="home-collection__eyebrow">TRESSE HANDMADE</p>
						<h2 className="home-collection__title">SUMMER COLLECTION</h2>
						<p className="home-collection__text">LIGHT. NATURAL. TIMELESS.</p>

						<Link className="home-collection__link" to={SUMMER_COLLECTION_PATH}>
							DISCOVER NOW
						</Link>
					</div>
				</article>

				<article className="home-collection__panel home-collection__panel--two">
					<img
						className="home-collection__image"
						src={homePageTwo}
						alt="Woman walking in a warm handmade sweater"
						loading="lazy"
						decoding="async"
					/>

					<div className="home-collection__overlay" />

					<div className="home-collection__content home-collection__content--right">
						<Link className="home-collection__link" to={WOMEN_CATALOG_PATH}>
							EXPLORE COLLECTION
						</Link>
					</div>
				</article>

				<article className="home-collection__panel home-collection__panel--three">
					<img
						className="home-collection__image"
						src={homePageThree}
						alt="Woman wearing a handmade dress in an elegant interior"
						loading="lazy"
						decoding="async"
					/>

					<div className="home-collection__overlay" />

					<div className="home-collection__content home-collection__content--left">
						<Link className="home-collection__link" to={WOMEN_CATALOG_PATH}>
							EXPLORE COLLECTION
						</Link>
					</div>
				</article>
			</section>

			{isNewsletterOpen ? (
				<div
					className="newsletter"
					role="dialog"
					aria-modal="true"
					aria-labelledby="newsletterTitle"
					aria-describedby="newsletterSubtitle"
				>
					<button
						type="button"
						className="newsletter__backdrop"
						onClick={handleCloseNewsletter}
						aria-label="Close newsletter modal"
						tabIndex={-1}
					/>

					<div className="newsletter__panel" role="document">
						<button
							type="button"
							className="newsletter__close"
							onClick={handleCloseNewsletter}
							aria-label="Close"
						>
							×
						</button>

						<div className="newsletter__header">
							<h2 id="newsletterTitle" className="newsletter__title">
								SUBSCRIBE TO TRESSE EMAILS
							</h2>

							<p id="newsletterSubtitle" className="newsletter__subtitle">
								Stay updated on new collections, styling tips and special
								offers.
							</p>
						</div>

						<form
							className="newsletter__form"
							onSubmit={handleSubmitNewsletter}
						>
							<label className="newsletter__label" htmlFor="newsletter_email">
								Email address
							</label>

							<div className="newsletter__row">
								<input
									ref={emailInputRef}
									id="newsletter_email"
									name="newsletter_email"
									className="newsletter__input"
									type="email"
									inputMode="email"
									autoComplete="email"
									placeholder="Email address"
									value={email}
									onChange={(event) => {
										setEmail(event.target.value);
										if (formError) setFormError(null);
									}}
									aria-invalid={!!formError}
									aria-describedby={formError ? "newsletter_error" : undefined}
								/>

								<button type="submit" className="newsletter__submit">
									SIGN UP
								</button>
							</div>

							{formError ? (
								<div
									id="newsletter_error"
									className="newsletter__error"
									role="alert"
									aria-live="polite"
								>
									{formError}
								</div>
							) : null}

							{isSubmitted ? (
								<div
									className="newsletter__success"
									role="status"
									aria-live="polite"
								>
									You’re in. Welcome to TRESSE.
								</div>
							) : (
								<p className="newsletter__fineprint">
									By subscribing, you agree to receive promotional emails from
									Tresse. Read our{" "}
									<Link className="newsletter__link" to={POLICY_TERMS}>
										Terms
									</Link>{" "}
									and{" "}
									<Link className="newsletter__link" to={POLICY_PRIVACY}>
										Privacy Policy
									</Link>
									.
								</p>
							)}
						</form>
					</div>
				</div>
			) : null}
		</div>
	);
}
