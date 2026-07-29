import { expect, test } from "@playwright/test";

test("compares a retrying execution with an immediate-fallback variant", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Deterministic scenario").selectOption("retry");
  await page.getByRole("button", { name: "Start and watch execution" }).click();
  await expect(page.getByText("Retry scheduled", { exact: true })).toBeVisible();
  await expect(page.getByText("Execution succeeded", { exact: true })).toBeVisible();

  const compare = page.getByRole("button", { name: "Compare with variant" });
  await expect(compare).toBeEnabled();
  await compare.click();
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
