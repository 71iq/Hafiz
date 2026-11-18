import * as THREE from "three";

export const palettes = { lemon: [244, 207, 70], muted: [237, 206, 89], gold: [224, 179, 45] };

function studioReflection() {
  const width = 384,
    height = 192,
    pixels = new Uint8Array(width * height * 4);
  const panels = [
    [-0.91, 0.75, 0.24, 0.11, 0.4, 1],
    [0.89, 0.38, -0.55, 0.075, 0.56, 0.85],
    [-0.5, -0.65, -0.55, 0.32, 0.075, 0.24],
  ];
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const lon = ((col + 0.5) / width - 0.5) * 2 * Math.PI,
        lat = ((row + 0.5) / height - 0.5) * Math.PI;
      let intensity = 0;
      for (const [x, y, z, rx, ry, weight] of panels) {
        const yaw = Math.atan2(x, z),
          pitch = Math.atan2(y, Math.hypot(x, z));
        const dx = (Math.atan2(Math.sin(lon - yaw), Math.cos(lon - yaw)) * Math.cos(pitch)) / rx;
        const dy = (lat - pitch) / ry;
        intensity += weight * Math.exp(-Math.pow(dx * dx + dy * dy, 1.35));
      }
      const offset = (row * width + col) * 4;
      pixels.fill(Math.min(255, Math.round(255 * intensity)), offset, offset + 3);
      pixels[offset + 3] = 255;
    }
  const texture = new THREE.DataTexture(pixels, width, height);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function oilMaterial(body, reflection) {
  const uniforms = Object.fromEntries(
    Object.entries({
      body: Number(body),
      oil: new THREE.Vector3(),
      reflection,
      eyeOpen: 1,
      eyeScale: 0.7,
      browHeight: 0,
      browTilt: 0,
      mouthCurve: 0,
      blush: 0.5,
      highlight: 1,
      glow: 0,
      fillHeight: 0,
      sweep: -2,
      drift: 0,
      breathHeight: 0,
      baseWidth: 0,
      chest: 0,
    }).map(([key, value]) => [key, { value }]),
  );
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    premultipliedAlpha: true,
    vertexShader: `varying vec3 p; varying vec3 n; uniform float breathHeight,baseWidth; void main(){p=position;vec3 surface=position;vec3 norm=normal;
      if(breathHeight>0.){float u=clamp((p.y-1.36)/1.38,0.,1.);float width=1.+baseWidth*(1.-smoothstep(.45,.85,p.y));float height=1.+breathHeight*2.55*(6.*u*(1.-u))/1.38;surface.x*=width;surface.y+=breathHeight*2.55*u*u*(3.-2.*u);surface.z/=width*height;norm=normal/vec3(width,height,1./(width*height));}
      n=normalMatrix*norm; gl_Position=projectionMatrix*modelViewMatrix*vec4(surface,1.);}`,
    fragmentShader: `precision highp float;
    varying vec3 p; varying vec3 n;
    uniform sampler2D reflection; uniform vec3 oil;
    uniform float body,eyeOpen,eyeScale,browHeight,browTilt,mouthCurve,blush,highlight,glow,fillHeight,sweep,drift,chest;
    float sq(float x){return x*x;} float bell(vec2 v){return exp(-dot(v,v));}
    float ink(float distance){float aa=max(fwidth(distance)*.60,.0006);return 1.-smoothstep(-aa,aa,distance);}
    void main(){
      vec3 normal=normalize(n); float depth=max(normal.z,0.); float rim=pow(1.-depth,1.55);
      vec3 reflected=reflect(vec3(0.,0.,-1.),normal);
      float env=texture2D(reflection,vec2(atan(reflected.x,reflected.z)/6.283185+.5+drift,asin(clamp(reflected.y,-1.,1.))/3.141593+.5)).r;
      float key=max(dot(normal,normalize(vec3(-.62,.86,.60))),0.);
      float fill=max(dot(normal,normalize(vec3(.7,.17,.92))),0.);
      float pathLength=1.-smoothstep(.38,.98,depth);
      vec3 c=oil-mix(vec3(0.),vec3(.055,.097,.116),pathLength);
      c=mix(c,oil-vec3(.137,.165,.118),1.-smoothstep(.02,.34,depth));
      c+=vec3(.01,.014,.004)*(key-.5);
      if(body<.5){
        c*=.84+.17*key+.06*fill;
        float softbox=bell(vec2((normal.x+.43)/.36,(normal.y-.60)/.27));
        c=mix(c,vec3(1.,.879,.46),.62*softbox+.12*env);
      }
      if(body>.5){
        c=mix(c,vec3(.978,.736,.235),.82*smoothstep(2.06,2.74,p.y));
        c=mix(c,vec3(1.,.853,.37),env*.29*(1.-smoothstep(-.3,.25,normal.x)));
        float lens=bell(vec2((normal.x-.73)/.20,(normal.y+.38)/.58));
        c=mix(c,vec3(.99,.759,.16),lens*.65);
        float streakX=p.x+.38-.36*(p.y-1.80);
        float box=bell(vec2(streakX/.056,(p.y-1.80)/.257));
        float lobe=bell(vec2(streakX/.132,(p.y-1.82)/.45));
        c=mix(c,vec3(1.,.89,.51),lobe*.85);
        c=mix(c,vec3(1.,.985,.81),smoothstep(.07,.75,box)*smoothstep(1.43,1.82,p.y)*.98);
        float pool=bell(vec2((normal.x-.60)/.47,(normal.y+.59)/.31));
        float focus=bell(vec2((normal.x-.64)/.21,(normal.y+.60)/.22));
        c=mix(c,vec3(1.,.795,.22),pool*.95);
        c=mix(c,vec3(1.,.905,.47),focus*.98);
        float band=exp(-sq((p.y-sweep)/.194))*smoothstep(.01,.43,depth);
        float lit=glow*(1.-smoothstep(fillHeight-.26,fillHeight+.23,p.y));
        float core=bell(vec2((p.x-.025)/.53,(p.y-1.18)/1.03));
        float opticalPath=smoothstep(.33,.90,depth)*(.27+.73*core);
        vec3 emission=mix(vec3(1.,.914,.659),vec3(1.,.953,.784),smoothstep(.50,1.,core));
        c=mix(c,emission,lit*opticalPath*(1.-.78*lobe));
        c+=band*vec3(.29,.275,.20);
        if(p.z>0.){
          vec2 shoulder=vec2(-.78,.93);vec2 armEnd=mix(vec2(-.99,.60),vec2(-.26,.69),chest)-shoulder;
          vec2 nearArm=p.xy-shoulder-armEnd*clamp(dot(p.xy-shoulder,armEnd)/dot(armEnd,armEnd),0.,1.);
          c*=1.-vec3(.18,.27,.29)*chest*exp(-dot(nearArm,nearArm)/.018);
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
    }`,
  });
}

export { studioReflection };
