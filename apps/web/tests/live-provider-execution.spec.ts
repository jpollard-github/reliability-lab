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
  await expect(page.getByRole("checkbox", { name: /retain this request/i })).not.toBeChecked();
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
    await expect(
      page.getByText(/retain this request with encrypted replay storage/i),
    ).toBeVisible();
    await expect(page.getByText(/this cannot be enabled retroactively/i)).toBeVisible();
  } finally {
    await context.close();
  }
});

test("retains one opted-in live execution and creates one replay plus one bounded variant", async ({
  page,
  request,
}) => {
  const before = (await (await request.get("http://127.0.0.1:4010/stats")).json()) as {
    requestCount: number;
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Bounded live input").fill("Small retained Playwright live proof.");
  await page.getByRole("checkbox", { name: /retain this request/i }).check();
  await page.getByRole("button", { name: "Run one live execution" }).click();
  await expect(page).toHaveURL(/\/executions\/[^/]+$/);
  const originalUrl = page.url();
  await expect(page.getByText("Execution succeeded", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Replay capsule is available", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay execution" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Compare with variant" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Delete replay data" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Replay execution" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  const afterOriginal = (await (await request.get("http://127.0.0.1:4010/stats")).json()) as {
    requestCount: number;
  };
  expect(afterOriginal.requestCount - before.requestCount).toBe(1);
  await page.getByRole("button", { name: "Start timeline playback" }).click();
  const afterPlayback = (await (await request.get("http://127.0.0.1:4010/stats")).json()) as {
    requestCount: number;
  };
  expect(afterPlayback.requestCount).toBe(afterOriginal.requestCount);

  await page.getByRole("button", { name: "Replay execution" }).click();
  await expect(page).toHaveURL(/\/executions\/[^/]+$/);
  await expect(page.getByText("Execution succeeded", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Replay capsule is available", { exact: true }).first(),
  ).toBeVisible();
  const afterReplay = (await (await request.get("http://127.0.0.1:4010/stats")).json()) as {
    requestCount: number;
  };
  expect(afterReplay.requestCount - before.requestCount).toBe(2);

  await page.goto(originalUrl);
  await page.getByRole("button", { name: "Compare with variant" }).click();
  await expect(page.getByText(/live target fixed by the server/i)).toBeVisible();
  await expect(page.getByText(/another provider request and may incur cost/i)).toBeVisible();
  await page.getByLabel("Comparison preset").selectOption("tighter");
  await page.getByRole("button", { name: "Create comparison" }).click();
  await expect(page).toHaveURL(/\/comparisons\/[^/]+$/);
  const variantMachine = page.getByRole("region", { name: "Variant machine" });
  await expect(variantMachine).toBeVisible();
  await expect(variantMachine.getByText("Execution succeeded", { exact: true })).toBeVisible();
  const afterVariant = (await (await request.get("http://127.0.0.1:4010/stats")).json()) as {
    requestCount: number;
  };
  expect(afterVariant.requestCount - before.requestCount).toBe(3);

  await page.goto(originalUrl);
  await expect(
    page.getByRole("heading", { name: "Attempts", exact: true }),
    "original evidence remains",
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete replay data" }).click();
  await expect(page.getByText("Retained replay data deleted.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Replay execution" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Compare with variant" })).toBeDisabled();
  expect(
    (
      (await (await request.get("http://127.0.0.1:4010/stats")).json()) as {
        requestCount: number;
      }
    ).requestCount,
  ).toBe(afterVariant.requestCount);
});
