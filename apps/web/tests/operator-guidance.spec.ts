import { expect, test } from "@playwright/test";
import { createExecution, waitForExecution } from "./support/executions";

test("opens the Guide from primary navigation and exposes honest operator guidance", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Guide", exact: true }).click();

  await expect(page).toHaveURL("/guide");
  const primaryNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(primaryNavigation).toBeVisible();
  await expect(primaryNavigation.getByRole("link")).toHaveCount(5);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 1, name: "Reliability Lab guide" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Guide actions" })).toHaveCount(0);

  const orientation = page.locator("section[aria-labelledby='orientation-heading']");
  await expect(
    orientation.getByRole("heading", {
      level: 2,
      name: "Make policy-driven LLM executions observable and replayable",
    }),
  ).toBeVisible();
  await expect(
    orientation.getByRole("heading", { level: 2, name: "Evidence boundaries" }),
  ).toBeVisible();
  await expect(
    orientation.locator("dt").filter({ hasText: /^Execution versus attempt$/ }),
  ).toBeVisible();
  await expect(
    orientation.locator("dt").filter({ hasText: /^Normalized evidence versus replay input$/ }),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", {
      name: "Execute → Explain → Watch → Replay → Compare → Investigate → Preserve",
    }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Five scenarios" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Glossary" })).toBeVisible();
  await expect(
    page.getByText("The product does not claim exactly-once provider effects."),
  ).toBeVisible();
  await expect(page.getByText(/not a universal provider-health ranking/i)).toBeVisible();

  const workflow = page.locator(".guide-workflow");
  await expect(workflow.getByRole("heading", { level: 3 })).toHaveText([
    "Execute",
    "Explain",
    "Watch",
    "Replay",
    "Compare",
    "Investigate",
    "Preserve",
  ]);
  await expect(workflow.getByRole("link")).toHaveCount(7);
  await expect(
    workflow.getByRole("link", {
      name: "Deterministic scenario and Start and watch execution",
    }),
  ).toHaveAttribute("href", "/");
  await expect(workflow.getByRole("link", { name: "Investigation Workbench" })).toHaveAttribute(
    "href",
    "/investigations",
  );
  await expect(
    workflow.getByRole("link", { name: "Save investigation or Create a case" }),
  ).toHaveAttribute("href", "/investigation-cases");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("navigates an on-demand tour without changing product state and restores focus", async ({
  page,
}) => {
  await page.goto("/");
  const originalUrl = page.url();
  const launcher = page.getByRole("button", { name: "Tour this page" });
  await launcher.click();

  const tour = page.getByRole("dialog", { name: "Executions page tour" });
  await expect(tour).toBeVisible();
  await expect(tour.getByText("Step 1 of 5: Execution summary")).toBeVisible();
  await expect(page.locator('[data-guide-anchor="execution-summary"]')).toHaveAttribute(
    "data-guide-active",
    "true",
  );

  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByText("Step 2 of 5: Deterministic scenario")).toBeVisible();
  await expect(page.locator('[data-guide-anchor="execution-scenario"]')).toHaveAttribute(
    "data-guide-active",
    "true",
  );
  await tour.getByRole("button", { name: "Back" }).click();
  await expect(tour.getByText("Step 1 of 5: Execution summary")).toBeVisible();

  await expect(page).toHaveURL(originalUrl);
  await expect(page.getByLabel("Deterministic scenario")).toHaveValue("success");
  await tour.getByRole("button", { name: "Exit" }).click();
  await expect(tour).toBeHidden();
  await expect(launcher).toBeFocused();

  const help = page.locator("details").filter({
    hasText: "How should I read a deterministic execution?",
  });
  await help.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(help).toHaveAttribute("open", "");
  await expect(help.getByText("What should I look for?")).toBeVisible();
});

test("keeps the tour usable at 390px and reports a skipped optional target", async ({
  page,
  request,
}) => {
  const created = await createExecution(request, {
    provider: "fake-primary",
    model: "deterministic-v1",
    input: "Operator guidance optional-anchor evidence",
  });
  expect(created.response.status()).toBe(202);
  await waitForExecution(request, created.executionId, "succeeded");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/executions/${created.executionId}`);
  await page
    .locator('[data-guide-anchor="replay-capability"]')
    .evaluate((element) => element.removeAttribute("data-guide-anchor"));
  await page.getByRole("button", { name: "Tour this page" }).click();

  const tour = page.getByRole("dialog", { name: "Execution detail tour" });
  await expect(tour).toBeVisible();
  await expect(tour.getByText("1 unavailable optional step was skipped.")).toBeVisible();
  await expect(tour.getByRole("button", { name: "Exit" })).toBeVisible();
  await expect(tour.getByRole("button", { name: "Restart" })).toBeVisible();
  const panelBox = await tour.boundingBox();
  const layoutWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(panelBox).not.toBeNull();
  expect(panelBox!.x).toBeGreaterThanOrEqual(0);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(layoutWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
