// End-to-end smoke test for NEXUS. Requires the backend (devserver on :8000) and the
// frontend (:3000) to be running. Uses the dev mock model, so no API key is needed.
//   npm run e2e:nexus            (CHROMIUM_PATH=/path/to/chrome to override the browser)
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const API = process.env.NEXUS_API || "http://localhost:8000";
const WEB = process.env.NEXUS_WEB || "http://localhost:3000";
const email = `e2e-${Date.now()}@test.dev`;

const reg = await fetch(`${API}/auth/register`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password: "e2e-password-123" }) });
assert.ok(reg.ok, `register failed: ${reg.status}`);
const { access_token } = await reg.json();

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript((t) => localStorage.setItem("mata_access", t), access_token);
await page.goto(`${WEB}/nexus/`, { waitUntil: "networkidle" });

// 1. Avatar canvas renders
await page.waitForSelector("canvas", { timeout: 15000 });
// 2. Honest status: dev mock badge shown when no provider is configured
await page.getByText(/dev mock/i).first().waitFor();
// 3. Conversation streams and memory is extracted
await page.getByLabel("Message NEXUS").fill("Hola, me llamo Erick y estoy creando una empresa");
await page.keyboard.press("Enter");
await page.getByText(/DEV MOCK/).first().waitFor({ timeout: 15000 });
await page.getByRole("button", { name: /Memory/ }).first().click();
await page.getByText("The user's name is Erick.", { exact: true }).waitFor({ timeout: 10000 });
await page.getByText("The user is working on: una empresa", { exact: true }).waitFor();
// 4. Security center lists permissions
await page.getByRole("button", { name: /Security/ }).first().click();
await page.getByText("CODE_EXECUTION").waitFor();
// 5. Tools panel marks unconfigured integrations honestly
await page.getByRole("button", { name: "TOOLS" }).click();
await page.getByText("email_send").waitFor();
assert.ok(await page.getByText(/integration not configured/).count() > 0);

assert.deepEqual(errors, [], "no uncaught page errors");
await browser.close();
console.log("NEXUS e2e: all checks passed");
