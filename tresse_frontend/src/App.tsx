import { Elements } from "@stripe/react-stripe-js";
import type { Stripe } from "@stripe/stripe-js";
import { useEffect, useLayoutEffect, useState } from "react";
import { useDispatch } from "react-redux";
import {
	Route,
	BrowserRouter as Router,
	Routes,
	useLocation,
} from "react-router-dom";
import { setOnUnauthorized } from "./api/axiosInstance";
import AccountRestore from "./components/AccountRestore";
import Authorization from "./components/Authorization";
import CookieConsent from "./components/cookies/CookieConsent";
import LoginChoice from "./components/LoginChoice";
import PasswordChange from "./components/PasswordChange";
import PasswordResetConfirm from "./components/PasswordResetConfirm";
import Register from "./components/Register";
import useAuthStorageSync from "./hooks/useAuthStorageSync";
import type { AppDispatch } from "./store";
import { fetchCart } from "./store/serverCartSlice";
import { fetchWishlistCount } from "./store/wishListSlice";
import type { User } from "./types/user";
import { logout, setCredentials } from "./utils/authSlice";
import PrivateRoute from "./utils/PrivateRoute";
import About from "./view/About";
import Cart from "./view/Cart";
import Contact from "./view/Contact";
import Dashboard from "./view/Dashboard";
import FAQ from "./view/FAQ";
import Footer from "./view/Footer";
import Header from "./view/Header";
import Help from "./view/Help";
import Home from "./view/Home";
import Order from "./view/Order";
import OrderHistory from "./view/OrderHistory";
import OrderSuccess from "./view/OrderSuccess";
import ProductCatalog from "./view/ProductCatalog";
import ProductDetail from "./view/ProductDetails";
import AccessibilityStatement from "./view/policies/AccessibilityStatement";
import CookiePolicy from "./view/policies/CookiePolicy";
import PrivacyPolicy from "./view/policies/PrivacyPolicy";
import ReturnPolicy from "./view/policies/ReturnPolicy";
import ShippingPolicy from "./view/policies/ShippingPolicy";
import TermsOfService from "./view/policies/TermsOfService";
import SizeGuide from "./view/SizeGuide";
import WishList from "./view/WishList";

import "../styles/CookieConsent.css";
import "./App.css";
import "../styles/Policy.css";

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

function toUserOrNull(v: unknown): User | null {
	if (!isRecord(v)) return null;

	const id = v.id;
	const email = v.email;

	if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) return null;
	if (typeof email !== "string" || !email.includes("@")) return null;

	const first_name = typeof v.first_name === "string" ? v.first_name : "";
	const last_name = typeof v.last_name === "string" ? v.last_name : "";

	return {
		id,
		email: email.trim().toLowerCase(),
		first_name,
		last_name,
	};
}

function isSafeNextPath(p: string): boolean {
	return p.startsWith("/") && !p.startsWith("//");
}

function ScrollToTop() {
	const { hash } = useLocation();

	useLayoutEffect(() => {
		if (hash) {
			const el = document.getElementById(hash.slice(1));
			if (el) el.scrollIntoView();
			return;
		}

		window.scrollTo(0, 0);
	}, [hash]);

	return null;
}

function OrderRouteWithStripe() {
	const [stripePromise, setStripePromise] =
		useState<Promise<Stripe | null> | null>(null);

	useEffect(() => {
		let mounted = true;

		(async () => {
			const mod = await import("./features/payments/stripe");

			if (!mounted) return;

			setStripePromise(mod.getStripePromise());
		})();

		return () => {
			mounted = false;
		};
	}, []);

	if (!stripePromise) {
		return <div style={{ padding: 24 }}>Loading checkout…</div>;
	}

	return (
		<Elements stripe={stripePromise}>
			<Order />
		</Elements>
	);
}

export default function App() {
	const dispatch = useDispatch<AppDispatch>();

	useAuthStorageSync();

	useEffect(() => {
		const token = localStorage.getItem("access");
		const userRaw = localStorage.getItem("user");

		if (token && userRaw) {
			try {
				const parsed: unknown = JSON.parse(userRaw);
				const user = toUserOrNull(parsed);

				if (user) {
					dispatch(setCredentials({ token, user }));
					dispatch(fetchCart());
					dispatch(fetchWishlistCount());
				} else {
					dispatch(logout());
				}
			} catch {
				dispatch(logout());
			}
		}

		setOnUnauthorized(() => {
			dispatch(logout());

			const next = window.location.pathname + window.location.search;
			const safeNext = isSafeNextPath(next) ? next : "/";

			const path = window.location.pathname;
			const onAuthPage =
				path.startsWith("/authorization") ||
				path.startsWith("/register") ||
				path.startsWith("/login-choice") ||
				path.startsWith("/reset-password") ||
				path.startsWith("/login") ||
				path.startsWith("/account/restore");

			if (!onAuthPage) {
				window.location.assign(
					`/login-choice?next=${encodeURIComponent(safeNext)}`,
				);
			}
		});

		return () => setOnUnauthorized(null);
	}, [dispatch]);

	return (
		<Router>
			<ScrollToTop />

			<div className="layout">
				<Header />

				<main className="layout-main">
					<Routes>
						<Route path="/" element={<Home />} />
						<Route path="/help" element={<Help />} />

						<Route
							path="/policies/terms-of-service"
							element={<TermsOfService />}
						/>
						<Route
							path="/policies/privacy-policy"
							element={<PrivacyPolicy />}
						/>
						<Route path="/policies/return-policy" element={<ReturnPolicy />} />
						<Route
							path="/policies/shipping-policy"
							element={<ShippingPolicy />}
						/>
						<Route
							path="/policies/accessibility-statement"
							element={<AccessibilityStatement />}
						/>
						<Route path="/policies/cookie-policy" element={<CookiePolicy />} />

						<Route path="/size-guide" element={<SizeGuide />} />
						<Route path="/faq" element={<FAQ />} />
						<Route path="/contact" element={<Contact />} />
						<Route path="/about" element={<About />} />

						<Route path="/catalog" element={<ProductCatalog />} />
						<Route path="/product/:id" element={<ProductDetail />} />
						<Route path="/cart" element={<Cart />} />

						<Route
							path="/account/restore/:uidb64/:token"
							element={<AccountRestore />}
						/>

						<Route path="/login-choice" element={<LoginChoice />} />
						<Route path="/login" element={<Authorization />} />
						<Route path="/authorization" element={<Authorization />} />
						<Route path="/register" element={<Register />} />
						<Route
							path="/reset-password/:uidb64/:token"
							element={<PasswordResetConfirm />}
						/>

						<Route
							path="/dashboard"
							element={
								<PrivateRoute>
									<Dashboard />
								</PrivateRoute>
							}
						/>

						<Route
							path="/account/change-password"
							element={
								<PrivateRoute>
									<PasswordChange />
								</PrivateRoute>
							}
						/>

						<Route
							path="/orders"
							element={
								<PrivateRoute>
									<OrderHistory />
								</PrivateRoute>
							}
						/>

						<Route path="/order/success" element={<OrderSuccess />} />

						<Route
							path="/order"
							element={
								<PrivateRoute>
									<OrderRouteWithStripe />
								</PrivateRoute>
							}
						/>

						<Route
							path="/wishlist"
							element={
								<PrivateRoute>
									<WishList />
								</PrivateRoute>
							}
						/>
					</Routes>
				</main>

				<Footer />
				<CookieConsent />
			</div>
		</Router>
	);
}
