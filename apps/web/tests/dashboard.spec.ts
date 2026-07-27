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
  await expect(page.getByRole("heading", { name: "Incident runs" })).toBeVisible();
  await page.getByRole("link", { name: body.executionId.slice(0, 12) }).click();
  await expect(page.getByRole("heading", { name: "Event timeline" })).toBeVisible();
  await expect(page.getByText("execution · succeeded")).toBeVisible();
});
