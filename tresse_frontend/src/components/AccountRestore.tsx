import { yupResolver } from "@hookform/resolvers/yup";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as Yup from "yup";
import { confirmAccountRestore } from "../api/auth";
import "../../styles/AccountRestore.css";

type FormData = {
	password: string;
	confirmPassword: string;
};

const schema: Yup.ObjectSchema<FormData> = Yup.object({
	password: Yup.string()
		.min(8, "Password must be at least 8 characters")
		.required("Password is required"),
	confirmPassword: Yup.string()
		.oneOf([Yup.ref("password")], "Passwords do not match")
		.required("Please confirm your password"),
}).required();

function getErrorMessage(e: unknown): string {
	if (e instanceof Error && typeof e.message === "string" && e.message.trim()) {
		return e.message.trim();
	}
	return "Something went wrong. Please try again.";
}

export default function AccountRestore() {
	const navigate = useNavigate();
	const { uidb64, token } = useParams<{ uidb64?: string; token?: string }>();

	const [serverError, setServerError] = useState<string | null>(null);
	const [successMsg, setSuccessMsg] = useState<string | null>(null);

	const missingParams = !uidb64 || !token;

	const timeoutRef = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			if (timeoutRef.current !== null) {
				window.clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<FormData>({
		resolver: yupResolver(schema),
		mode: "onSubmit",
		reValidateMode: "onChange",
	});

	const onSubmit = async (data: FormData) => {
		setServerError(null);
		setSuccessMsg(null);

		if (!uidb64 || !token) {
			setServerError("Invalid or expired restore link.");
			return;
		}

		try {
			const resp = await confirmAccountRestore({
				uidb64,
				token,
				new_password: data.password,
			});

			setSuccessMsg(resp?.message || "Account restored successfully.");

			timeoutRef.current = window.setTimeout(() => {
				navigate("/login-choice?next=%2Fdashboard", { replace: true });
			}, 600);
		} catch (e: unknown) {
			setServerError(getErrorMessage(e));
		}
	};

	return (
		<section className="accountRestore" aria-labelledby="accountRestoreTitle">
			<div className="accountRestore__content">
				<header className="accountRestore__header">
					<h1 id="accountRestoreTitle" className="accountRestore__title">
						Account Reactivation
					</h1>
					<p className="accountRestore__text">
						Set a new password to restore access to your TRESSE account.
					</p>
				</header>

				{missingParams ? (
					<section
						className="accountRestore__section"
						aria-labelledby="invalidLinkTitle"
					>
						<h2 id="invalidLinkTitle" className="accountRestore__h2">
							Link issue
						</h2>
						<p className="accountRestore__text">
							This restore link is invalid or incomplete.
						</p>
						<p className="accountRestore__text">
							Go to{" "}
							<Link className="accountRestore__link" to="/login-choice">
								Login
							</Link>{" "}
							or{" "}
							<Link className="accountRestore__link" to="/help">
								Help
							</Link>
							.
						</p>
					</section>
				) : (
					<section
						className="accountRestore__section"
						aria-labelledby="restoreFormTitle"
					>
						<h2 id="restoreFormTitle" className="accountRestore__h2">
							New password
						</h2>

						<form
							onSubmit={handleSubmit(onSubmit)}
							className="accountRestore__form"
							aria-label="Account restore form"
							noValidate
						>
							<div className="accountRestore__field">
								<label htmlFor="password" className="accountRestore__label">
									New Password
								</label>

								<input
									id="password"
									type="password"
									autoComplete="new-password"
									className="accountRestore__input"
									aria-invalid={errors.password ? "true" : "false"}
									aria-describedby={
										errors.password ? "passwordError" : undefined
									}
									{...register("password")}
								/>

								{errors.password ? (
									<p
										id="passwordError"
										className="accountRestore__error"
										role="alert"
										aria-live="polite"
									>
										{errors.password.message}
									</p>
								) : null}
							</div>

							<div className="accountRestore__field">
								<label
									htmlFor="confirmPassword"
									className="accountRestore__label"
								>
									Confirm Password
								</label>

								<input
									id="confirmPassword"
									type="password"
									autoComplete="new-password"
									className="accountRestore__input"
									aria-invalid={errors.confirmPassword ? "true" : "false"}
									aria-describedby={
										errors.confirmPassword ? "confirmPasswordError" : undefined
									}
									{...register("confirmPassword")}
								/>

								{errors.confirmPassword ? (
									<p
										id="confirmPasswordError"
										className="accountRestore__error"
										role="alert"
										aria-live="polite"
									>
										{errors.confirmPassword.message}
									</p>
								) : null}
							</div>

							<div className="accountRestore__actions">
								<button
									type="submit"
									className="black-button"
									disabled={isSubmitting}
								>
									{isSubmitting ? "RESTORING..." : "RESTORE ACCOUNT"}
								</button>
							</div>

							{serverError ? (
								<p
									className="accountRestore__error"
									role="alert"
									aria-live="polite"
								>
									{serverError}
								</p>
							) : null}

							{successMsg ? (
								<p
									className="accountRestore__success"
									role="status"
									aria-live="polite"
								>
									{successMsg}
								</p>
							) : null}

							<p className="accountRestore__text" style={{ marginTop: 18 }}>
								Need help?{" "}
								<Link className="accountRestore__link" to="/help">
									Contact support
								</Link>
								.
							</p>
						</form>
					</section>
				)}
			</div>
		</section>
	);
}
