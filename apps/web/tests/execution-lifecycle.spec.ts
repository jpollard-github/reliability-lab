import { expect, test } from "@playwright/test";
import { createExecution } from "./support/executions";

test("shows durable queue and worker evidence before terminal completion", async ({
  page,
  request,
}) => {
  const created = await createExecution(
    request,
    {
      provider: "fake-primary",
      model: "deterministic-v1",
      input: "Durable Playwright execution",
    },
    "durable",
  );
  expect(created.response.status()).toBe(202);
  expect(created.status).toBe("queued");

  await page.goto(`/executions/${created.executionId}`);
  await expect(page.getByText("Execution queued", { exact: true })).toBeVisible();
  await expect(page.getByText("Worker claimed execution", { exact: true })).toBeVisible();
  await expect(page.getByText("Execution succeeded", { exact: true })).toBeVisible();
});

test("lists an execution and opens its event timeline", async ({ page, request }) => {
  const created = await createExecution(request, {
    provider: "fake-primary",
    model: "deterministic-v1",
    input: "Playwright smoke execution",
  });
  expect(created.response.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reliability executions" })).toBeVisible();
  await page.getByRole("link", { name: created.executionId.slice(0, 12), exact: true }).click();
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
