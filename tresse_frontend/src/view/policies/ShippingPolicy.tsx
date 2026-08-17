import "../../../styles/Policy.css";

export default function ShippingPolicy() {
	return (
		<section className="policy" aria-labelledby="shippingTitle">
			<div className="policy__content">
				<header className="policy__header">
					<h1 id="shippingTitle" className="policy__title">
						Shipping Policy
					</h1>
				</header>

				<section
					className="policy__section"
					aria-labelledby="shippingWorldwide"
				>
					<h2 id="shippingWorldwide" className="policy__h2">
						Worldwide Shipping
					</h2>

					<p className="policy__text">
						TRESSE offers worldwide shipping to destinations supported by our
						available shipping carriers and checkout services.
					</p>

					<p className="policy__text">
						Shipping is not free unless expressly stated otherwise and is
						calculated based on destination, package details, and available
						shipping method.
					</p>
				</section>

				<section
					className="policy__section"
					aria-labelledby="shippingProduction"
				>
					<h2 id="shippingProduction" className="policy__h2">
						Production Time
					</h2>

					<p className="policy__text">
						Many TRESSE items are handmade and made to order. Unless otherwise
						stated on the product page, estimated production time is generally
						1–2 weeks before dispatch.
					</p>

					<p className="policy__text">
						Production time is separate from shipping and delivery time.
						Custom-sized, complex, or high-demand items may require additional
						production time.
					</p>
				</section>

				<section
					className="policy__section"
					aria-labelledby="shippingEstimates"
				>
					<h2 id="shippingEstimates" className="policy__h2">
						Delivery Estimates
					</h2>

					<p className="policy__text">
						Delivery estimates begin after an order has completed production and
						has been dispatched. Carrier delivery estimates are not guaranteed
						and may be affected by customs, weather, transportation disruptions,
						peak periods, or other circumstances outside our reasonable control.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="shippingTracking">
					<h2 id="shippingTracking" className="policy__h2">
						Tracking
					</h2>

					<p className="policy__text">
						When your order is dispatched, tracking information will be sent by
						email when tracking is available for the selected shipping service.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="shippingCustoms">
					<h2 id="shippingCustoms" className="policy__h2">
						Customs &amp; Import Fees
					</h2>

					<p className="policy__text">
						International orders may be subject to customs duties, import taxes,
						brokerage charges, or other fees imposed by the destination country.
					</p>

					<p className="policy__text">
						Unless otherwise required by applicable law or expressly stated at
						checkout, these charges are the responsibility of the customer.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="shippingAddress">
					<h2 id="shippingAddress" className="policy__h2">
						Shipping Address
					</h2>

					<p className="policy__text">
						Customers are responsible for reviewing and providing complete and
						accurate shipping information.
					</p>

					<p className="policy__text">
						If you notice an address error, contact us immediately. We cannot
						guarantee that an address can be changed after an order has entered
						fulfillment or has been dispatched.
					</p>
				</section>

				<section
					className="policy__section"
					aria-labelledby="shippingUnclaimed"
				>
					<h2 id="shippingUnclaimed" className="policy__h2">
						Refused &amp; Unclaimed Deliveries
					</h2>

					<p className="policy__text">
						Additional shipping, return, customs, or carrier charges resulting
						from a refused or unclaimed delivery may be deducted from any refund
						where permitted by applicable law, unless the refusal resulted from
						an error by TRESSE.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="shippingLost">
					<h2 id="shippingLost" className="policy__h2">
						Lost or Damaged Shipments
					</h2>

					<p className="policy__text">
						If a shipment appears lost or arrives damaged, please contact us
						promptly with your order details. We will review the matter and,
						where appropriate, work with the shipping carrier to investigate and
						provide a reasonable solution.
					</p>
				</section>

				<section className="policy__section" aria-labelledby="shippingContact">
					<h2 id="shippingContact" className="policy__h2">
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
