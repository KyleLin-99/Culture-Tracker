import { expect, test } from './fixtures';

test('someone sends feedback with the app version', async ({ signedIn: page, lab }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await page.getByText('An idea', { exact: true }).click();
  await page.getByLabel('Message').fill('Please add dark mode');
  await page.getByRole('button', { name: 'Send feedback' }).last().click();
  await expect(page.getByTestId('feedback-sent')).toBeVisible();
  const call = lab.rpcCalls.find((c) => c.fn === 'send_feedback')!.body as { p_kind: string; p_message: string; p_diagnostics: Record<string, string> };
  expect(call.p_kind).toBe('idea');
  expect(call.p_message).toBe('Please add dark mode');
  expect(call.p_diagnostics.platform).toBe('web');
  expect(call.p_diagnostics.app).toMatch(/^v\d+\.\d+\.\d+/);
});

test('diagnostics can be left out, and an empty message is refused', async ({ signedIn: page, lab }) => {
  await page.goto('/feedback');
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByText('Write a message first.')).toBeVisible();
  expect(lab.rpcCalls.filter((c) => c.fn === 'send_feedback')).toHaveLength(0);

  await page.getByLabel('Message').fill('Broken label');
  await page.getByText('No', { exact: true }).click();
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByTestId('feedback-sent')).toBeVisible();
  expect(lab.rpcCalls.find((c) => c.fn === 'send_feedback')?.body).toMatchObject({ p_kind: 'bug', p_diagnostics: {} });
});

test('the daily limit reads as a sentence', async ({ signedIn: page }) => {
  await page.route('**/rest/v1/rpc/send_feedback', (r) =>
    r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'LM001', message: 'limit_reached:feedback_per_day:5' }) }),
  );
  await page.goto('/feedback');
  await page.getByLabel('Message').fill('again');
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByText("You've reached your plan's limit for feedback messages a day (5).", { exact: false })).toBeVisible();
});

test('an admin reads the inbox and marks feedback done', async ({ signedIn: page, lab }) => {
  lab.admin.isAdmin = true;
  lab.admin.feedback = [
    { id: 'f1', created_at: '2026-11-23T10:00:00Z', email: 'friend@example.com', kind: 'bug', message: 'Label cut off', diagnostics: { app: 'v1.0.0', platform: 'ios' }, status: 'new', emailed: true },
  ];
  await page.goto('/admin/feedback');
  await expect(page.getByTestId('feedback-row')).toHaveText('[bug] Label cut off');
  await page.getByRole('button', { name: 'Mark done' }).click();
  await expect(page.getByRole('button', { name: 'Mark new' })).toBeVisible();
  expect(lab.rpcCalls.find((c) => c.fn === 'admin_set_feedback_status')?.body).toEqual({ p_id: 'f1', p_status: 'done' });
});
