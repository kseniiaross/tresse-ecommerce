export function isSafePath(p: string | null): p is string {
	return !!p && p.startsWith("/") && !p.startsWith("//");
}
