import path from 'node:path';
import {out,sharp,save,surfaces,select,cache} from './common.mjs';
import {decode,nominal} from './decoded.mjs';
import {peaks} from './poses.mjs';

const label=(width,height,lines)=>({input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${lines.map(([x,y,size,words])=>`<text x="${x}" y="${y}" font-family="DejaVu Sans" font-size="${size}" fill="#353623">${words}</text>`).join('')}</svg>`),left:0,top:0});
async function tile(item,pixels,width,height,bg){return sharp(pixels,{raw:{width:item.width,height:item.height,channels:4}}).flatten({background:bg}).resize(width,height,{fit:'fill'}).png().toBuffer();}
async function sheet(width,height,parts,file){save(file,await sharp({create:{width,height,channels:3,background:'#eee9df'}}).composite(parts).png().toBuffer());}
export async function contact(job,decoded){
  const count=job.nominal_samples,which=new Set([0,count-1,...peaks[job.id].map(time=>Math.round(time*(count-1)/job.seconds))]);
  for(let index=0;index<count;index+=6)which.add(index);
  const cellWidth=124,cellHeight=159,cols=Math.min(6,which.size),width=cols*cellWidth,height=56+cellHeight*Math.ceil(which.size/cols);
  const parts=[],labels=[[8,23,17,job.key],[8,44,11,'Nominal samples / 24 fps']];
  for(const [n,index] of [...which].sort((a,b)=>a-b).entries()){
    const left=(n%cols)*cellWidth,top=56+Math.floor(n/cols)*cellHeight;
    parts.push({input:await tile(decoded,nominal(decoded,job,index),110,138,job.variant==='dark'?surfaces[6]:surfaces[0]),left:left+7,top});
    labels.push([left+8,top+153,11,`${String(index).padStart(3,'0')}   ${(job.seconds*index/(count-1)||0).toFixed(2)} s`]);
  }
  parts.push(label(width,height,labels));await sheet(width,height,parts,path.join(out,'contacts',job.key+'.png'));
}
export async function strips(jobs,pilot=false){
  const file=pilot?'pilot-slots.png':'five-samples.png',parts=[],labels=[[8,22,16,pilot?'Budget pilot / beige and black, actual slot':'Five samples at 56 pt / first to last, then poster']];
  let y=35;const width=pilot?758:450;
  for(const job of jobs){const d=await decode(path.join(out,job.media)),height=pilot&&job.tier==='M'?112:56,w=Math.round(height*.8);
    for(const bg of pilot?[surfaces[0],surfaces[6]]:[job.variant==='dark'?surfaces[6]:surfaces[0]]){
      labels.push([6,y+height/2+3,11,job.key]);
      const poster=job.id==='A02'||!job.poster?d.frames.at(-1):(await decode(path.join(out,job.poster))).frames[0];
      for(let index=0;index<6;index++)parts.push({input:await tile(d,index===5?poster:nominal(d,job,Math.round(index*(job.nominal_samples-1)/4)),w,height,bg),left:115+index*(w+3)+(index===5?9:0),top:y});
      y+=height+3;
    }
  }
  parts.push(label(width,y,labels));await sheet(width,y,parts,path.join(out,file));
}
export async function surfacesSheet(jobs){const width=522,height=34+jobs.length*61,parts=[],labels=[[6,22,15,'Peak sample / eight app surfaces']];
  for(const [row,job] of jobs.entries()){const d=await decode(path.join(out,job.media));const peak=peaks[job.id][job.id==='A15'?3:0]||0;
    const sample=nominal(d,job,Math.round(peak*(job.nominal_samples-1)/job.seconds)||0),top=32+row*61;
    labels.push([6,top+31,11,job.key]);for(const [col,bg] of surfaces.entries())parts.push({input:await tile(d,sample,48,60,bg),left:116+col*50,top});}
  parts.push(label(width,height,labels));await sheet(width,height,parts,path.join(out,'surfaces.png'));
}
if(process.argv[1]===new URL(import.meta.url).pathname){const keys=process.argv.slice(2),jobs=select(keys);if(!jobs.length)throw Error('No export selected');
  for(const job of jobs)await contact(job,await decode(path.join(out,job.media)));
  await strips(jobs,keys[0]==='pilot');if(keys.includes('all'))await surfacesSheet(jobs);
}
