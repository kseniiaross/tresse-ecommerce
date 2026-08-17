import "../../styles/Contact.css";

const SUPPORT_EMAIL = "support@tresseknitting.com";

export default function Contact() {
	return (
		<main className="contact" aria-labelledby="contactTitle">
			<section className="contact__hero">
				<p className="contact__kicker">CONTACT</p>
				<h1 id="contactTitle" className="contact__title">
					WE’RE HERE TO HELP
				</h1>
			</section>

			<section className="contact__content">
				<p>
					If you have questions about an order, sizing, delivery, or custom
					pieces, feel free to reach out.
				</p>

				<p>
					We personally review every message and usually respond within{" "}
					<strong>24 hours</strong>.
				</p>

				<div className="contact__email">
					<span className="contact__label">EMAIL</span>
					<a
						href={`mailto:${SUPPORT_EMAIL}`}
						className="contact__link"
						aria-label={`Send an email to ${SUPPORT_EMAIL}`}
					>
						{SUPPORT_EMAIL}
					</a>
				</div>
			</section>
		</main>
	);
}
