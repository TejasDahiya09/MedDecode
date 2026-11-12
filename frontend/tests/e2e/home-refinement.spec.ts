import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { destinations } from '../../src/app/navigation';

test.use({deviceScaleFactor:1});
const sizes=[{width:1440,height:900},{width:1728,height:900},{width:1280,height:800},{width:768,height:1024},{width:390,height:844},{width:320,height:844}];
for(const viewport of sizes) for(const theme of ['light','dark'] as const) test(`navigation and Home balance ${viewport.width} ${theme}`,async({page,baseURL})=>{
  const services:string[]=[];const errors:string[]=[];
  page.on('request',request=>{if(['fetch','xhr'].includes(request.resourceType()))services.push(request.url());});
  page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize(viewport);await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});await page.goto('/home');await page.evaluate(()=>document.fonts.ready);
  expect(await page.evaluate(()=>({scale:visualViewport!.scale,dpr:devicePixelRatio,zoom:getComputedStyle(document.documentElement).zoom,transform:getComputedStyle(document.querySelector('.cc-app-shell')!).transform}))).toEqual({scale:1,dpr:1,zoom:'1',transform:'none'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const nav=page.getByRole('navigation',{name:'Primary navigation'});
  if(viewport.width>=1280){
    await expect(nav.locator(':scope > a:visible')).toHaveText(destinations.map(item=>item.label));
    await expect(page.getByLabel('More workspace sections',{exact:true}).first()).toBeHidden();
    for(const item of destinations){await nav.getByRole('link',{name:item.label,exact:true}).filter({visible:true}).click();await expect(page).toHaveURL(new RegExp(item.path+'$'));await expect(nav.getByRole('link',{name:item.label,exact:true}).first()).toHaveAttribute('aria-current','page');if(item.path!='/home')await expect(page.getByRole('main')).toBeFocused();}
    await nav.getByRole('link',{name:'Home',exact:true}).click();await expect(page.getByRole('main')).toBeFocused();
    const boxes=await page.evaluate(()=>{const box=(s:string)=>document.querySelector(s)!.getBoundingClientRect().toJSON();return{brand:box('.cc-shell-brand'),nav:box('.cc-shell-primary-nav'),utilities:box('.cc-shell-utilities'),search:box('.cc-shell-search')};});
    expect(boxes.brand.right).toBeLessThanOrEqual(boxes.nav.x);expect(boxes.nav.right).toBeLessThanOrEqual(boxes.utilities.x);expect(boxes.utilities.right).toBeLessThanOrEqual(viewport.width);
    if(viewport.width>=1680){expect(boxes.nav.right).toBeLessThanOrEqual(boxes.search.x);expect(boxes.search.right).toBeLessThanOrEqual(boxes.utilities.x);}
    for(const link of await nav.locator(':scope > a').all()){await expect(link).toHaveCSS('font-size','12.8px');expect(await link.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);}
  }
  const primary=page.locator('.md-home > .cc-home-primary-grid');const actions=page.locator('.md-home > .cc-home-actions');
  await expect(primary.locator(':scope > section')).toHaveCount(2);await expect(actions.locator('.cc-home-action-tile')).toHaveCount(6);
  const geometry=await page.evaluate(()=>{
    const box=(selector:string)=>document.querySelector(selector)!.getBoundingClientRect().toJSON();const home=document.querySelector('.md-home')!;
    const sourceGap=parseFloat(getComputedStyle(home).gap);
    return{header:box('.cc-top-nav'),brand:box('.cc-shell-brand'),nav:box('.cc-shell-primary-nav'),navEntries:Array.from(document.querySelectorAll('.cc-shell-primary-nav > a')).map(el=>({label:el.textContent,...el.getBoundingClientRect().toJSON()})),search:box('.cc-shell-search'),searchTrigger:box('.cc-shell-search-trigger'),utilities:box('.cc-shell-utilities'),home:box('.md-home'),welcome:box('.cc-home-welcome'),primary:box('.cc-home-primary-grid'),prescriptions:box('.cc-home-continue.is-primary'),reminders:box('.md-home-reminders'),actions:box('.cc-home-actions'),tiles:box('.cc-home-action-grid'),activity:box('.cc-home-discover'),gap:sourceGap,columns:getComputedStyle(document.querySelector('.cc-home-action-grid')!).gridTemplateColumns,sourceNavFont:getComputedStyle(document.querySelector('.cc-shell-nav-link')!).fontSize};
  });
  expect(geometry.header.height).toBe(75);expect(geometry.welcome.y).toBeGreaterThanOrEqual(geometry.header.bottom);
  expect(geometry.actions.y-geometry.primary.bottom).toBeCloseTo(geometry.gap,1);expect(geometry.activity.y-geometry.actions.bottom).toBeCloseTo(geometry.gap,1);expect(geometry.actions.width).toBeCloseTo(geometry.primary.width,1);
  if(viewport.width>=980){expect(geometry.prescriptions.y).toBe(geometry.reminders.y);expect(Math.abs(geometry.prescriptions.height-geometry.reminders.height)).toBeLessThan(2);expect(geometry.columns.split(' ')).toHaveLength(3);}
  else {expect(geometry.reminders.y).toBeGreaterThan(geometry.prescriptions.bottom);expect(geometry.columns.split(' ')).toHaveLength(2);}
  const mode=baseURL?.includes('4174')?'preview':'dev';const folder='playwright-report/c1b1';await mkdir(folder,{recursive:true});await page.mouse.move(0,0);
  await page.screenshot({path:`${folder}/${mode}-${viewport.width}-${theme}-full.png`,fullPage:true});await page.screenshot({path:`${folder}/${mode}-${viewport.width}-${theme}-viewport.png`});
  const clearances=[];
  if(viewport.width<768){
    const bar=page.getByRole('navigation',{name:'Mobile navigation'});await expect(bar.getByRole('link')).toHaveCount(6);await expect(bar.getByRole('button')).toHaveCount(0);
    // Every action is scrollable clear of the viewport-fixed bar and remains clickable.
    for(const item of destinations.slice(1)){
      const link=actions.getByRole('link',{name:item.label,exact:true});await link.evaluate(el=>el.scrollIntoView({block:'end'}));const rect=(await link.boundingBox())!;const overlay=(await bar.boundingBox())!;expect(rect.y+rect.height).toBeLessThanOrEqual(overlay.y);clearances.push({label:item.label,bottom:rect.y+rect.height,barTop:overlay.y});await link.click();await expect(page).toHaveURL(new RegExp(item.path+'$'));await expect(page.getByRole('heading',{level:1})).toHaveText(item.label);await expect(page.getByRole('main')).toBeFocused();await page.goBack();await expect(page.getByRole('heading',{level:1})).toHaveText('Welcome, Demo User.');await expect(page.getByRole('main')).toBeFocused();
    }
    await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));const note=(await page.locator('.md-demo-footnote').boundingBox())!;const overlay=(await bar.boundingBox())!;expect(note.y+note.height).toBeLessThanOrEqual(overlay.y);clearances.push({label:'disclaimer',bottom:note.y+note.height,barTop:overlay.y});
    await page.screenshot({path:`${folder}/${mode}-${viewport.width}-${theme}-bottom-clearance.png`});
  }
  await writeFile(`${folder}/${mode}-${viewport.width}-${theme}-measurements.json`,JSON.stringify({...geometry,clearances,errors,services},null,2));expect(services).toEqual([]);expect(errors).toEqual([]);
});

test('constrained desktop More represents the active overflow route and supports keyboard',async({page})=>{
  await page.setViewportSize({width:1200,height:800});await page.goto('/reminders');const nav=page.getByRole('navigation',{name:'Primary navigation'});await expect(nav.locator(':scope > a:visible')).toHaveCount(5);
  const more=page.getByLabel('More workspace sections',{exact:true}).first();await expect(more).toHaveClass(/is-active/);await more.focus();await page.keyboard.press('Enter');const links=page.getByRole('navigation',{name:'More workspace sections'}).getByRole('link');await expect(links).toHaveText(['Reminders','Learn & Resources']);await expect(links.first()).toHaveAttribute('aria-current','page');await page.keyboard.press('Escape');await expect(more).toBeFocused();await more.click();await links.last().click();await expect(page).toHaveURL(/learn-resources$/);await expect(more).toHaveClass(/is-active/);await expect(page.getByRole('navigation',{name:'More workspace sections'})).toBeHidden();
});
