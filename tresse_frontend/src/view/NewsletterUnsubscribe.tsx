import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api/axiosInstance";
import { subscribeNewsletter } from "../utils/newsletter";
import "../../styles/Policy.css";
import "../../styles/NewsletterUnsubscribe.css";

type UnsubscribeState =
	| { status: "loading" }
	| { status: "success"; email: string }
	| { status: "error"; message: string };

type ResubscribeStatus = "idle" | "loading" | "success" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getErrorMessage(err: unknown): string {
	if (typeof err !== "object" || err === null) {
		return "This unsubscribe link is invalid or has expired.";
	}

	const maybe = err as {
		response?: { data?: unknown };
		message?: unknown;
	};

	const data = maybe.response?.data;

	if (isRecord(data)) {
		const detail = data.detail;
		if (typeof detail === "string" && detail.trim()) return detail.trim();
		if (
			Array.isArray(detail) &&
			typeof detail[0] === "string" &&
			detail[0].trim()
		)
			return detail[0].trim();
	}

	if (typeof maybe.message === "string" && maybe.message.trim())
		return maybe.message.trim();

	return "This unsubscribe link is invalid or has expired.";
}

export default function NewsletterUnsubscribe() {
	const params = useParams<{ token?: string }>();
	const token = (params.token ?? "").trim();

	const [state, setState] = useState<UnsubscribeState>({ status: "loading" });

	const [resubscribeStatus, setResubscribeStatus] =
		useState<ResubscribeStatus>("idle");
	const [resubscribeError, setResubscribeError] = useState<string>("");

	useEffect(() => {
		let active = true;

		if (!token) {
			setState({
				status: "error",
				message: "This unsubscribe link is invalid or incomplete.",
			});
			return;
		}

		setState({ status: "loading" });

		(async () => {
			try {
				const res = await api.post(
					`/newsletter/unsubscribe/${encodeURIComponent(token)}/`,
				);

				if (!active) return;

				const data = res.data;
				const email =
					isRecord(data) && typeof data.email === "string" ? data.email : "";

				setState({ status: "success", email });
			} catch (err: unknown) {
				if (!active) return;

				setState({ status: "error", message: getErrorMessage(err) });
			}
		})();

		return () => {
			active = false;
		};
	}, [token]);

	const handleResubscribe = async () => {
		if (state.status !== "success" || !state.email) return;

		setResubscribeError("");
		setResubscribeStatus("loading");

		try {
			await subscribeNewsletter(state.email, "unsubscribe");
			setResubscribeStatus("success");
		} catch (err: unknown) {
			setResubscribeStatus("error");
			setResubscribeError(
				err instanceof Error && err.message.trim()
					? err.message.trim()
					: "Could not resubscribe. Please try again.",
			);
		}
	};

	return (
		<section className="policy" aria-labelledby="unsubscribeTitle">
			<div className="policy__content newsletterUnsubscribe">
				<header className="policy__header">
					<h1 id="unsubscribeTitle" className="policy__title">
						Newsletter
					</h1>
				</header>

				<section
					className="policy__section"
					aria-labelledby="unsubscribeStatus"
				>
					<h2 id="unsubscribeStatus" className="policy__h2">
						{state.status === "success" ? "Unsubscribed" : "Unsubscribe"}
					</h2>

					{state.status === "loading" ? (
						<div className="newsletterUnsubscribe__state" role="status">
							<span
								className="newsletterUnsubscribe__spinner"
								aria-hidden="true"
							/>
							<p className="policy__text">
								Unsubscribing you from the TRESSE newsletter…
							</p>
						</div>
					) : null}

					{state.status === "error" ? (
						<div
							className="newsletterUnsubscribe__state"
							role="alert"
							aria-live="polite"
						>
							<p className="policy__text">{state.message}</p>
							<p className="policy__text">
								<Link className="policy__link" to="/catalog">
									Return to the catalog
								</Link>{" "}
								or{" "}
								<Link className="policy__link" to="/contact">
									contact us
								</Link>{" "}
								for help.
							</p>
						</div>
					) : null}

					{state.status === "success" ? (
						<div className="newsletterUnsubscribe__state" aria-live="polite">
							<p className="policy__text" role="status">
								{state.email ? (
									<>
										You've been unsubscribed. <strong>{state.email}</strong>{" "}
										will no longer receive TRESSE newsletter emails.
									</>
								) : (
									"You've been unsubscribed from the TRESSE newsletter."
								)}
							</p>

							{resubscribeStatus === "success" ? (
								<p className="policy__text" role="status">
									You're subscribed again. Welcome back.
								</p>
							) : (
								<div className="newsletterUnsubscribe__actions">
									<button
										type="button"
										className="newsletterUnsubscribe__button"
										onClick={handleResubscribe}
										disabled={resubscribeStatus === "loading" || !state.email}
									>
										{resubscribeStatus === "loading"
											? "Resubscribing…"
											: "Resubscribe"}
									</button>

									<Link className="policy__link" to="/catalog">
										Return to the catalog
									</Link>
								</div>
							)}

							{resubscribeStatus === "error" && resubscribeError ? (
								<p
									className="newsletterUnsubscribe__error"
									role="alert"
									aria-live="polite"
								>
									{resubscribeError}
								</p>
							) : null}
						</div>
					) : null}
				</section>
			</div>
		</section>
	);
}
