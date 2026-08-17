import { Link, useLocation } from "react-router-dom";
import { isSafePath } from "../utils/routing";

import "../../styles/LoginChoice.css";

import loginChoiceImage from "../assets/images/LoginChoice.webp";

export default function LoginChoice() {
	const location = useLocation();

	const params = new URLSearchParams(location.search);

	const rawNext = params.get("next");
	const safeNext = isSafePath(rawNext) ? rawNext : null;

	const nextParam = safeNext ? `?next=${encodeURIComponent(safeNext)}` : "";

	return (
		<section className="choice" aria-label="Login choice">
			<img
				className="choice__background"
				src={loginChoiceImage}
				alt=""
				aria-hidden="true"
			/>

			<div className="choice__overlay" />

			<div className="choice__layout">
				<div className="choice__content">
					<h2 className="choice__title">
						ENJOY THE BEST EXPERIENCE
						<br />
						WITH US
					</h2>

					<p className="choice__subtitle">
						Sign in to enjoy a personalized experience and get access to all our
						services.
					</p>

					<div className="choice__actions">
						<Link
							to={`/authorization${nextParam}`}
							className="choice__cta choice__cta--primary"
						>
							LOG IN
						</Link>

						<Link
							to={`/register${nextParam}`}
							className="choice__cta choice__cta--secondary"
						>
							REGISTER
						</Link>
					</div>
				</div>
			</div>
		</section>
	);
}
