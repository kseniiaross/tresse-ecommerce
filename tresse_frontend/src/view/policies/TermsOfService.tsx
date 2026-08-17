import { Link } from "react-router-dom";
import "../../../styles/Policy.css";

export default function TermsOfService() {
	return (
		<section className="policy" aria-labelledby="termsTitle">
			<div className="policy__content">
				<header className="policy__header">
					<h1 id="termsTitle" className="policy__title">
						Terms of Service
					</h1>
				</header>

				<section className="policy__section" aria-labelledby="termsIntro">
					<h2 id="termsIntro" className="policy__h2">
						Introduction
					</h2>

					<p className="policy__text">
						These Terms of Service (“Terms”) govern your access to and use of{" "}
						<span className="policy__mono">tressehandmade.com</span> (the
						“Site”), including browsing, creating an account, and purchasing
						products from TRESSE.
					</p>

					<p className="policy__text">
						By accessing or using the Site, you agree to these Terms. If you do
						not agree, please do not use the Site.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="termsChanges">
					<h2 id="termsChanges" className="policy__h2">
						Changes to These Terms
					</h2>

					<p className="policy__text">
						We may update these Terms from time to time to reflect changes to
						the Site, our services, business practices, or legal requirements.
						The updated version will be posted on the Site.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="termsProducts">
					<h2 id="termsProducts" className="policy__h2">
						Product Information
					</h2>

					<p className="policy__text">
						We aim to provide accurate product descriptions, photographs,
						colors, measurements, pricing, and availability. However, minor
						differences may occur due to screen settings, photography, handmade
						production, yarn characteristics, and natural variations in
						materials.
					</p>

					<p className="policy__text">
						Because TRESSE products are handmade, slight variations in
						dimensions, texture, stitch appearance, and finishing may occur and
						do not necessarily constitute a defect.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="termsHandmade">
					<h2 id="termsHandmade" className="policy__h2">
						Handmade &amp; Made-to-Order Products
					</h2>

					<p className="policy__text">
						Many TRESSE items are handmade and may be produced after an order is
						placed. Production times are estimates and may vary depending on the
						item, materials, customization, and order volume.
					</p>

					<p className="policy__text">
						Custom-sized, made-to-measure, personalized, or otherwise customized
						products may be subject to additional restrictions as described in
						our Return Policy.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="termsOrders">
					<h2 id="termsOrders" className="policy__h2">
						Orders &amp; Payments
					</h2>

					<p className="policy__text">
						When placing an order, you confirm that the information you provide
						is accurate, complete, and current and that you are authorized to
						use the selected payment method.
					</p>

					<p className="policy__text">
						Submission of an order does not prevent us from refusing or
						cancelling an order where reasonably necessary, including in cases
						of suspected fraud, payment issues, incorrect pricing, product
						unavailability, or other legitimate reasons.
					</p>
				</section>

				<section
					className="policy__section"
					aria-labelledby="termsCancellation"
				>
					<h2 id="termsCancellation" className="policy__h2">
						Order Cancellation
					</h2>

					<p className="policy__text">
						Customers may request cancellation within 24 hours of placing an
						order for a full refund to the original payment method.
					</p>

					<p className="policy__text">
						After the 24-hour cancellation period, production may begin and
						cancellation is no longer guaranteed.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="termsShipping">
					<h2 id="termsShipping" className="policy__h2">
						Shipping
					</h2>

					<p className="policy__text">
						Processing, production, delivery, tracking, customs, and address
						terms are described in our{" "}
						<Link className="policy__link" to="/policies/shipping-policy">
							Shipping Policy
						</Link>
						.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="termsReturns">
					<h2 id="termsReturns" className="policy__h2">
						Returns &amp; Refunds
					</h2>

					<p className="policy__text">
						Eligible return requests must be initiated within 14 calendar days
						from the date of delivery and are subject to the conditions,
						exclusions, security-tag requirements, and procedures described in
						our{" "}
						<Link className="policy__link" to="/policies/return-policy">
							Return Policy
						</Link>
						.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="termsIP">
					<h2 id="termsIP" className="policy__h2">
						Intellectual Property
					</h2>

					<p className="policy__text">
						Unless otherwise stated, content on the Site, including logos,
						branding, text, product photographs, graphics, visual materials, and
						original website content, is owned by TRESSE or used with permission
						and is protected by applicable intellectual property laws.
					</p>

					<p className="policy__text">
						You may not reproduce, distribute, modify, publish, commercially
						exploit, or use protected Site content without authorization, except
						as permitted by applicable law.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="termsUser">
					<h2 id="termsUser" className="policy__h2">
						User Obligations
					</h2>

					<p className="policy__text">
						You agree not to misuse the Site, attempt unauthorized access,
						interfere with security or operation, introduce malicious code,
						conduct unauthorized automated scraping, commit fraud, or use the
						Site in violation of applicable law.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="termsLiability">
					<h2 id="termsLiability" className="policy__h2">
						Limitation of Liability
					</h2>

					<p className="policy__text">
						To the maximum extent permitted by applicable law, TRESSE will not
						be liable for indirect, incidental, special, or consequential
						damages arising from use of the Site or products.
					</p>

					<p className="policy__text">
						Nothing in these Terms excludes or limits liability or consumer
						rights that cannot lawfully be excluded or limited.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="termsLaw">
					<h2 id="termsLaw" className="policy__h2">
						Applicable Law
					</h2>

					<p className="policy__text">
						These Terms are governed by applicable laws and are subject to any
						mandatory consumer protection rights that apply to a customer and
						cannot lawfully be waived.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="termsContact">
					<h2 id="termsContact" className="policy__h2">
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
