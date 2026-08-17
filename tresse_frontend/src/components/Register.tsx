import { yupResolver } from "@hookform/resolvers/yup";
import axios from "axios";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";
import * as Yup from "yup";
import { registerUser } from "../api/auth";
import { fetchCart, mergeGuestCart } from "../store/serverCartSlice";
import { fetchWishlistCount } from "../store/wishListSlice";
import type { RegisterFormData } from "../types/auth";
import type { User } from "../types/user";
import { setCredentials } from "../utils/authSlice";
import { useAppDispatch } from "../utils/hooks";

import "../../styles/Register.css";
import registerImage from "../assets/images/Register.webp";

const schema = Yup.object({
	first_name: Yup.string().trim().required("First name is required"),
	last_name: Yup.string().trim().required("Last name is required"),
	phone_number: Yup.string()
		.trim()
		.matches(/^\+?[0-9\s().-]{7,20}$/, "Enter a valid phone number")
		.required("Phone number is required"),
	email: Yup.string()
		.trim()
		.email("Invalid email")
		.required("Email is required"),
	password: Yup.string()
		.required("Password is required")
		.min(8, "Password must be at least 8 characters"),
});

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

type RegisterResponse = {
	access: unknown;
	refresh?: unknown;
	user?: unknown;
};

function isRegisterResponse(v: unknown): v is RegisterResponse {
	if (!isRecord(v)) return false;
	return "access" in v;
}

function getServerMessage(error: unknown): string {
	if (axios.isAxiosError(error)) {
		const data = error.response?.data;

		if (typeof data === "object" && data !== null) {
			const d = data as Record<string, unknown>;

			if (typeof d.detail === "string" && d.detail.trim()) return d.detail;

			const keys = [
				"email",
				"password",
				"phone_number",
				"first_name",
				"last_name",
				"non_field_errors",
			];
			for (const key of keys) {
				const v = d[key];
				if (Array.isArray(v) && v.length && typeof v[0] === "string")
					return v[0];
				if (typeof v === "string" && v.trim()) return v;
			}
		}

		const status = error.response?.status;
		if (status === 400) return "Please check the form fields and try again.";
		return "Registration failed. Please try again.";
	}

	// registerUser() in api/auth.ts already unwraps AxiosError into a plain
	// Error carrying the extracted server message (see getErrorMessage
	// there), so in practice this is the branch that actually runs. Use
	// that message instead of a generic fallback.
	if (error instanceof Error && error.message.trim()) {
		return error.message.trim();
	}

	return "Registration failed. Please try again.";
}

