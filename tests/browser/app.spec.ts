import { test, expect } from "@playwright/test";
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`sign-in page and keyboard navigation at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("http://127.0.0.1:54321/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "false" }),
    );
    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `artifacts/browser-evidence/sign-in-${viewport.width}.png`,
      fullPage: true,
    });
  });
}
test("real app health is public and readiness rejects an anonymous request", async ({
  request,
}) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  const ready = await request.get("/api/ready");
  expect(ready.status()).toBe(401);
});
