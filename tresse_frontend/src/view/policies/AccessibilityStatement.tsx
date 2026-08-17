import "../../../styles/Policy.css";

export default function AccessibilityStatement() {
	return (
		<section className="policy" aria-labelledby="accessibilityTitle">
			<div className="policy__content">
				<header className="policy__header">
					<h1 id="accessibilityTitle" className="policy__title">
						Accessibility Statement
					</h1>
				</header>

				<section
					className="policy__section"
					aria-labelledby="accessibilityCommitment"
				>
					<h2 id="accessibilityCommitment" className="policy__h2">
						Our Commitment
					</h2>

					<p className="policy__text">
						TRESSE is committed to improving access to our website for the
						widest reasonably possible audience, including people who use
						assistive technologies.
					</p>

					<p className="policy__text">
						We continue to review and improve the accessibility and usability of
						the Site and aim to follow recognized accessibility practices,
						including relevant Web Content Accessibility Guidelines (WCAG),
						where reasonably possible.
					</p>
				</section>

				<section
					className="policy__section"
					aria-labelledby="accessibilityFeatures"
				>
					<h2 id="accessibilityFeatures" className="policy__h2">
						Accessibility Features
					</h2>

					<p className="policy__text">
						Accessibility-related practices on the Site may include:
					</p>

					<ul className="policy__list">
						<li className="policy__li">
							Keyboard-accessible navigation and controls
						</li>
						<li className="policy__li">Semantic HTML structure</li>
						<li className="policy__li">Visible focus indicators</li>
						<li className="policy__li">Readable color contrast</li>
						<li className="policy__li">
							Alternative text for meaningful images where appropriate
						</li>
						<li className="policy__li">
							Accessible form labels and status messaging
						</li>
						<li className="policy__li">
							Responsive layouts across supported devices
						</li>
					</ul>
				</section>

				<section
					className="policy__section"
					aria-labelledby="accessibilityLimitations"
				>
					<h2 id="accessibilityLimitations" className="policy__h2">
						Ongoing Improvements
					</h2>

					<p className="policy__text">
						Accessibility is an ongoing process. Some content, third-party
						services, or integrations may not always provide the same level of
						accessibility as features directly controlled by TRESSE.
					</p>

					<p className="policy__text">
						We welcome feedback that helps us identify and address barriers.
					</p>
				</section>

				<section
					className="policy__section"
					aria-labelledby="accessibilityFeedback"
				>
					<h2 id="accessibilityFeedback" className="policy__h2">
						Feedback &amp; Assistance
					</h2>

					<p className="policy__text">
						If you experience difficulty accessing content, using a feature, or
						completing a purchase, please contact us. We will make reasonable
						efforts to provide assistance or information through an alternative
						method where appropriate.
					</p>

					<p className="policy__text">
						Email:{" "}
						<a
							className="policy__link"
							href="mailto:support@tresseknitting.com"
						>
							support@tresseknitting.com
						</a>
					</p>
				</section>
			</div>
		</section>
	);
}
