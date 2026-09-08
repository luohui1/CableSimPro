import {test,expect} from '@playwright/test';

test('all cable field maps preserve equal physical coordinate scale',async({page})=>{
 await page.goto('/?legacy=1');await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await page.getByRole('button',{name:'场分析',exact:true}).click();
 for(const [name,title] of [['二维土壤热场','有限差分'],['绝缘电场','绝缘电场'],['三相外部磁场','磁感应强度']]){
  await page.getByRole('button',{name,exact:false}).click();
  await page.getByRole('button',{name:'运行场分析',exact:false}).click();
  await expect(page.getByTestId('field-title')).toContainText(title);
  const canvas=page.getByTestId('field-map-canvas');
  const ratio=await canvas.evaluate(el=>Number(el.dataset.scaleX)/Number(el.dataset.scaleY));
  expect(ratio).toBeCloseTo(1,10);
  if(name==='绝缘电场'){
   // Measure saturated cyan in the raster, not blue-grey antialiased axis text.
   // React draws after committing the title, so poll for the corresponding raster.
   await expect.poll(async()=>canvas.evaluate(el=>{
    const c=el as HTMLCanvasElement,ctx=c.getContext('2d')!;
    const d=ctx.getImageData(0,0,c.width,c.height).data;
    let minX=c.width,maxX=-1,minY=c.height,maxY=-1;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
     const i=(y*c.width+x)*4,r=d[i],g=d[i+1],b=d[i+2];
     if(g>120 && r<80 && b>100 && g-r>70){
      minX=Math.min(x,minX);maxX=Math.max(x,maxX);minY=Math.min(y,minY);maxY=Math.max(y,maxY);
     }
    }
    const width=maxX-minX,height=maxY-minY;
    return width>50 && height>50 ? width/height : 0;
   })).toBeCloseTo(1,1);
  }
 }
});
