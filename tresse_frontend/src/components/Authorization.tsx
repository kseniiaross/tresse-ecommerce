import { yupResolver } from "@hookform/resolvers/yup";
import { isAxiosError } from "axios";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import * as Yup from "yup";
import { loginUser } from "../api/auth";
import { fetchCart, mergeGuestCart } from "../store/serverCartSlice";
import { fetchWishlistCount } from "../store/wishListSlice";
import type { LoginFormData } from "../types/auth";
import type { User } from "../types/user";
import { setCredentials } from "../utils/authSlice";
import { useAppDispatch } from "../utils/hooks";

import "../../styles/Authorization.css";
import loginImage from "../assets/images/Login.webp";

const schema: Yup.ObjectSchema<LoginFormData> = Yup.object({
	email: Yup.string().email("Invalid email").required("Email is required"),
	password: Yup.string().required("Password is required"),
}).required();

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

function isSafePath(p: string | null): p is string {
	return !!p && p.startsWith("/") && !p.startsWith("//");
}

function toNonEmptyStringOrNull(v: unknown): string | null {
	return typeof v === "string" && v.trim() ? v.trim() : null;
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

type LoginResponse = {
	access: unknown;
	refresh?: unknown;
	user: unknown;
};

function isLoginResponse(v: unknown): v is LoginResponse {
	if (!isRecord(v)) return false;
	return "access" in v && "user" in v;
}

function getLoginErrorMessage(error: unknown): string {
	if (isAxiosError(error)) {
		const status = error.response?.status;

		if (status === 401 || status === 400) return "Invalid email or password.";

		const data = error.response?.data;
		if (typeof data === "object" && data !== null) {
			const record = data as Record<string, unknown>;
			const detail = record.detail;
			if (typeof detail === "string" && detail.trim()) return detail.trim();
		}

		return "Something went wrong. Please try again.";
	}

	// loginUser() in api/auth.ts already unwraps AxiosError into a plain
	// Error carrying the extracted server message (see getErrorMessage
	// there), so in practice this is the branch that actually runs. Use
	// that message instead of a generic "network error" fallback.
	if (error instanceof Error && error.message.trim()) {
		return error.message.trim();
	}

	return "Network error. Please try again.";
}

export default function Authorization() {
	const dispatch = useAppDispatch();
	const navigate = useNavigate();
	const location = useLocation();

	const [serverError, setServerError] = useState<string | null>(null);

	const params = new URLSearchParams(location.search);
	const rawNext = params.get("next");
	const safeNext = isSafePath(rawNext) ? rawNext : null;
	const nextParam = safeNext ? `?next=${encodeURIComponent(safeNext)}` : "";

	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<LoginFormData>({
		resolver: yupResolver(schema),
		mode: "onSubmit",
	});

	const onSubmit = async (data: LoginFormData) => {
		setServerError(null);

		try {
			const apiResult = await loginUser(data);

			if (!isLoginResponse(apiResult)) {
				setServerError("Login failed. Please try again.");
				return;
			}

			const access = toNonEmptyStringOrNull(apiResult.access);
			const refresh = toNonEmptyStringOrNull(apiResult.refresh);
			const user = toUserOrNull(apiResult.user);

			if (!access || !user) {
				setServerError("Login failed. Please try again.");
				return;
			}

			if (refresh) localStorage.setItem("refresh", refresh);

			dispatch(setCredentials({ token: access, user }));

			try {
				await dispatch(mergeGuestCart()).unwrap();
			} catch (e) {
				if (import.meta.env.DEV) console.warn("mergeGuestCart failed:", e);
			}

			try {
				await dispatch(fetchCart()).unwrap();
			} catch (e) {
				if (import.meta.env.DEV) console.warn("fetchCart failed:", e);
			}

			try {
				dispatch(fetchWishlistCount());
			} catch (e) {
				if (import.meta.env.DEV) console.warn("fetchWishlistCount failed:", e);
			}

			navigate(safeNext ?? "/", { replace: true });
		} catch (error: unknown) {
			setServerError(getLoginErrorMessage(error));
		}
	};

	const emailErrorId = errors.email ? "auth_email_error" : undefined;
	const passwordErrorId = errors.password ? "auth_password_error" : undefined;

	return (
		<section className="authorization" aria-label="Authorization">
			<div className="authorization__layout">
				{/* LEFT */}
				<div className="authorization__left">
					<div className="authorization__content">
						<h2 className="authorization__title">
							ENJOY THE BEST EXPERIENCE WITH&nbsp;US
						</h2>

						<p className="authorization__subtitle">
							Sign in to enjoy a personalized experience and get access to all
							our services.
						</p>

						<form
							onSubmit={handleSubmit(onSubmit)}
							className="authorization__form"
							aria-label="Login form"
							noValidate
						>
							<div className="authorization__field">
								<label className="authorization__label" htmlFor="auth_email">
									Email
								</label>
								<input
									className="authorization__input"
									id="auth_email"
									type="email"
									autoComplete="email"
									aria-invalid={errors.email ? "true" : "false"}
									aria-describedby={emailErrorId}
									{...register("email")}
								/>
								{errors.email ? (
									<div
										className="authorization__message authorization__message--error"
										id="auth_email_error"
										role="alert"
										aria-live="polite"
									>
										{errors.email.message}
									</div>
								) : null}
							</div>

							<div className="authorization__field">
								<label className="authorization__label" htmlFor="auth_password">
									Password
								</label>
								<input
									className="authorization__input"
									id="auth_password"
									type="password"
									autoComplete="current-password"
									aria-invalid={errors.password ? "true" : "false"}
									aria-describedby={passwordErrorId}
									{...register("password")}
								/>
								{errors.password ? (
									<div
										className="authorization__message authorization__message--error"
										id="auth_password_error"
										role="alert"
										aria-live="polite"
									>
										{errors.password.message}
									</div>
								) : null}
							</div>

							<div className="authorization__actions">
								<button
									type="submit"
									className="authorization__cta authorization__cta--primary"
									disabled={isSubmitting}
								>
									{isSubmitting ? "LOGGING IN..." : "LOG IN"}
								</button>

								<Link
									to={`/register${nextParam}`}
									className="authorization__cta authorization__cta--secondary"
									aria-label="Go to registration"
								>
									REGISTER
								</Link>
							</div>

							{serverError ? (
								<div
									className="authorization__message authorization__message--server"
									role="alert"
									aria-live="polite"
								>
									{serverError}
								</div>
							) : null}
						</form>
					</div>
				</div>

				{/* RIGHT */}
				<div className="authorization__right" aria-hidden="true">
					<div className="authorization__media">
						<img className="authorization__image" src={loginImage} alt="" />
					</div>
				</div>
			</div>
		</section>
	);
}
