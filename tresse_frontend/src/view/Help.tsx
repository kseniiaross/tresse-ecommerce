import { useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import "../../styles/Help.css";
import type { RootState } from "../store";

const ORDERS_PATH = "/orders";
const _PROFILE_PATH = "/dashboard";
const LOGIN_CHOICE_PATH = "/login-choice";

const POLICY_PRIVACY = "/policies/privacy-policy";
const POLICY_TERMS = "/policies/terms-of-service";
const POLICY_RETURN = "/policies/return-policy";
const POLICY_SHIPPING = "/policies/shipping-policy";
const POLICY_ACCESSIBILITY = "/policies/accessibility-statement";

export default function Help() {
	const navigate = useNavigate();
	const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);

	const goAuthOr = (path: string) => {
		navigate(isLoggedIn ? path : LOGIN_CHOICE_PATH);
	};

	return (
		<section className="help" aria-labelledby="help__title">
			<div className="help__wrap">
				<header className="help__header">
					<h1 id="help__title" className="help__title">
						HELP
					</h1>

					<p className="help__intro">
						Quick answers about orders, shipping, returns, and payments. If you
						can’t find what you need —{" "}
						<span className="help__nowrap">reach out to us.</span>
					</p>
				</header>

				<nav className="help__nav" aria-label="Help sections">
					<a className="help__navLink" href="#contact">
						Contact
					</a>
					<a className="help__navLink" href="#orders">
						Orders
					</a>
					<a className="help__navLink" href="#shipping">
						Shipping
					</a>
					<a className="help__navLink" href="#returns">
						Returns
					</a>
					<a className="help__navLink" href="#policies">
						Policies
					</a>
				</nav>

				<div className="help__line" />

				{/* CONTACT */}
				<section
					id="contact"
					className="help__section"
					aria-labelledby="contactTitle"
				>
					<h2 id="contactTitle" className="help__h2">
						Contact
					</h2>

					<p className="help__text">
						Our support team replies during business hours. Most requests are
						answered within 24–48 hours.
					</p>

					<div className="help__actions">
						<a className="help__btn" href="mailto:support@tresseknitting.com">
							Email support
						</a>
					</div>

					<p className="help__small">
						Email:{" "}
						<span className="help__mono">support@tresseknitting.com</span>
					</p>
				</section>

				<div className="help__line" />

				{/* ORDERS */}
				<section
					id="orders"
					className="help__section"
					aria-labelledby="ordersTitle"
				>
					<h2 id="ordersTitle" className="help__h2">
						Orders
					</h2>

					<p className="help__text">
						You can check the status of your order anytime in your Orders page.
						If your order hasn’t been processed yet, you may update your
						shipping address.
					</p>

					<p className="help__text">
						If you experience payment or confirmation issues, please contact our
						support team — we’ll be happy to assist you.
					</p>

					<div className="help__actions">
						<button
							type="button"
							className="help__btn"
							onClick={() => goAuthOr(ORDERS_PATH)}
						>
							Orders
						</button>
					</div>
				</section>

				<div className="help__line" />

				{/* SHIPPING */}
				<section
					id="shipping"
					className="help__section"
					aria-labelledby="shippingTitle"
				>
					<h2 id="shippingTitle" className="help__h2">
						Shipping
					</h2>

					<p className="help__text">
						Each item is handmade. Production usually takes 1–2 weeks. Shipping
						starts after production is complete.
					</p>

					<dl className="help__info" aria-label="Shipping summary">
						<div className="help__row">
							<dt>Processing</dt>
							<dd>1–3 business days after production</dd>
						</div>
						<div className="help__row">
							<dt>Delivery</dt>
							<dd>Depends on region and carrier</dd>
						</div>
						<div className="help__row">
							<dt>Tracking</dt>
							<dd>Available if provided by the carrier</dd>
						</div>
					</dl>

					<div className="help__actions">
						<Link className="help__btn" to={POLICY_SHIPPING}>
							Shipping Policy
						</Link>
					</div>
				</section>

				<div className="help__line" />

				{/* RETURNS */}
				<section
					id="returns"
					className="help__section"
					aria-labelledby="returnsTitle"
				>
					<h2 id="returnsTitle" className="help__h2">
						Returns
					</h2>

					<p className="help__text">
						Returns depend on product type and condition. Full details are
						available on our Return Policy page.
					</p>

					<dl className="help__info" aria-label="Returns summary">
						<div className="help__row">
							<dt>Condition</dt>
							<dd>New, unworn, original condition</dd>
						</div>
						<div className="help__row">
							<dt>Request window</dt>
							<dd>Typically within 14 days</dd>
						</div>
						<div className="help__row">
							<dt>Return</dt>
							<dd>Follow the steps described in the policy</dd>
						</div>
					</dl>

					<div className="help__actions">
						<Link className="help__btn" to={POLICY_RETURN}>
							Return Policy
						</Link>
					</div>
				</section>

				<div className="help__line" />

				{/* POLICIES */}
				<section
					id="policies"
					className="help__section"
					aria-labelledby="policiesTitle"
				>
					<h2 id="policiesTitle" className="help__h2">
						Policies
					</h2>

					<p className="help__text">
						Standard pages customers expect in an e-commerce store. These routes
						are live so you can link to them now.
					</p>

					<ul className="help__policies" aria-label="Policies list">
						<li>
							<Link className="help__policyBtn" to={POLICY_PRIVACY}>
								Privacy Policy
							</Link>
						</li>
						<li>
							<Link className="help__policyBtn" to={POLICY_TERMS}>
								Terms of Service
							</Link>
						</li>
						<li>
							<Link className="help__policyBtn" to={POLICY_RETURN}>
								Return Policy
							</Link>
						</li>
						<li>
							<Link className="help__policyBtn" to={POLICY_SHIPPING}>
								Shipping Policy
							</Link>
						</li>
						<li>
							<Link className="help__policyBtn" to={POLICY_ACCESSIBILITY}>
								Accessibility Statement
							</Link>
						</li>
					</ul>
				</section>
			</div>
		</section>
	);
}
