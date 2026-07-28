import { expect, test } from "@playwright/test";

test("lists an execution and opens its event timeline", async ({ page, request }) => {
  const create = await request.post("http://127.0.0.1:4000/v1/executions", {
    headers: {
      "x-tenant-id": "demo-tenant",
      "idempotency-key": `playwright-${Date.now()}`,
    },
    data: {
      provider: "fake-primary",
      model: "deterministic-v1",
      input: "Playwright smoke execution",
    },
  });
  expect(create.ok()).toBeTruthy();
  const body = (await create.json()) as { executionId: string };

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reliability executions" })).toBeVisible();
  await page.getByRole("link", { name: body.executionId.slice(0, 12) }).click();
  await expect(page.getByRole("heading", { name: "Live execution machine" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event timeline" })).toBeVisible();
  await expect(page.getByText("execution · succeeded")).toBeVisible();
  await expect(page.getByTitle("Replay capsule is available")).toBeVisible();

  await page.getByRole("button", { name: "Play event history" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText(/Step \d+ of \d+/)).toBeVisible();
  await page.getByRole("button", { name: "Step" }).click();
  await page.getByRole("button", { name: "Restart" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Live edge" }).click();
  await expect(page.getByText("Recorded history", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete replay data" }).click();
  await expect(page.getByTitle("Replay capsule was deleted")).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay execution" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Compare with variant" })).toBeDisabled();
});

test("shows a real retry transition while the execution is still running", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Deterministic scenario").selectOption("retry");
  await page.getByRole("button", { name: "Start and watch execution" }).click();

  await expect(page).toHaveURL(/\/executions\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Live execution machine" })).toBeVisible();
  await expect(page.getByText("Retry scheduled", { exact: true })).toBeVisible();
  await expect(page.getByText("1500 ms real backoff", { exact: false })).toBeVisible();
  await expect(page.locator(".live-machine .status-running")).toBeVisible();
  await expect(page.getByText("Execution succeeded", { exact: true })).toBeVisible();
  await expect(page.getByText("Stream complete", { exact: true })).toBeVisible();
});

test("compares a retrying execution with an immediate-fallback variant", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Deterministic scenario").selectOption("retry");
  await page.getByRole("button", { name: "Start and watch execution" }).click();
  await expect(page.getByText("Retry scheduled", { exact: true })).toBeVisible();
  await expect(page.getByText("Execution succeeded", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Compare with variant" }).click();
  await page.getByLabel("Comparison preset").selectOption("fallback");
  await page.getByRole("button", { name: "Create comparison" }).click();

  await expect(page).toHaveURL(/\/comparisons\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Original machine" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Variant machine" })).toBeVisible();
  await expect(page.getByText(/no universal winner/i)).toBeVisible();

  const retries = page.getByRole("row").filter({ hasText: "Retries" });
  await expect(retries).toContainText("1");
  await expect(retries).toContainText("0");
  await expect(retries).toContainText("improved");

  await page.getByRole("button", { name: "Play event history" }).first().click();
  await expect(page.getByText(/Step \d+ of \d+/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Original detail" })).toHaveAttribute(
    "href",
    /\/executions\//,
  );
  await expect(page.getByRole("link", { name: "Variant detail" })).toHaveAttribute(
    "href",
    /\/executions\//,
  );
});
