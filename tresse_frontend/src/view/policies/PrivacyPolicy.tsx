import "../../../styles/Policy.css";

export default function PrivacyPolicy() {
	return (
		<section className="policy" aria-labelledby="privacyTitle">
			<div className="policy__content">
				<header className="policy__header">
					<h1 id="privacyTitle" className="policy__title">
						Privacy Policy
					</h1>
				</header>

				<section className="policy__section" aria-labelledby="privacyOverview">
					<h2 id="privacyOverview" className="policy__h2">
						Overview
					</h2>

					<p className="policy__text">
						TRESSE respects your privacy and is committed to handling personal
						information responsibly. This Privacy Policy explains the types of
						information we may collect, how we use it, when it may be shared,
						and the choices available to you.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="privacyCollect">
					<h2 id="privacyCollect" className="policy__h2">
						Information We Collect
					</h2>

					<p className="policy__text">
						Depending on how you use the Site, we may collect:
					</p>

					<ul className="policy__list">
						<li className="policy__li">
							Contact information, such as name and email address
						</li>
						<li className="policy__li">
							Account information and authentication-related data
						</li>
						<li className="policy__li">Shipping and billing information</li>
						<li className="policy__li">
							Order information, including products, sizes, customization
							details, prices, and order history
						</li>
						<li className="policy__li">Customer service communications</li>
						<li className="policy__li">
							Technical information such as IP address, browser type, device
							information, and security or server logs where collected
						</li>
						<li className="policy__li">
							Cookie, local storage, or similar technology data as described in
							our Cookie Policy
						</li>
					</ul>
				</section>

				<section className="policy__section" aria-labelledby="privacyUse">
					<h2 id="privacyUse" className="policy__h2">
						How We Use Information
					</h2>

					<p className="policy__text">We may use information to:</p>

					<ul className="policy__list">
						<li className="policy__li">Process, fulfill, and manage orders</li>
						<li className="policy__li">Create and manage customer accounts</li>
						<li className="policy__li">
							Authenticate users and protect account security
						</li>
						<li className="policy__li">
							Process payments through payment service providers
						</li>
						<li className="policy__li">Arrange shipping and delivery</li>
						<li className="policy__li">
							Provide customer support and respond to requests
						</li>
						<li className="policy__li">
							Prevent fraud, abuse, and security incidents
						</li>
						<li className="policy__li">Maintain and improve the Site</li>
						<li className="policy__li">
							Comply with applicable legal obligations
						</li>
					</ul>
				</section>

				<section className="policy__section" aria-labelledby="privacyPayments">
					<h2 id="privacyPayments" className="policy__h2">
						Payments
					</h2>

					<p className="policy__text">
						Payments may be processed by third-party payment service providers
						such as Stripe. TRESSE does not store full card numbers or CVV
						security codes in its own application database.
					</p>

					<p className="policy__text">
						Payment providers process information according to their own terms
						and privacy practices.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="privacySharing">
					<h2 id="privacySharing" className="policy__h2">
						How We Share Information
					</h2>

					<p className="policy__text">
						We do not sell personal information for money. We may share
						information with service providers where reasonably necessary to
						operate the business and fulfill customer requests, including:
					</p>

					<ul className="policy__list">
						<li className="policy__li">Payment processors</li>
						<li className="policy__li">Shipping and delivery providers</li>
						<li className="policy__li">
							Hosting, infrastructure, and security providers
						</li>
						<li className="policy__li">
							Email and customer communication providers
						</li>
						<li className="policy__li">
							Professional advisers or authorities where legally required
						</li>
					</ul>
				</section>

				<section className="policy__section" aria-labelledby="privacyCookies">
					<h2 id="privacyCookies" className="policy__h2">
						Cookies &amp; Similar Technologies
					</h2>

					<p className="policy__text">
						The Site may use cookies, local storage, session storage, and
						similar technologies for necessary functionality, authentication,
						security, preferences, and other purposes described in our Cookie
						Policy.
					</p>

					<p className="policy__text">
						Optional analytics or marketing technologies are used only when
						enabled and handled in accordance with applicable consent
						requirements.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="privacyRetention">
					<h2 id="privacyRetention" className="policy__h2">
						Data Retention
					</h2>

					<p className="policy__text">
						We retain personal information for as long as reasonably necessary
						for the purposes described in this policy, including order
						fulfillment, customer support, security, recordkeeping, dispute
						resolution, and legal or tax obligations.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="privacySecurity">
					<h2 id="privacySecurity" className="policy__h2">
						Data Security
					</h2>

					<p className="policy__text">
						We use reasonable administrative and technical measures designed to
						protect personal information. However, no method of electronic
						transmission or storage can be guaranteed to be completely secure.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="privacyRights">
					<h2 id="privacyRights" className="policy__h2">
						Your Privacy Rights
					</h2>

					<p className="policy__text">
						Depending on your location and applicable law, you may have rights
						relating to access, correction, deletion, or other handling of your
						personal information.
					</p>

					<p className="policy__text">
						To submit a privacy request, contact us using the email address
						below. We may need to verify your request before responding.
					</p>
				</section>

				<section
					className="policy__section"
					aria-labelledby="privacyInternational"
				>
					<h2 id="privacyInternational" className="policy__h2">
						International Customers
					</h2>

					<p className="policy__text">
						If you access the Site or place an order from outside the country
						where our systems or service providers operate, your information may
						be processed in other jurisdictions, subject to applicable legal
						requirements.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="privacyChanges">
					<h2 id="privacyChanges" className="policy__h2">
						Changes to This Policy
					</h2>

					<p className="policy__text">
						We may update this Privacy Policy from time to time. The current
						version will be posted on this page.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="privacyContact">
					<h2 id="privacyContact" className="policy__h2">
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
