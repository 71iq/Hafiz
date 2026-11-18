import path from 'node:path';
import {cache,studio,out,sharp,save} from './common.mjs';
import {camera} from './capture.mjs';
import {rest} from './poses.mjs';
const reference=path.resolve(studio,'../../assets/images/zayt.png');
const svg=(width,height,body)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);
const text=(x,y,words,size=18,color='#3e382c')=>`<text x="${x}" y="${y}" font-family="DejaVu Sans" font-size="${size}" fill="${color}">${words}</text>`;
const uniform=(width,height,background)=>sharp({create:{width,height,channels:3,background}});
await camera(async capture=>{
  const cells=[],width=168,height=210;
  for(const [col,color] of ['lemon','muted','gold'].entries())for(const [row,eyes] of [1,.7].entries()){
    const file=path.join(cache,'reference',`${color}-${eyes}.png`);await capture([320,400],rest(),{color,eyes},null,file);
    for(const [side,bg] of ['#fff8f1','#000000'].entries())cells.push({input:await sharp(file).resize(width,height).flatten({background:bg}).png().toBuffer(),left:(side*3+col)*width,top:58+row*(height+28)});
  }
  const labels=['LEMON','MUTED 15%','DEEP GOLD'];let titles=text(16,26,'Oil and eye studies   /   Beige and AMOLED',19);
  for(let col=0;col<6;col++){titles+=text(col*width+12,51,labels[col%3],13);for(let row=0;row<2;row++)titles+=text(col*width+12,58+(row+1)*(height+28)-8,row?'70% eyes':'Reference eyes',13);}
  cells.push({input:svg(width*6,58+2*(height+28),titles),left:0,top:0});
  save(path.join(out,'reference-grid.png'),await uniform(width*6,58+2*(height+28),'#eee7d8').composite(cells).png().toBuffer());
  const canonical=await sharp(reference).resize(404,404).png().toBuffer(),ours=await sharp(path.join(cache,'reference','gold-0.7.png')).trim({background:'#00000000',threshold:0}).resize({height:356}).flatten({background:'#fcf9ed'}).png().toBuffer();
  save(path.join(out,'reference.png'),await uniform(808,463,'#fcf9ed').composite([{input:canonical,left:0,top:10},{input:ours,left:490,top:27},
    {input:svg(808,463,text(22,444,'01   Canonical render')+text(424,444,'02   Studio rest  /  deep gold, 70%')),left:0,top:0}]).png().toBuffer());
});
