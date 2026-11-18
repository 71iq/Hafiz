import * as THREE from 'three';
import {oilMaterial, palettes, studioReflection} from './oil.mjs';

const point=(coords)=>new THREE.Vector3(...coords);
function oilDrop(){
  const profile=new THREE.CurvePath();
  const segments=[[[0,.185],[.51,.178],[.853,.405],[.863,1.09]],
    [[.863,1.09],[.879,1.70],[.482,2.095],[.248,2.39]],
    [[.248,2.39],[.111,2.57],[.046,2.694],[.035,2.745]],
    [[.035,2.745],[.027,2.766],[.011,2.771],[0,2.769]]];
  for(const control of segments)profile.add(new THREE.CubicBezierCurve(...control.map(pair=>new THREE.Vector2(...pair))));
  return new THREE.LatheGeometry(profile.getPoints(38),112);
}
function tube(parent,path,radius,material){
  const curve=new THREE.CatmullRomCurve3(path.map(point));
  const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,24,radius,10,false),material); parent.add(mesh);
  const end=new THREE.Mesh(new THREE.SphereGeometry(radius,12,8),material);end.position.copy(point(path.at(-1)));parent.add(end);
}
function blade(length,width){
  const positions=[], colors=[], indices=[], segments=40, ribs=12;
  for(let row=0;row<=segments;row++)for(let col=0;col<=ribs;col++){
    const u=row/segments, v=col/ribs*2-1, shape=Math.pow(Math.max(.0002,Math.sin(Math.PI*u)),.71)*(1.10-.21*u);
    const across=width*.5*v*shape;
    positions.push(length*u,across+.038*Math.sin(Math.PI*u),.095*Math.sin(Math.PI*u)+width*(1-Math.abs(v))*.28*shape+across*(u-.5)*1.7);
    const midrib=Math.exp(-Math.abs(v)*30)*shape, pale=Math.max(0,-v)*.30;
    const vein=.020*Math.pow(.5+.5*Math.cos((u-.16*Math.abs(v))*Math.PI*28),8)*shape;
    const color=new THREE.Color('#687d43').lerp(new THREE.Color('#a9ac73'),midrib*.85+pale+vein);
    colors.push(color.r,color.g,color.b);
    if(row<segments&&col<ribs){const start=row*(ribs+1)+col;indices.push(start,start+ribs+1,start+1,start+1,start+ribs+1,start+ribs+2);}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();
  return new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.82}));
}
function aura(scene,shadow){
  const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{power:{value:0}},
    vertexShader:`varying vec2 pos;void main(){pos=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec2 pos;uniform float power;void main(){float fall=max(0.,1.-dot(pos,pos));float opacity=power*fall*fall*fall;float d=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))))-.5;gl_FragColor=vec4(${shadow?'0.37,0.20,0.055':'1.,.765,.235'},floor(opacity*255.+d+.5)/255.);}`});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(shadow?1.68:2.92,shadow?.19:3.10),mat);
  mesh.position.set(0,shadow?.075:1.56,-1.4);mesh.renderOrder=-3;scene.add(mesh);return mesh;
}
export function buildRig(scene){
  scene.add(new THREE.HemisphereLight(0xfffae0,0xaf946d,1.55));
  for(const [pos,power] of [[[-3,5,4],2.2],[[3,1,3],.65],[[3,4,-3],1.25]]){
    const light=new THREE.DirectionalLight(0xfffaeb,power);light.position.copy(point(pos));scene.add(light);
  }
  const root=new THREE.Group(), torso=new THREE.Group(), sprig=new THREE.Group();scene.add(root);root.add(torso);torso.add(sprig);
  const environment=studioReflection(), body=oilMaterial(true,environment), limb=oilMaterial(false,environment);
  const drop=new THREE.Mesh(oilDrop(),body); drop.scale.z=.81;torso.add(drop);
  const bark=new THREE.MeshStandardMaterial({color:0x796637,roughness:.94});
  sprig.position.set(0,2.731,.012);
  tube(sprig,[[0,0,0],[-.006,.084,0],[-.055,.176,-.013],[-.154,.268,-.025]],.026,bark);
  tube(sprig,[[-.018,.102,0],[.044,.137,-.003],[.100,.170,-.014]],.018,bark);
  tube(sprig,[[-.010,.077,.005],[.054,.095,.018],[.115,.086,.02]],.016,bark);
  const large=blade(.735,.176),small=blade(.515,.124);sprig.add(large,small);
  large.position.set(.075,.156,-.008);small.position.set(.071,.092,.018);
  const oval=new THREE.SphereGeometry(1,48,32);
  const feet=[-1,1].map(()=>{const mesh=new THREE.Mesh(oval,limb);root.add(mesh);return mesh;});
  const capsule=new THREE.CapsuleGeometry(1,1.55,14,40);
  const arms=[-1,1].map(()=>{const mesh=new THREE.Mesh(capsule,limb);torso.add(mesh);return mesh;});
  const halo=aura(root,false),shadow=aura(root,true);
  let seed=0x5a617974;const random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/4294967296);
  const motes=Array.from({length:6},(_,index)=>{const mesh=new THREE.Mesh(oval,new THREE.MeshBasicMaterial({color:index%2?0xdca53c:0xffd470,transparent:true,depthWrite:false}));
    root.add(mesh);return {mesh,x:(index%2?-1:1)*(.08+random()*.31),raise:.89+random()*.28,radius:.057+random()*.016};});
  return (pose,style)=>{
    root.position.set(...pose.root); torso.scale.set(pose.width,pose.height,1/(pose.width*pose.height)); torso.position.y=.19*(1-pose.height)-.177*pose.sit;
    const oil=palettes[style.color??'gold'];for(const mat of [body,limb])mat.uniforms.oil.value.set(...oil.map(channel=>channel/255));
    for(const [key,value] of Object.entries({...pose.face,eyeScale:style.eyes??.7,glow:pose.glow,fillHeight:pose.fillHeight,sweep:pose.sweep,drift:pose.drift}))body.uniforms[key].value=value;
    large.rotation.set(.07,-.09,(43+pose.leaf)*Math.PI/180);small.rotation.set(-.16,.10,(-12+pose.leafFollower)*Math.PI/180);
    feet.forEach((foot,index)=>{const sign=index?1:-1;
      foot.scale.set(.176+.043*pose.feet,.132-.024*pose.feet,.249+.052*pose.feet);
      foot.rotation.z=sign*(-.20+.14*pose.feet);foot.rotation.y=sign*.27;
      foot.position.set(sign*(.33+.13*pose.feet),.138-.024*pose.feet,.17+.34*pose.feet);
    });
    arms.forEach((arm,index)=>{const sign=index?1:-1,angle=pose.arms[index]*Math.PI/180,heart=index?0:pose.chest;
      const start=point([sign*(.79-.23*heart),1.006,.105+.53*heart]);
      const end=point([start.x+sign*.425*Math.sin(angle)*(1-heart)-sign*.33*heart,start.y-.425*Math.cos(angle)*(1-heart)-.15*heart,start.z+.11+.18*heart]);
      const direction=end.clone().sub(start);arm.position.copy(start).lerp(end,.5);arm.quaternion.setFromUnitVectors(point([0,1,0]),direction.clone().normalize());arm.scale.set(.121,direction.length()*1.18/3.55,.124);
    });
    const tight=style.level>=3;halo.scale.set(tight?.84:1,tight?.78:1,1);halo.position.y=tight?1.19:1.56;
    halo.material.uniforms.power.value=style.variant==='dark'?pose.halo*(tight?.24:.32):0;shadow.material.uniforms.power.value=style.variant==='light'?.135:0;
    motes.forEach(({mesh,x,raise,radius},index)=>{const progress=pose.motes[index]??0;mesh.visible=progress>0&&progress<1;
      mesh.position.set(x,2.76+raise*progress,.42);mesh.scale.setScalar(radius*(.80+.20*Math.sin(Math.PI*progress)));mesh.material.opacity=.92*Math.sin(Math.PI*progress)**1.1;});
  };
}
