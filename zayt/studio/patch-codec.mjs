import fs from 'node:fs';
import path from 'node:path';
import {sharp,nameFrame,save} from './common.mjs';

const u24=number=>{const buffer=Buffer.alloc(3);buffer.writeUIntLE(number,0,3);return buffer;};
function chunk(tag,data){const header=Buffer.alloc(8);header.write(tag);header.writeUInt32LE(data.length,4);return Buffer.concat([header,data,Buffer.alloc(data.length%2)]);}
function payload(webp){const bits=[];for(let offset=12;offset<webp.length;){const length=webp.readUInt32LE(offset+4),end=offset+8+length+(length%2);
  if(['VP8 ','ALPH','VP8L'].includes(webp.toString('ascii',offset,offset+4)))bits.push(webp.subarray(offset,end));offset=end;}return Buffer.concat(bits);}
export async function exactRects({dir,frames,dest,quality,loops}){
  const packets=[];let previous,width,height;
  for(const [ordinal,{index,ms}] of frames.entries()){const {data,info}=await sharp(path.join(dir,nameFrame(index))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    ({width,height}=info);let left=width,top=height,right=-1,bottom=-1;
    const sparse=Buffer.alloc(data.length),limit=ordinal===frames.length-1?0:2;let canBlend=!!previous;
    for(let row=0;row<height;row++)for(let col=0;col<width;col++){const offset=(row*width+col)*4,alpha=data[offset+3],old=previous?.[offset+3]||0;
      const changed=!previous?alpha>0:Math.abs(alpha-old)>limit||[0,1,2].some(ch=>Math.abs(data[offset+ch]*alpha-previous[offset+ch]*old)>255*limit);
      if(changed){left=Math.min(left,col);right=Math.max(right,col);top=Math.min(top,row);bottom=Math.max(bottom,row);
        if(alpha!==255)canBlend=false;else sparse.writeUInt32LE(data.readUInt32LE(offset),offset);}}
    if(right<0&&packets.length){packets.at(-1).ms+=ms;continue;}
    if(right<0){left=top=right=bottom=0;}left-=left%2;top-=top%2;
    const box={left,top,width:right-left+1,height:bottom-top+1},image=sharp(data,{raw:info}).extract(box);
    const options={effort:6,alphaQuality:100,quality,smartSubsample:true};const lossy=payload(await image.clone().webp(options).toBuffer());
    const exact=payload(await image.clone().webp({...options,lossless:true}).toBuffer());
    let imageData=exact.length<lossy.length?exact:lossy,blend=false;
    if(canBlend){const sparseImage=sharp(sparse,{raw:info}).extract(box);const sparseBits=payload(await sparseImage.webp({...options,lossless:true}).toBuffer());
      if(sparseBits.length<imageData.length){imageData=sparseBits;blend=true;}}
    if(!previous)previous=Buffer.alloc(data.length);
    for(let row=top;row<=bottom;row++){const start=(row*width+left)*4,end=start+box.width*4;
      if(!blend)data.copy(previous,start,start,end);else for(let o=start;o<end;o+=4)if(sparse[o+3])previous.writeUInt32LE(data.readUInt32LE(o),o);}
    packets.push({box,ms,image:imageData,blend});
  }
  const extended=chunk('VP8X',Buffer.concat([Buffer.from([18,0,0,0]),u24(width-1),u24(height-1)])),anim=Buffer.alloc(6);anim.writeUInt16LE(loops,4);
  const content=[Buffer.from('WEBP'),extended,chunk('ANIM',anim)];
  for(const {box,ms,image,blend} of packets)content.push(chunk('ANMF',Buffer.concat([u24(box.left/2),u24(box.top/2),u24(box.width-1),u24(box.height-1),u24(ms),Buffer.from([blend?0:2]),image])));
  save(dest,chunk('RIFF',Buffer.concat(content)));
}
