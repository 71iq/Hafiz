import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {out,bin,cache,select,mkdir,json,frameDir,nameFrame,manifest} from './common.mjs';
import {exactRects} from './patch-codec.mjs';
export function cap(job,still){return manifest.budget_bytes[(still?job.tier==='S'?'still_or_poster_S':'poster_'+job.tier:'animated_'+job.tier)]??null;}
export async function encode(job,{quality=83,entries,dest=path.join(out,job.media),dir=frameDir(job)}={}){
  mkdir(path.dirname(dest));const run=(name,args)=>execFileSync(path.join(bin,name),args,{stdio:['ignore','pipe','pipe']});
  if(job.mode==='still'){run('cwebp',['-quiet','-m','6','-q','87','-alpha_q','100',path.join(dir,nameFrame(0)),'-o',dest]);return;}
  const capture=JSON.parse(fs.readFileSync(path.join(dir,'capture.json'))),count=capture.hashes.length,frames=[];
  const timeline=entries||Array.from({length:count},(_,index)=>index);
  for(let n=0;n<timeline.length;n++){const index=timeline[n],ms=Math.round((n+1)*job.seconds*1000/timeline.length)-Math.round(n*job.seconds*1000/timeline.length);
    if(frames.at(-1)?.hash===capture.hashes[index])frames.at(-1).ms+=ms;else frames.push({hash:capture.hashes[index],index,ms});}
  if(['A06','A07','A15'].includes(job.id))return exactRects({dir,frames,dest,quality,loops:1});
  const args=['-loop',job.id==='A02'?'2':'1','-kmin','9','-kmax','17','-mixed','-m','6','-q',String(quality)];
  for(const frame of frames)args.push('-d',String(frame.ms),path.join(dir,nameFrame(frame.index)));args.push('-o',dest);run('img2webp',args);
}
if(process.argv[1]===new URL(import.meta.url).pathname){const jobs=select(process.argv.slice(2));if(!jobs.length)throw Error('No export selected');
  for(const job of jobs){const dir=frameDir(job),capture=JSON.parse(fs.readFileSync(path.join(dir,'capture.json'))),trials=[];
    for(const quality of [83,77,70]){await encode(job,{quality});const bytes=fs.statSync(path.join(out,job.media)).size;trials.push({quality,bytes,level:capture.level});if(!cap(job,false)||bytes<=cap(job,false)||job.mode==='still')break;}
    if(job.poster&&job.id!=='A02'){const dest=path.join(out,job.poster);execFileSync(path.join(bin,'cwebp'),['-quiet','-m','6','-q','87','-alpha_q','100',path.join(dir,'hold.png'),'-o',dest]);}
    const log=path.join(cache,'trials',job.key+'.json');let old=fs.existsSync(log)?JSON.parse(fs.readFileSync(log)):[];json(log,[...old.filter(t=>t.level!==capture.level),...trials]);console.log(job.key,trials);
  }
}
