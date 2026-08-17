import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api/axiosInstance";
import "../../styles/PasswordResetConfirm.css";

type ResetConfirmPayload = {
	uidb64: string;
	token: string;
	new_password: string;
	confirm_password: string;
};

function getErrorMessage(err: unknown): string {
	if (typeof err !== "object" || err === null) {
		return "Could not reset password. Please try again.";
	}

	const maybe = err as {
		response?: { data?: unknown };
		message?: unknown;
	};

	const data = maybe.response?.data;

	if (typeof data === "object" && data !== null) {
		const d = data as Record<string, unknown>;

		const detail = d.detail;
		if (typeof detail === "string" && detail.trim()) return detail.trim();
		if (
			Array.isArray(detail) &&
			typeof detail[0] === "string" &&
			detail[0].trim()
		)
			return detail[0].trim();

		const order = ["new_password", "confirm_password", "non_field_errors"];
		for (const key of order) {
			const v = d[key];
			if (typeof v === "string" && v.trim()) return v.trim();
			if (Array.isArray(v) && typeof v[0] === "string" && v[0].trim())
				return v[0].trim();
		}
	}

	if (typeof maybe.message === "string" && maybe.message.trim())
		return maybe.message.trim();

	return "Could not reset password. The link may be invalid or expired. Please request a new reset email.";
}

export default function PasswordResetConfirm() {
	const navigate = useNavigate();
	const params = useParams<{ uidb64?: string; token?: string }>();

	const uidb64 = useMemo(() => (params.uidb64 ?? "").trim(), [params.uidb64]);
	const token = useMemo(() => (params.token ?? "").trim(), [params.token]);

	const missingLink = !uidb64 || !token;

	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");

	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string>("");
	const [successMessage, setSuccessMessage] = useState<string>("");

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();

		setError("");
		setSuccessMessage("");

		if (missingLink) {
			setError(
				"Invalid or missing reset link. Please request a new password reset email.",
			);
			return;
		}

		if (password.length < 8) {
			setError("Password must be at least 8 characters.");
			return;
		}

		if (password !== confirmPassword) {
			setError("Passwords do not match.");
			return;
		}

		const payload: ResetConfirmPayload = {
			uidb64,
			token,
			new_password: password,
			confirm_password: confirmPassword,
		};

		try {
			setSubmitting(true);
			await api.post("/accounts/reset-password/confirm/", payload);

			setSuccessMessage(
				"Password has been reset successfully. Redirecting to login…",
			);
			setPassword("");
			setConfirmPassword("");

			window.setTimeout(() => {
				navigate("/login-choice", { replace: true });
			}, 900);
		} catch (err: unknown) {
			setError(getErrorMessage(err));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<section
			className="password-reset-confirm"
			aria-label="Password reset confirmation"
		>
			<div className="password-reset-confirm__container">
				<header className="password-reset-confirm__header">
					<h2 className="password-reset-confirm__title">Reset Password</h2>
					<p className="password-reset-confirm__subtitle">
						Set a new password to restore access to your account.
					</p>
				</header>

				{missingLink ? (
					<div
						className="password-reset-confirm__alert password-reset-confirm__alert--error"
						role="alert"
					>
						Invalid or missing reset link. Please request a new password reset
						email.{" "}
						<Link className="password-reset-confirm__link" to="/help">
							Need help?
						</Link>
					</div>
				) : null}

				{error ? (
					<div
						className="password-reset-confirm__alert password-reset-confirm__alert--error"
						role="alert"
					>
						{error}
					</div>
				) : null}

				{successMessage ? (
					<div
						className="password-reset-confirm__alert password-reset-confirm__alert--success"
						role="status"
					>
						{successMessage}
					</div>
				) : null}

				<form
					className="password-reset-confirm__form"
					onSubmit={handleSubmit}
					noValidate
				>
					<div className="password-reset-confirm__field">
						<label
							className="password-reset-confirm__label"
							htmlFor="new_password"
						>
							New Password
						</label>
						<input
							id="new_password"
							className="password-reset-confirm__input"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							autoComplete="new-password"
							disabled={submitting || missingLink}
							placeholder="At least 8 characters"
						/>
					</div>

					<div className="password-reset-confirm__field">
						<label
							className="password-reset-confirm__label"
							htmlFor="confirm_password"
						>
							Confirm Password
						</label>
						<input
							id="confirm_password"
							className="password-reset-confirm__input"
							type="password"
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							autoComplete="new-password"
							disabled={submitting || missingLink}
							placeholder="Repeat new password"
						/>
					</div>

					<button
						type="submit"
						className="password-reset-confirm__button password-reset-confirm__button--primary"
						disabled={submitting || missingLink}
					>
						{submitting ? "Saving…" : "Change Password"}
					</button>
				</form>
			</div>
		</section>
	);
}
