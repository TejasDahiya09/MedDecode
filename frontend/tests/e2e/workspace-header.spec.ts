import { expect, test } from '@playwright/test';
import { destinations } from '../../src/app/navigation';

for (const width of [1200,1280,1440,1728,768,390,320,1920]) test(`top shell ${width}: routes, search, utilities and keyboard`, async ({page,baseURL}) => {
  await page.setViewportSize({width,height:900});
  const services:string[]=[];
  page.on('request',request => {if(['xhr','fetch'].includes(request.resourceType())) services.push(request.url());});
  await page.goto('/home');
  await expect(page.locator('aside.md-sidebar, .md-layout, .md-header-theme')).toHaveCount(0);
  await expect(page.locator('.cc-top-nav')).toBeVisible();
  if(width < 1120) {
    await page.getByRole('button',{name:'Explore all sections'}).click();
    const drawer=page.getByRole('dialog');
    const search=drawer.getByRole('textbox',{name:'Find a workspace section'});
    await search.fill('Compare'); await search.press('Enter');
    await expect(drawer).toHaveCount(0); await expect(page).toHaveURL(/compare-medicines$/);
    for(const item of destinations) {
      await page.getByRole('button',{name:'Explore all sections'}).click();
      await page.getByRole('dialog').getByRole('navigation',{name:'All sections'}).getByRole('link',{name:new RegExp('^'+item.label)}).click();
      await expect(page).toHaveURL(new RegExp(item.path+'$'));
    }
  } else {
    if(width >= 1280) {
      for(const item of destinations) { await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link',{name:item.label,exact:true}).filter({visible:true}).click(); await expect(page).toHaveURL(new RegExp(item.path+'$')); }
      await expect(page.getByRole('main')).toBeFocused();
    }
    if(width <1280) {
      const more=page.getByLabel('More workspace sections',{exact:true}).filter({visible:true}).first();
      await more.focus(); await page.keyboard.press('Enter');
      await expect(page.getByRole('navigation',{name:'More workspace sections'})).toBeVisible();
      await page.keyboard.press('Escape'); await expect(more).toBeFocused();
    }
    if(width <1680) await page.getByRole('button',{name:'Open section search'}).click();
    const search=page.getByRole('textbox',{name:'Find a workspace section'});
    await search.fill('no section'); await expect(page.getByText('No matching sections.')).toBeVisible();
    await search.fill('Insights'); await search.press('ArrowDown');
    await expect(page.locator('.md-search-results').getByRole('link',{name:'Medicine Insights',exact:true})).toBeFocused();
    await page.keyboard.press('Enter'); await expect(page).toHaveURL(/medicine-insights$/);
  }
  if(width>=1120 && width<1440) await page.getByLabel('Workspace shortcuts',{exact:true}).first().click();
  await page.getByRole('link',{name:'Reminders shortcut'}).filter({visible:true}).click(); await expect(page).toHaveURL(/reminders$/);
  const profile=page.getByLabel('Demo User menu'); await profile.click();
  await expect(page.getByText('No authenticated session.',{exact:false})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(profile).toBeFocused();
  await page.getByRole('button',{name:'Switch to dark mode'}).click(); await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Demo User menu').click();
  await page.screenshot({path:`playwright-report/c1b/${baseURL?.includes('4174')?'preview':'dev'}-profile-${width}.png`});
  expect(services).toEqual([]);
});

for(const width of [320,390]) for(const theme of ['light','dark'] as const) test(`Home enlarged text ${width} ${theme}`,async({page,baseURL})=>{
  await page.setViewportSize({width,height:844}); await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'}); await page.goto('/home');
  await page.addStyleTag({content:'html {font-size:200% !important}'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByRole('heading',{level:1})).toBeVisible();
  for(const selector of ['.cc-home-welcome','.cc-home-kicker']) expect(await page.locator(selector).evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  for(const control of await page.locator('.cc-top-nav .cc-shell-avatar, .cc-shell-theme button, .cc-top-nav .cc-shell-utility:visible').all()) { const box=await control.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x+box!.width).toBeLessThanOrEqual(width); }
  await page.getByRole('button',{name:'Explore all sections'}).click();
  await expect(page.getByRole('dialog').getByRole('navigation',{name:'All sections'}).getByRole('link')).toHaveCount(7);
  await page.getByRole('dialog').getByRole('link',{name:/Learn & Resources/}).click(); await expect(page).toHaveURL(/learn-resources$/);
  await page.screenshot({path:`playwright-report/c1b/${baseURL?.includes('4174')?'preview':'dev'}-enlarged-${width}-${theme}.png`,fullPage:true});
});
