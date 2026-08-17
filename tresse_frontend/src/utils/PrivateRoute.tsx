import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAppSelector } from "./hooks";
import { isSafePath } from "./routing";

type Props = { children: ReactNode };

export default function PrivateRoute({ children }: Props) {
	const location = useLocation();
	const isLoggedIn = useAppSelector((s) => s.auth.isLoggedIn);

	if (isLoggedIn) return <>{children}</>;

	const nextRaw = `${location.pathname}${location.search}${location.hash || ""}`;
	const next = isSafePath(nextRaw) ? nextRaw : "/";

	return (
		<Navigate to={`/login-choice?next=${encodeURIComponent(next)}`} replace />
	);
}
