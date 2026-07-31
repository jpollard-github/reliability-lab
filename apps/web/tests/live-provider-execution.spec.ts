import { expect, test } from "@playwright/test";

test("runs one configured live-provider request through the ordinary execution path", async ({
  page,
  request,
}) => {
  const before = (await (await request.get("http://127.0.0.1:4010/stats")).json()) as {
    requestCount: number;
  };
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Deterministic lab scenarios" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live provider execution" })).toBeVisible();
  await expect(page.getByText(/external provider request and may incur cost/i)).toBeVisible();
  await page.getByLabel("Bounded live input").fill("Small non-sensitive Playwright live proof.");
  await page.getByRole("button", { name: "Run one live execution" }).click();

  await expect(page).toHaveURL(/\/executions\/[^/]+$/);
  await expect(page.getByText("Execution succeeded", { exact: true })).toBeVisible();
  await expect(
    page
      .getByLabel("Execution state route")
      .getByText("openai-compatible / local-playwright-model", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTitle(/retention is disabled/i)).toBeVisible();
  const after = (await (await request.get("http://127.0.0.1:4010/stats")).json()) as {
    requestCount: number;
  };
  expect(after.requestCount - before.requestCount).toBe(1);
});

test("server-renders the configured live path without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Live provider execution" })).toBeVisible();
    await expect(page.getByLabel("Bounded live input")).toBeVisible();
    await expect(page.getByText(/not retained for replay by default/i)).toBeVisible();
  } finally {
    await context.close();
  }
});
