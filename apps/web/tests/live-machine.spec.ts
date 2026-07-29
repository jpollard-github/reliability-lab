import { expect, test } from "@playwright/test";

test("shows a real retry transition from durable event evidence", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Deterministic scenario").selectOption("retry");
  await page.getByRole("button", { name: "Start and watch execution" }).click();

  await expect(page).toHaveURL(/\/executions\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Live execution machine" })).toBeVisible();
  await expect(page.getByText("Retry scheduled", { exact: true })).toBeVisible();
  await expect(page.getByText("1500 ms real backoff", { exact: false })).toBeVisible();
  await expect(page.getByText("Execution succeeded", { exact: true })).toBeVisible();
  await expect(page.getByText("Stream complete", { exact: true })).toBeVisible();
});
