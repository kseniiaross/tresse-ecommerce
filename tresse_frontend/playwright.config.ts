import { defineConfig, devices } from "@playwright/test";

// tresse_frontend/.env sets VITE_API_URL to the deployed Railway backend,
// which the dev server would otherwise inherit — meaning e2e/monkey runs
// silently exercise an app whose requests are CORS-blocked against a
// backend that was never meant to serve local dev traffic. Env vars passed
// to the spawned `npm run dev` process (below) take precedence over
// tresse_frontend/.env for Vite, so this forces it back to a local API
// without touching that file. Override via LOCAL_API_URL if the backend
// runs somewhere other than 127.0.0.1:8000; e2e/monkey-test.spec.ts reads
// the same var to preflight-check the API before walking the app.
const LOCAL_API_URL = process.env.LOCAL_API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
	testDir: "./e2e",
	timeout: 30000,
	fullyParallel: false,
	reporter: "html",
	// Needed for `trace: "on-first-retry"` below to ever actually capture a
	// trace — with retries at the default 0, there is no first retry.
	retries: 1,
	use: {
		baseURL: "http://localhost:5173",
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: "npm run dev",
		url: "http://localhost:5173",
		// Only reuse an already-running dev server outside CI — in CI there is
		// never a pre-existing server, and reusing one there would silently run
		// against whatever a leftover process was configured with.
		reuseExistingServer: !process.env.CI,
		timeout: 30000,
		env: {
			VITE_API_URL: LOCAL_API_URL,
			VITE_BACKEND_URL: LOCAL_API_URL,
		},
	},
});
