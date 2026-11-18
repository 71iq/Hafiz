import path from 'node:path';
import fs from 'node:fs';
import {dependency,cache,studio,flags,sharp,sha,save,json} from './common.mjs';
export async function camera(work){
  const bundle=await dependency('esbuild').build({entryPoints:[path.join(studio,'scene.mjs')],bundle:true,write:false,logLevel:'silent',nodePaths:[path.join(cache,'node_modules')],format:'iife'});
  const browser=await dependency('playwright').chromium.launch({args:flags,env:{...process.env,LD_LIBRARY_PATH:process.env.ZAYT_LD_LIBRARY_PATH||'/home/ehab/.local/share/elpsy-browser-runtime/root/usr/lib/x86_64-linux-gnu'}});
  try{const page=await browser.newPage();await page.context().setOffline(true);await page.route('**/*',route=>route.abort());
    page.on('pageerror',error=>console.error(error));page.on('console',msg=>{if(msg.type()==='error')console.error(msg.text());});
    await page.setContent('<!doctype html><title>Oil studio</title>');await page.addScriptTag({content:bundle.outputFiles[0].text});
    let current='';
    await work(async(size,pose,style,master,file)=>{
      const [width,height]=size;
      if(current!==size.join('x')){const gpu=await page.evaluate(([w,h])=>window.setup(w*2,h*2),size);if(!gpu.driver.includes('SwiftShader')||!gpu.webgl.startsWith('WebGL 2'))throw Error(JSON.stringify(gpu));
        const browsers=JSON.parse(fs.readFileSync(path.join(cache,'node_modules/playwright-core/browsers.json')));
        json(path.join(cache,'tools.json'),{node:process.version,playwright:dependency('playwright/package.json').version,chromium:browser.version(),chromiumBuild:browsers.browsers.find(b=>b.name==='chromium-headless-shell').revision,flags,...gpu,threePackage:JSON.parse(fs.readFileSync(path.join(cache,'node_modules/three/package.json'))).version,esbuild:dependency('esbuild').version,sharp:sharp.versions.sharp,libvips:sharp.versions.vips,encoder:'libwebp img2webp/cwebp 1.6.0',libwebp:sharp.versions.webp});
        current=size.join('x');}
      const encoded=await page.evaluate(([value,look])=>window.sample(value,look),[pose,style]);
      const source=await sharp(Buffer.from(encoded,'base64')).ensureAlpha().raw().toBuffer();
      if(pose.opacity!==1)for(let index=0;index<source.length;index+=4){source[index+3]=Math.round(source[index+3]*pose.opacity);if(!source[index+3])source.fill(0,index,index+3);}
      if(master)save(master,await sharp(source,{raw:{width:width*2,height:height*2,channels:4}}).png().toBuffer());
      const target=Buffer.alloc(width*height*4);
      for(let row=0;row<height;row++)for(let col=0;col<width;col++){
        const start=(row*width*4+col*2)*4,next=start+width*8,dest=(row*width+col)*4;
        const aa=source[start+3],ab=source[start+7],ac=source[next+3],ad=source[next+7],alpha=aa+ab+ac+ad;
        target[dest+3]=Math.round(alpha/4);if(!target[dest+3])continue;
        for(let ch=0;ch<3;ch++)target[dest+ch]=Math.round((source[start+ch]*aa+source[start+4+ch]*ab+source[next+ch]*ac+source[next+4+ch]*ad)/alpha);
      }
      save(file,await sharp(target,{raw:{width,height,channels:4}}).png().toBuffer());return sha(source);
    });
  }finally{await browser.close();}
}