export default function Register() {
	const dispatch = useAppDispatch();
	const navigate = useNavigate();
	const location = useLocation();

	const [serverError, setServerError] = useState<string | null>(null);

	const params = new URLSearchParams(location.search);
	const rawNext = params.get("next");
	const safeNext = isSafePath(rawNext) ? rawNext : null;

	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<RegisterFormData>({
		resolver: yupResolver(schema),
		mode: "onSubmit",
	});

	const onSubmit = async (data: RegisterFormData) => {
		setServerError(null);

		try {
			const apiResult = await registerUser(data);

			if (!isRegisterResponse(apiResult)) {
				setServerError("Registration failed. Please try again.");
				return;
			}

			const access = toNonEmptyStringOrNull(apiResult.access);
			const refresh = toNonEmptyStringOrNull(apiResult.refresh);
			const user = toUserOrNull(apiResult.user);

			if (!access) {
				setServerError("Registration failed. Please try again.");
				return;
			}

			if (refresh) localStorage.setItem("refresh", refresh);

			if (!user) {
				const next = safeNext ?? "/";
				navigate(`/authorization?next=${encodeURIComponent(next)}`, {
					replace: true,
				});
				return;
			}

			dispatch(setCredentials({ token: access, user }));

			await dispatch(mergeGuestCart()).unwrap();
			await dispatch(fetchCart()).unwrap();
			dispatch(fetchWishlistCount());

			navigate(safeNext ?? "/", { replace: true });
		} catch (error: unknown) {
			setServerError(getServerMessage(error));
		}
	};

	const ids = {
		firstName: errors.first_name ? "reg_first_name_error" : undefined,
		lastName: errors.last_name ? "reg_last_name_error" : undefined,
		phone: errors.phone_number ? "reg_phone_error" : undefined,
		email: errors.email ? "reg_email_error" : undefined,
		password: errors.password ? "reg_password_error" : undefined,
	};

	return (
		<section className="register" aria-label="Registration">
			<div className="register__layout">
				<div className="register__left">
					<div className="register__content">
						<h2 className="register__title">CREATE YOUR ACCOUNT</h2>

						<form
							onSubmit={handleSubmit(onSubmit)}
							className="register__form"
							aria-label="Registration form"
							noValidate
						>
							<div className="register__field">
								<label className="register__label" htmlFor="first_name">
									First Name
								</label>
								<input
									className="register__input"
									id="first_name"
									autoComplete="given-name"
									aria-invalid={errors.first_name ? "true" : "false"}
									aria-describedby={ids.firstName}
									disabled={isSubmitting}
									{...register("first_name")}
								/>
								{errors.first_name ? (
									<span
										className="register__error"
										id="reg_first_name_error"
										role="alert"
										aria-live="polite"
									>
										{errors.first_name.message}
									</span>
								) : null}
							</div>

							<div className="register__field">
								<label className="register__label" htmlFor="last_name">
									Last Name
								</label>
								<input
									className="register__input"
									id="last_name"
									autoComplete="family-name"
									aria-invalid={errors.last_name ? "true" : "false"}
									aria-describedby={ids.lastName}
									disabled={isSubmitting}
									{...register("last_name")}
								/>
								{errors.last_name ? (
									<span
										className="register__error"
										id="reg_last_name_error"
										role="alert"
										aria-live="polite"
									>
										{errors.last_name.message}
									</span>
								) : null}
							</div>

							<div className="register__field">
								<label className="register__label" htmlFor="phone_number">
									Phone Number
								</label>
								<input
									className="register__input"
									id="phone_number"
									type="tel"
									autoComplete="tel"
									inputMode="tel"
									aria-invalid={errors.phone_number ? "true" : "false"}
									aria-describedby={ids.phone}
									disabled={isSubmitting}
									{...register("phone_number")}
								/>
								{errors.phone_number ? (
									<span
										className="register__error"
										id="reg_phone_error"
										role="alert"
										aria-live="polite"
									>
										{errors.phone_number.message}
									</span>
								) : null}
							</div>

							<div className="register__field">
								<label className="register__label" htmlFor="email">
									Email
								</label>
								<input
									className="register__input"
									id="email"
									type="email"
									autoComplete="email"
									aria-invalid={errors.email ? "true" : "false"}
									aria-describedby={ids.email}
									disabled={isSubmitting}
									{...register("email")}
								/>
								{errors.email ? (
									<span
										className="register__error"
										id="reg_email_error"
										role="alert"
										aria-live="polite"
									>
										{errors.email.message}
									</span>
								) : null}
							</div>

							<div className="register__field">
								<label className="register__label" htmlFor="password">
									Password
								</label>
								<input
									className="register__input"
									id="password"
									type="password"
									autoComplete="new-password"
									aria-invalid={errors.password ? "true" : "false"}
									aria-describedby={ids.password}
									disabled={isSubmitting}
									{...register("password")}
								/>
								{errors.password ? (
									<span
										className="register__error"
										id="reg_password_error"
										role="alert"
										aria-live="polite"
									>
										{errors.password.message}
									</span>
								) : null}
							</div>

							<button
								type="submit"
								className="register__cta register__cta--primary"
								disabled={isSubmitting}
							>
								{isSubmitting ? "CREATING..." : "REGISTER"}
							</button>

							{serverError ? (
								<div
									className="register__serverError"
									role="status"
									aria-live="polite"
								>
									{serverError}
								</div>
							) : null}
						</form>
					</div>
				</div>

				<div className="register__right" aria-hidden="true">
					<div className="register__media">
						<img className="register__image" src={registerImage} alt="" />
					</div>
				</div>
			</div>
		</section>
	);
}
