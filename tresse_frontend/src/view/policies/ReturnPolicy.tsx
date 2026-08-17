import "../../../styles/Policy.css";

export default function ReturnPolicy() {
	return (
		<section className="policy" aria-labelledby="returnTitle">
			<div className="policy__content">
				<header className="policy__header">
					<h1 id="returnTitle" className="policy__title">
						Return Policy
					</h1>
				</header>

				<section className="policy__section" aria-labelledby="returnOverview">
					<h2 id="returnOverview" className="policy__h2">
						Overview
					</h2>

					<p className="policy__text">
						TRESSE is a handmade brand. Each item is carefully crafted, and many
						pieces are made to order. We ask that you review product
						descriptions, sizing information, and this Return Policy before
						placing your order.
					</p>
				</section>

				<section
					className="policy__section"
					aria-labelledby="returnCancellation"
				>
					<h2 id="returnCancellation" className="policy__h2">
						Order Cancellation
					</h2>

					<p className="policy__text">
						You may request to cancel your order within 24 hours of placing it
						for a full refund to your original payment method.
					</p>

					<p className="policy__text">
						After the 24-hour cancellation period has passed, production may
						begin and cancellation is no longer guaranteed. If production has
						not yet started, please contact us as soon as possible and we will
						review your request.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="returnWindow">
					<h2 id="returnWindow" className="policy__h2">
						14-Day Return Window
					</h2>

					<p className="policy__text">
						For eligible items, you may request a return within 14 calendar days
						from the date your order is delivered.
					</p>

					<p className="policy__text">
						To initiate a return, you must contact TRESSE within the 14-day
						return window. A return request submitted after 14 calendar days
						from delivery is not eligible for a voluntary return based on change
						of mind, fit, or preference, except where required by applicable
						law.
					</p>

					<p className="policy__text">
						Once a return request is approved, the item must be shipped back
						within 7 calendar days using the return instructions provided by
						TRESSE.
					</p>

					<p className="policy__text">
						The 14-day return window applies only to items that are eligible for
						return under this policy. Swimwear, custom-sized items, personalized
						items, and items marked as Final Sale are excluded from voluntary
						returns and exchanges as described below.
					</p>
				</section>

				<section
					className="policy__section"
					aria-labelledby="returnEligibility"
				>
					<h2 id="returnEligibility" className="policy__h2">
						Return Eligibility
					</h2>

					<p className="policy__text">
						To be eligible for a voluntary return, the item must not fall within
						an excluded or Final Sale category under this policy and must:
					</p>

					<ul className="policy__list">
						<li className="policy__li">
							Be unworn, unused, unwashed, and unaltered
						</li>

						<li className="policy__li">
							Be free from stains, makeup, deodorant marks, odors, perfume,
							smoke, pet hair, and other signs of wear
						</li>

						<li className="policy__li">
							Be returned in its original condition
						</li>

						<li className="policy__li">
							Have all original product tags attached
						</li>

						<li className="policy__li">
							Have the original TRESSE return/security tag fully attached,
							intact, and unaltered
						</li>
					</ul>

					<p className="policy__text">
						Meeting these condition requirements does not make an item eligible
						for return if the item is otherwise excluded from returns under this
						policy.
					</p>
				</section>

				<section
					className="policy__section"
					aria-labelledby="returnSecurityTag"
				>
					<h2 id="returnSecurityTag" className="policy__h2">
						TRESSE Return &amp; Security Tag
					</h2>

					<p className="policy__text">
						Please try on eligible items carefully before removing any tags.
					</p>

					<p className="policy__text">
						For items that are eligible for return, the TRESSE return/security
						tag must remain fully attached and intact. It must not be removed,
						cut, detached, replaced, altered, or tampered with.
					</p>

					<p className="policy__text">
						Eligible items returned without the original intact TRESSE
						return/security tag are not eligible for a voluntary return based on
						change of mind, fit, or preference, except where required by
						applicable law.
					</p>

					<p className="policy__text">
						An intact return/security tag does not make an item eligible for
						return if the item is otherwise excluded or designated as Final Sale
						under this policy.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="returnCustom">
					<h2 id="returnCustom" className="policy__h2">
						Custom-Sized &amp; Personalized Items
					</h2>

					<p className="policy__text">
						Made-to-measure, custom-sized, personalized, or otherwise customized
						items are final sale and are not eligible for voluntary return or
						exchange based on change of mind, fit preference, sizing preference,
						or inaccurate measurements provided by the customer.
					</p>

					<p className="policy__text">
						This restriction applies even if the item is unworn, unused,
						unwashed, and returned with original product tags or the TRESSE
						return/security tag intact.
					</p>

					<p className="policy__text">
						This restriction does not affect any rights or remedies that may
						apply if an item arrives defective, damaged, materially different
						from what was ordered, or if TRESSE made an error in fulfilling the
						order, and does not limit rights that cannot be waived under
						applicable law.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="returnSwimwear">
					<h2 id="returnSwimwear" className="policy__h2">
						Swimwear
					</h2>

					<p className="policy__text">
						For hygiene reasons, all swimwear is final sale and is not eligible
						for voluntary return or exchange based on change of mind, fit,
						sizing preference, color preference, or other personal preference.
					</p>

					<p className="policy__text">
						This restriction applies even if the swimwear is unworn, unused,
						unwashed, and returned with original product tags, hygiene liners,
						protective seals, or the TRESSE return/security tag intact.
					</p>

					<p className="policy__text">
						Swimwear is not covered by the 14-day voluntary return window
						described above.
					</p>

					<p className="policy__text">
						This restriction does not affect any rights or remedies that may
						apply if an item arrives defective, damaged, materially different
						from what was ordered, or if TRESSE made an error in fulfilling the
						order, and does not limit rights that cannot be waived under
						applicable law.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="returnFinalSale">
					<h2 id="returnFinalSale" className="policy__h2">
						Final Sale Items
					</h2>

					<p className="policy__text">
						Items clearly marked as Final Sale before purchase are not eligible
						for voluntary return or exchange.
					</p>

					<p className="policy__text">
						Final Sale restrictions apply even if the item is unworn, unused,
						unwashed, and returned with original product tags or the TRESSE
						return/security tag intact.
					</p>

					<p className="policy__text">
						These restrictions do not limit rights or remedies that cannot be
						waived under applicable law.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="returnDamaged">
					<h2 id="returnDamaged" className="policy__h2">
						Incorrect, Damaged, or Defective Items
					</h2>

					<p className="policy__text">
						If your order arrives incorrect, damaged, or defective, please
						contact us as soon as reasonably possible after delivery and provide
						your order details and clear photographs of the issue where
						applicable.
					</p>

					<p className="policy__text">
						We will review the matter and, where appropriate, provide a
						replacement, repair, refund, or other reasonable solution.
					</p>

					<p className="policy__text">
						This section applies to all products, including swimwear,
						custom-sized items, personalized items, and other Final Sale items.
					</p>

					<p className="policy__text">
						The voluntary return restrictions in this policy do not limit rights
						or remedies that cannot be waived under applicable law.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="returnShipping">
					<h2 id="returnShipping" className="policy__h2">
						Return Shipping
					</h2>

					<p className="policy__text">
						Unless an item is defective, damaged upon arrival, materially
						different from what was ordered, or sent incorrectly by TRESSE,
						customers are responsible for return shipping costs for eligible
						returns.
					</p>

					<p className="policy__text">
						Original shipping charges are non-refundable except where required
						by applicable law or where the return results from an error by
						TRESSE.
					</p>

					<p className="policy__text">
						Items sent back without prior return authorization may not be
						accepted or processed as a voluntary return.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="returnInspection">
					<h2 id="returnInspection" className="policy__h2">
						Return Inspection
					</h2>

					<p className="policy__text">
						All returned items are inspected after receipt. Approval of a return
						request does not guarantee a refund if the returned item does not
						meet the eligibility requirements of this policy.
					</p>

					<p className="policy__text">
						TRESSE reserves the right to decline a voluntary refund where an
						item shows signs of wear, use, washing, alteration, damage after
						delivery, contamination, removed or altered tags, or other
						conditions that make the item ineligible under this policy, except
						where prohibited by applicable law.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="returnRefunds">
					<h2 id="returnRefunds" className="policy__h2">
						Refunds
					</h2>

					<p className="policy__text">
						Approved refunds are issued to the original payment method after the
						returned item has been received, inspected, and approved.
					</p>

					<p className="policy__text">
						Please allow up to 7–10 business days after inspection for TRESSE to
						process an approved refund. Your bank or payment provider may
						require additional time before the refund appears in your account.
					</p>

					<p className="policy__text">
						Submission or approval of a return request does not mean that a
						refund has already been issued. Refunds are processed only after the
						applicable return review and inspection process has been completed.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="returnQuestions">
					<h2 id="returnQuestions" className="policy__h2">
						Questions
					</h2>

					<p className="policy__text">
						If you have questions about sizing, customization, Final Sale
						status, or return eligibility, please contact us before placing your
						order.
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
