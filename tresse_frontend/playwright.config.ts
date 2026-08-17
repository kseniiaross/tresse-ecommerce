import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	timeout: 30000,
	fullyParallel: false,
	reporter: "html",
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
		reuseExistingServer: true,
		timeout: 30000,
	},
});
