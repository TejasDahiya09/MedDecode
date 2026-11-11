import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { destinations } from '../../src/app/navigation';

const evidence = 'playwright-report/demo-sprint';
const apiCalls = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const calls: string[] = []; apiCalls.set(page,calls);
  page.on('request', request => { if (['fetch','xhr'].includes(request.resourceType())) calls.push(request.url()); });
});
test.afterEach(({ page }) => { expect(apiCalls.get(page)).toEqual([]); });
for (const theme of ['light','dark'] as const) for (const width of [1440,390]) {
  test(`all demo routes ${width} ${theme}: complete, responsive, local-only and captured`, async ({ page, baseURL }) => {
    const calls: string[] = []; const errors: string[] = [];
    page.on('request', request => { if (['fetch','xhr'].includes(request.resourceType())) calls.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({width,height:width === 1440 ? 900 : 844});
    await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
    await mkdir(evidence,{recursive:true});
    for (const item of destinations) {
      await page.goto(item.path); await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole('heading',{level:1})).toHaveText(item.path === '/home' ? 'Welcome, Demo User.' : item.label);
      await expect(page.getByText('Demo Mode',{exact:true})).toBeVisible();
      await expect(page.getByText('Not yet implemented')).toHaveCount(0);
      await expect(page.locator('.md-demo-footnote')).toContainText('In-memory only');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({path:`${evidence}/${baseURL?.includes(':4174') ? 'preview':'dev'}-${item.path.slice(1)}-${width}-${theme}.png`,fullPage:true});
    }
    expect(calls).toEqual([]); expect(errors).toEqual([]);
    expect(await page.evaluate(() => ({local:{...localStorage},session:{...sessionStorage},cookie:document.cookie}))).toEqual({local:{},session:{},cookie:''});
  });
}
for (const width of [1440,390]) {
  test(`cabinet and reminders ${width}: CRUD, validation, focus, visit state and reload reset`, async ({ page, baseURL }) => {
    await page.setViewportSize({width,height:width === 1440 ? 900:844});
    await page.goto('/my-cabinet'); const add = page.getByRole('button',{name:'Add medicine',exact:true}); await add.click();
    const dialog = page.getByRole('dialog',{name:'Add medicine',exact:true}); await expect(dialog).toBeVisible();
    await dialog.getByRole('button',{name:'Save cabinet item'}).click(); await expect(dialog.getByRole('alert')).toHaveText('Enter an example medicine name.'); await expect(dialog.getByLabel('Medicine name')).toBeFocused();
    await dialog.getByLabel('Medicine name').fill('Synthetic cabinet test'); await dialog.getByLabel('Quantity').fill('2'); await dialog.getByLabel('Storage label').fill('Example shelf C');
    await page.screenshot({path:`${evidence}/${baseURL?.includes(':4174') ? 'preview':'dev'}-cabinet-dialog-${width}.png`,fullPage:true});
    await dialog.getByRole('button',{name:'Save cabinet item'}).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(add).toBeFocused();
    await page.getByLabel('Search cabinet').fill('Synthetic'); await expect(page.getByRole('heading',{name:'Synthetic cabinet test'})).toBeVisible(); await page.getByLabel('Inventory filter').selectOption('stock'); await expect(page.getByText('No matching cabinet entries')).toBeVisible(); await page.getByLabel('Inventory filter').selectOption('low');
    await page.getByRole('button',{name:'Edit Synthetic cabinet test'}).click(); await page.getByLabel('Quantity').fill('9'); await page.getByRole('button',{name:'Save cabinet item'}).click(); await page.getByLabel('Inventory filter').selectOption('all'); await expect(page.getByText('9 example units')).toBeVisible();
    await page.getByRole('button',{name:'Remove Synthetic cabinet test'}).click(); await page.getByRole('dialog').getByRole('button',{name:'Cancel'}).click(); await expect(page.getByRole('heading',{name:'Synthetic cabinet test'})).toBeVisible();
    if (width === 1440) await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link',{name:'Home',exact:true}).click();
    else await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('link',{name:'Home',exact:true}).click();
    await expect(page.getByText('04',{exact:true})).toBeVisible();
    if (width === 1440) await page.getByRole('link',{name:'My Cabinet shortcut'}).click();
    else await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('link',{name:'Cabinet',exact:true}).click();
    await page.getByRole('button',{name:'Remove Synthetic cabinet test'}).click(); await page.getByRole('button',{name:'Confirm removal'}).click(); await expect(page.getByRole('heading',{name:'Synthetic cabinet test'})).toHaveCount(0);
    await page.getByRole('button',{name:'Add medicine',exact:true}).click(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto('/reminders'); await page.getByRole('button',{name:'Add reminder',exact:true}).click(); await page.getByLabel('Reminder title').fill('Synthetic review task'); await page.getByLabel('Time',{exact:true}).fill('11:45'); await page.getByRole('button',{name:'Save reminder'}).click();
    const toggle = page.getByRole('switch',{name:'Enable Synthetic review task'}); await expect(toggle).toHaveAttribute('aria-checked','true'); await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked','false');
    await page.getByRole('button',{name:'Edit Synthetic review task'}).click(); await page.getByLabel('Reminder title').fill('Synthetic revised task'); await page.getByRole('button',{name:'Save reminder'}).click(); await expect(page.getByRole('heading',{name:'Synthetic revised task'})).toBeVisible();
    await page.getByRole('button',{name:'Delete Synthetic revised task'}).click(); await page.getByRole('button',{name:'Confirm deletion'}).click(); await expect(page.getByRole('heading',{name:'Synthetic revised task'})).toHaveCount(0);
    while (await page.getByRole('button',{name:/^Delete /}).count()) { await page.getByRole('button',{name:/^Delete /}).first().click(); await page.getByRole('button',{name:'Confirm deletion'}).click(); }
    await expect(page.getByRole('heading',{name:'No example reminders'})).toBeVisible(); await page.reload(); await expect(page.getByRole('switch')).toHaveCount(3);
  });
  test(`explorer comparison upload resources ${width}: functional and honest`, async ({ page, baseURL }) => {
    await page.setViewportSize({width,height:844}); await page.goto('/medicine-insights');
    await page.getByLabel('Search example medicines').fill('Dune'); await page.getByRole('button',{name:/Dune/}).click(); await expect(page.getByRole('dialog').getByRole('heading',{name:'Dune — Sample 04'})).toBeVisible(); await expect(page.getByText('Not available in this demo',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Close dialog'}).click();
    await page.getByLabel('Search example medicines').fill('nomatch'); await expect(page.getByText('No examples found')).toBeVisible(); await page.getByRole('button',{name:'Clear search'}).click(); await expect(page.getByRole('group',{name:'Categories',exact:true}).getByRole('button',{name:'All',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.goto('/compare-medicines?a=cedar'); await page.getByRole('button',{name:'Choose medicine'}).click(); const picker=page.getByRole('dialog',{name:'Choose Medicine B'}); await picker.getByRole('searchbox').fill('Birch'); await picker.getByRole('listitem').click(); await page.getByRole('button',{name:'Swap medicines'}).click(); await expect(page).toHaveURL(/a=birch&b=cedar/); await page.getByRole('button',{name:'Clear comparison'}).click(); await expect(page.getByRole('heading',{name:'Choose Medicine A'})).toBeVisible(); await page.getByRole('button',{name:'Choose medicine'}).first().click(); await page.getByRole('dialog').getByRole('searchbox').fill('nothing'); await expect(page.getByText('No medicine examples found')).toBeVisible(); await page.keyboard.press('Escape');
    await page.goto('/upload-prescription'); const file = page.getByLabel('Choose prescription file'); await file.setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF synthetic example')}); await expect(page.getByText('synthetic.pdf',{exact:true})).toBeVisible(); await expect(page.getByRole('region',{name:'Sample analysis'})).toHaveCount(0);
    await page.getByRole('button',{name:'View Sample Analysis'}).click(); await expect(page.getByText('Sample Analysis — predefined example')).toBeVisible(); await expect(page.getByText(/Not an analysis of your selected file/)).toBeVisible();
    await page.screenshot({path:`${evidence}/${baseURL?.includes(':4174') ? 'preview':'dev'}-sample-analysis-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'Remove file'}).click(); await expect(page.getByText('synthetic.pdf',{exact:true})).toHaveCount(0); await expect(page.getByText('Sample Analysis — predefined example')).toHaveCount(0);
    await file.setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic')}); await expect(page.getByRole('alert')).toHaveText('Choose a JPG, PNG or PDF file.');
    await page.goto('/learn-resources'); await page.getByRole('combobox',{name:'Topic',exact:true}).selectOption('Responsible use'); await expect(page.locator('.md-demo-resource')).toHaveCount(2); await page.getByLabel('Search resources').fill('questions'); await page.getByRole('button',{name:'Read prepare questions for a professional'}).click(); await expect(page.getByRole('dialog')).toContainText('No external medical citation is claimed'); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await page.getByLabel('Search resources').fill('nomatch'); await expect(page.getByText('No resources found')).toBeVisible();
  });
}
test('tablet and narrow demo pages reflow, theme persists and modal traps focus', async ({ page }) => {
  for (const width of [768,320]) { await page.setViewportSize({width,height:1024}); for (const item of destinations) { await page.goto(item.path); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); } }
  await page.goto('/my-cabinet'); await page.getByRole('button',{name:'Switch to dark mode'}).click(); await page.getByRole('button',{name:'Add medicine',exact:true}).click(); const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('button',{name:'Close dialog'})).toBeFocused(); await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button',{name:'Save cabinet item'})).toBeFocused(); await page.keyboard.press('Tab'); await expect(dialog.getByRole('button',{name:'Close dialog'})).toBeFocused(); await page.keyboard.press('Escape'); await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});
