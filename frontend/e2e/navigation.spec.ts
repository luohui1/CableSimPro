import { test, expect } from '@playwright/test';

test('model tree and property tabs stay synchronized', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', {name: '这次要研究什么？'})).toBeVisible();
  await page.getByRole('button', {name: '导体与层结构', exact: true}).click();
  await page.getByRole('button', {name: '敷设', exact: true}).click();
  await expect(page.getByLabel('平均中心埋深', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: '导体与层结构', exact: true}).click();
  await expect(page.getByLabel('导体截面积', {exact: true})).toBeVisible();
  await page.getByLabel('导体截面积', {exact: true}).fill('300');
  await page.getByRole('link', {name: 'CableSimPro', exact: true}).click();
  await expect(page.locator('.reference-model')).toContainText('300 mm²');
  expect(errors).toEqual([]);
});
