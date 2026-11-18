import fs from 'node:fs';
import path from 'node:path';
import {cache,select,out,frameDir,mkdir,nameFrame,sharp,sha,json} from './common.mjs';
import {encode} from './encode.mjs';
const options={};
for(const job of select(process.argv.slice(2))){const base=fs.statSync(path.join(out,job.media)).size,dir=path.join(cache,'options',job.key);mkdir(dir);
  const trials=JSON.parse(fs.readFileSync(path.join(cache,'trials',job.key+'.json'))),quality=trials.at(-1).quality;
  const entry={base,droppingAnimationSaves:base,quality};
  if(job.tier==='S'){
    const hashes=[];for(let index=0;index<job.nominal_samples;index++){const dest=path.join(dir,nameFrame(index));const data=await sharp(path.join(frameDir(job),nameFrame(index))).resize(144,180,{kernel:'lanczos3'}).png().toBuffer();fs.writeFileSync(dest,data);hashes.push(sha(data));}
    json(path.join(dir,'capture.json'),{hashes});const dest=path.join(dir,'2.5x.webp');await encode(job,{quality,dir,dest});entry.at2point5x={bytes:fs.statSync(dest).size,saved:base-fs.statSync(dest).size};
  }
  if(['A07','A15'].includes(job.id)){const count=Math.round(job.seconds*20),entries=Array.from({length:count},(_,n)=>Math.round(n/(count-1)*(job.nominal_samples-1))),dest=path.join(dir,'20fps.webp');await encode(job,{quality,entries,dest});entry.at20fps={bytes:fs.statSync(dest).size,saved:base-fs.statSync(dest).size};}
  options[job.key]=entry;json(path.join(dir,'result.json'),entry);console.log(job.key,entry);
}
