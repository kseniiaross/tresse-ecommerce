import { Link } from "react-router-dom";
import "../../../styles/Policy.css";

export default function CookiePolicy() {
	return (
		<section className="policy" aria-labelledby="cookieTitle">
			<div className="policy__content">
				<header className="policy__header">
					<h1 id="cookieTitle" className="policy__title">
						Cookie Policy
					</h1>
				</header>

				<section className="policy__section" aria-labelledby="cookieOverview">
					<h2 id="cookieOverview" className="policy__h2">
						Overview
					</h2>

					<p className="policy__text">
						This Cookie Policy explains how TRESSE may use cookies, local
						storage, session storage, and similar technologies to operate the
						Site, protect customer information, remember preferences, and
						support the shopping experience.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="cookieWhat">
					<h2 id="cookieWhat" className="policy__h2">
						What Are Cookies?
					</h2>

					<p className="policy__text">
						Cookies are small data files stored on your device when you visit a
						website. Similar browser technologies may also store or retrieve
						information needed for website functionality and preferences.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="cookieNecessary">
					<h2 id="cookieNecessary" className="policy__h2">
						Necessary Technologies
					</h2>

					<p className="policy__text">
						Necessary cookies and similar technologies may support security,
						authentication, checkout, fraud prevention, shopping functionality,
						and basic Site operation.
					</p>

					<p className="policy__text">
						Where these technologies are strictly necessary to provide the Site
						or a service requested by you, they may operate without optional
						consent controls to the extent permitted by applicable law.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="cookieAnalytics">
					<h2 id="cookieAnalytics" className="policy__h2">
						Analytics Technologies
					</h2>

					<p className="policy__text">
						If enabled, optional analytics technologies may help us understand
						how visitors use the Site and where the shopping experience can be
						improved.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="cookieMarketing">
					<h2 id="cookieMarketing" className="policy__h2">
						Marketing Technologies
					</h2>

					<p className="policy__text">
						If enabled, optional marketing technologies may be used to measure
						campaigns or support promotional content. Where consent is required,
						these technologies will be used subject to applicable consent
						choices.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="cookiePayments">
					<h2 id="cookiePayments" className="policy__h2">
						Payment &amp; Security Providers
					</h2>

					<p className="policy__text">
						Third-party providers involved in payment processing, fraud
						prevention, security, or other Site functionality may use their own
						cookies or similar technologies according to their services and
						privacy practices.
					</p>
				</section>

				<section
					className="policy__section"
					aria-labelledby="cookiePreferences"
				>
					<h2 id="cookiePreferences" className="policy__h2">
						Managing Your Preferences
					</h2>

					<p className="policy__text">
						Where a cookie preference tool is available, you may use it to
						manage optional technologies. You may also control cookies through
						your browser settings.
					</p>

					<p className="policy__text">
						Blocking necessary browser storage or cookies may affect account,
						checkout, security, or other Site functionality.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="cookieRelated">
					<h2 id="cookieRelated" className="policy__h2">
						Related Policies
					</h2>

					<p className="policy__text">
						For more information about how we handle personal information,
						please review our{" "}
						<Link className="policy__link" to="/policies/privacy-policy">
							Privacy Policy
						</Link>
						.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="cookieContact">
					<h2 id="cookieContact" className="policy__h2">
						Contact
					</h2>

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
