import * as THREE from 'three';

export const palettes = {lemon: [244,207,70], muted: [237,206,89], gold: [224,179,45]};

function studioReflection() {
  const width = 384, height = 192, pixels = new Uint8Array(width * height * 4);
  const panels = [[-0.91,0.75,0.24,0.11,0.40,1], [0.89,0.38,-0.55,0.075,0.56,0.85], [-0.5,-0.65,-0.55,0.32,0.075,0.24]];
  for (let row=0; row<height; row++) for (let col=0; col<width; col++) {
    const lon=((col+.5)/width-.5)*2*Math.PI, lat=((row+.5)/height-.5)*Math.PI;
    let intensity=0;
    for (const [x,y,z,rx,ry,weight] of panels) {
      const yaw=Math.atan2(x,z), pitch=Math.atan2(y,Math.hypot(x,z));
      const dx=Math.atan2(Math.sin(lon-yaw),Math.cos(lon-yaw))*Math.cos(pitch)/rx;
      const dy=(lat-pitch)/ry;
      intensity+=weight*Math.exp(-Math.pow(dx*dx+dy*dy,1.35));
    }
    const offset=(row*width+col)*4;
    pixels.fill(Math.min(255,Math.round(255*intensity)),offset,offset+3); pixels[offset+3]=255;
  }
  const texture=new THREE.DataTexture(pixels,width,height); texture.magFilter=texture.minFilter=THREE.LinearFilter;
  texture.wrapS=THREE.RepeatWrapping; texture.needsUpdate=true; return texture;
}

