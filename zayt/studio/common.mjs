import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
export const studio=path.dirname(fileURLToPath(import.meta.url)),out=path.resolve(studio,'../animations');
export const cache=process.env.ZAYT_CACHE||path.join(os.homedir(),'.cache/hafiz-zayt-studio');
export const dependency=createRequire(path.join(cache,'package.json')),sharp=dependency('sharp');sharp.concurrency(1);
export const bin=path.join(cache,'libwebp-1.6.0-linux-x86-64/bin');
export const manifest=JSON.parse(fs.readFileSync(path.join(studio,'animations.json')));
export const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
export const mkdir=dir=>fs.mkdirSync(dir,{recursive:true});
export const save=(file,data)=>{mkdir(path.dirname(file));fs.writeFileSync(file,data);};
export const json=(file,data)=>save(file,JSON.stringify(data,null,2)+'\n');
export const flags=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'];
export const jobs=manifest.animations.flatMap(anim=>Object.entries(anim.exports).flatMap(([role,exports])=>exports.map(spec=>{
  const {id,name}=anim,{tier,variant}=spec,stem=[id,name,variant].filter(Boolean).join('_');
  return {...anim,...spec,role,stem,key:[id,tier,variant].filter(Boolean).join('-'),size:manifest.tiers[tier].canvas_px,
    media:`${tier}/${stem}.webp`,poster:anim.mode==='still'?null:id==='A02'?'S/A01_rest_pose.webp':`${tier}/${stem}_poster.webp`};
})));
export const pilot=['A06-S','A07-S-light','A07-S-dark','A04-S','A15-M-light'];
export const select=keys=>keys.flatMap(key=>key==='pilot'?select(pilot):jobs.filter(job=>[job.key,job.phase,job.id,'all'].includes(key)));
export const frameDir=job=>path.join(cache,'frames',job.key);
export const nameFrame=index=>String(index).padStart(3,'0')+'.png';
export const surfaces=['#FFF8F1','#F9F3EB','#FFFFFF','#F8FAFC','#0A0A0A','#141414','#000000','#030303'];