export function oilMaterial(body, reflection) {
  const uniforms=Object.fromEntries(Object.entries({body: Number(body), oil: new THREE.Vector3(), reflection,
    eyeOpen:1,eyeScale:.7,browHeight:0,browTilt:0,mouthCurve:0,blush:.5,highlight:1,glow:0,fillHeight:0,sweep:-2,drift:0}).map(([key,value])=>[key,{value}]));
  return new THREE.ShaderMaterial({uniforms,transparent:true,premultipliedAlpha:true,
    vertexShader:`varying vec3 p; varying vec3 n; void main(){p=position; n=normalMatrix*normal; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`precision highp float;
    varying vec3 p; varying vec3 n;
    uniform sampler2D reflection; uniform vec3 oil;
    uniform float body,eyeOpen,eyeScale,browHeight,browTilt,mouthCurve,blush,highlight,glow,fillHeight,sweep,drift;
    float sq(float x){return x*x;} float bell(vec2 v){return exp(-dot(v,v));}
    float ink(float distance){float aa=max(fwidth(distance)*.60,.0006);return 1.-smoothstep(-aa,aa,distance);}
    void main(){
      vec3 normal=normalize(n); float depth=max(normal.z,0.); float rim=pow(1.-depth,1.55);
      vec3 reflected=reflect(vec3(0.,0.,-1.),normal);
      float env=texture2D(reflection,vec2(atan(reflected.x,reflected.z)/6.283185+.5+drift,asin(clamp(reflected.y,-1.,1.))/3.141593+.5)).r;
      float key=max(dot(normal,normalize(vec3(-.62,.86,.60))),0.);
      float fill=max(dot(normal,normalize(vec3(.7,.17,.92))),0.);
      vec3 c=oil*(.77+.20*key+.11*fill);
      c=mix(c,vec3(.53,.335,.033),.62*pow(1.-depth,.65));
      c+=vec3(.095,.066,.007)*bell(vec2(normal.x/.76,(normal.y+.02)/.75));
      float border=exp(-sq((depth-.30)/.15));
      c=mix(c,vec3(1.,.84,.40),border*(.20+.35*max(normal.x,0.)));
      float caustic=bell(vec2((normal.x-.64)/.32,(normal.y+.58)/.30));
      c=mix(c,vec3(1.,.91,.49),caustic*.88);
      c=mix(c,vec3(1.,.99,.83),env*(body>.5?.73:.42));
      if(body>.5){
        float optical=pow(1.-depth,.66);
        c*=1.-.18*optical-.10*smoothstep(1.75,2.7,p.y);
        float inner=exp(-sq((depth-.40)/.11));
        c=mix(c,vec3(.99,.785,.275),inner*.43);
        c+=vec3(.09,.070,.019)*bell(vec2((p.x+.08)/.51,(p.y-1.12)/.79));
        float streakX=p.x+.38-.36*(p.y-1.80);
        float box=bell(vec2(streakX/.056,(p.y-1.80)/.257));
        float lobe=bell(vec2(streakX/.132,(p.y-1.82)/.45));
        c=mix(c,vec3(1.,.89,.51),lobe*.85);
        c=mix(c,vec3(1.,.996,.88),smoothstep(.20,.85,box)*.98);
        float focus=bell(vec2((normal.x-.66)/.19,(normal.y+.58)/.19));
        c=mix(c,vec3(1.,.981,.68),.88*focus);
        c+=vec3(.055,.045,.016)*bell(vec2((p.x-.25)/.53,(p.y-.51)/.25));
        float transmitted=bell(vec2((p.x-.22)/.67,(p.y-.72)/.44)); c+=vec3(.047,.045,.013)*transmitted;
        float band=exp(-sq((p.y-sweep)/.194))*smoothstep(.01,.43,depth);
        float lit=glow*(1.-smoothstep(fillHeight-.26,fillHeight+.23,p.y));
        float core=bell(vec2((p.x-.075)/.56,(p.y-1.16)/1.19));
        float opticalPath=smoothstep(.22,.91,depth)*(.31+.69*core);
        c+=lit*opticalPath*vec3(.34,.245,.047)*(1.-.73*env);
        c+=lit*core*vec3(.048,.044,.012);
        c+=band*vec3(.29,.275,.20);
        if(p.z>0.){
          vec2 cheek=vec2((abs(p.x)-.495)/.20,(p.y-.937)/.125);
          c=mix(c,vec3(.99,.48,.32),blush*.52*bell(cheek));
          vec2 eye=vec2(abs(p.x)-.39,p.y-1.096); float rad=.134*eyeScale;
          float ey=rad*(.095+.905*eyeOpen); vec2 uv=eye/vec2(rad,ey*1.055);
          float eyeMask=ink((length(uv)-1.)*min(rad,ey));
          vec3 iris=mix(vec3(.145,.084,.039),vec3(.50,.297,.083),smoothstep(.08,.95,-uv.y)*eyeOpen);
          iris=mix(iris,vec3(.086,.045,.023),.85*(1.-smoothstep(.46,.68,length(uv-vec2(0.,.14))))*eyeOpen);
          float glint=ink(length((p.xy-vec2(sign(p.x)*.39-rad*.28,1.096+ey*.31))/rad)-.205)*smoothstep(.35,.91,eyeOpen);
          c=mix(c,mix(iris,vec3(1.,.98,.89),glint*highlight),eyeMask);
          float bx=(abs(p.x)-.43)/.091;
          float by=1.39+browHeight+.025*(1.-bx*bx)-.013*bx+browTilt*bx;
          float brow=ink(length(vec2(max(abs(bx)-.83,0.)*.091,p.y-by))-.019*clamp(1.-.55*abs(bx),.18,1.));
          c=mix(c,vec3(.26,.154,.047),brow);
          float mx=clamp(p.x/ (.096+.012*mouthCurve),-1.,1.);
          float my=.925+(.040+.013*mouthCurve)*mx*mx;
          float mouth=ink(length(vec2(p.x-mx*(.096+.012*mouthCurve),p.y-my))-.0095);
          c=mix(c,vec3(.235,.126,.035),mouth);
        }
      }
      float opacity=1.-.13*pow(1.-depth,3.); gl_FragColor=vec4(clamp(c,0.,1.)*opacity,opacity);
    }`});
}

export {studioReflection};
