import * as THREE from "three";
import { oilMaterial, palettes, studioReflection } from "./oil.mjs";

const point = (coords) => new THREE.Vector3(...coords);
function oilDrop() {
  const profile = new THREE.CurvePath();
  const segments = [
    [
      [0, 0.185],
      [0.51, 0.178],
      [0.853, 0.405],
      [0.863, 1.09],
    ],
    [
      [0.863, 1.09],
      [0.879, 1.7],
      [0.482, 2.095],
      [0.248, 2.39],
    ],
    [
      [0.248, 2.39],
      [0.111, 2.57],
      [0.046, 2.694],
      [0.035, 2.745],
    ],
    [
      [0.035, 2.745],
      [0.027, 2.766],
      [0.011, 2.771],
      [0, 2.769],
    ],
  ];
  for (const control of segments)
    profile.add(new THREE.CubicBezierCurve(...control.map((pair) => new THREE.Vector2(...pair))));
  return new THREE.LatheGeometry(profile.getPoints(38), 112);
}
function tube(parent, path, radius, material) {
  const curve = new THREE.CatmullRomCurve3(path.map(point));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, radius, 10, false), material);
  parent.add(mesh);
  const end = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material);
  end.position.copy(point(path.at(-1)));
  parent.add(end);
}
const armRings = 34,
  armSides = 32;
function armSurface() {
  const geometry = new THREE.BufferGeometry(),
    indices = [];
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array((armRings + 1) * armSides * 3), 3),
  );
  for (let row = 0; row < armRings; row++)
    for (let col = 0; col < armSides; col++) {
      const first = row * armSides + col,
        next = row * armSides + ((col + 1) % armSides);
      indices.push(first, next, first + armSides, next, next + armSides, first + armSides);
    }
  geometry.setIndex(indices);
  return geometry;
}
function shapeArm(mesh, sign, angle, heart, reach) {
  const anchor = point([sign * 0.755, 1.006, 0.09]),
    axis = point([sign * Math.sin(angle), -Math.cos(angle), 0.23]).normalize();
  const knots = [
    anchor,
    anchor.clone().addScaledVector(axis, 0.16),
    anchor.clone().addScaledVector(axis, 0.34 + 0.1 * reach),
    anchor.clone().addScaledVector(axis, 0.52 + 0.175 * reach),
  ];
  knots[1].x += sign * 0.048;
  knots[2].x += sign * 0.026;
  knots[1].y -= 0.086 * reach;
  knots[2].y -= 0.09 * reach;
  const chest = [
    [-0.715, 0.76, 0.18],
    [-0.77, 0.69, 0.46],
    [-0.45, 0.72, 0.7],
    [0.003, 0.84, 0.772],
  ];
  const curve = new THREE.CatmullRomCurve3(knots.map((v, i) => v.lerp(point(chest[i]), heart)));
  const coords = mesh.geometry.attributes.position;
  for (let row = 0; row <= armRings; row++) {
    const u = row / armRings,
      center = curve.getPointAt(u),
      tangent = curve.getTangentAt(u);
    const side = point([0, 0, 1]).cross(tangent).normalize(),
      front = tangent.clone().cross(side);
    const cap = Math.min(1, ((1 - u) * curve.getLength()) / 0.099),
      radius = (0.098 + 0.038 * (1 - u) ** 2) * Math.sqrt(Math.max(0.00001, 1 - (1 - cap) ** 2));
    for (let col = 0; col < armSides; col++) {
      const rad = (2 * Math.PI * col) / armSides,
        v = center
          .clone()
          .addScaledVector(side, radius * Math.cos(rad))
          .addScaledVector(front, radius * Math.sin(rad));
      coords.setXYZ(row * armSides + col, v.x, v.y, v.z);
    }
  }
  coords.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
}
function blade(length, width) {
  const positions = [],
    colors = [],
    indices = [],
    segments = 40,
    ribs = 12;
  for (let row = 0; row <= segments; row++)
    for (let col = 0; col <= ribs; col++) {
      const u = row / segments,
        v = (col / ribs) * 2 - 1,
        shape = Math.pow(Math.max(0.0002, Math.sin(Math.PI * u)), 0.71) * (1.1 - 0.21 * u);
      const across = width * 0.5 * v * shape;
      positions.push(
        length * u,
        across + 0.038 * Math.sin(Math.PI * u),
        0.095 * Math.sin(Math.PI * u) + width * (1 - Math.abs(v)) * 0.28 * shape + across * (u - 0.5) * 1.7,
      );
      const midrib = Math.exp(-Math.abs(v) * 30) * shape,
        pale = Math.max(0, -v) * 0.3;
      const vein = 0.02 * Math.pow(0.5 + 0.5 * Math.cos((u - 0.16 * Math.abs(v)) * Math.PI * 28), 8) * shape;
      const color = new THREE.Color("#687d43").lerp(new THREE.Color("#a9ac73"), midrib * 0.85 + pale + vein);
      colors.push(color.r, color.g, color.b);
      if (row < segments && col < ribs) {
        const start = row * (ribs + 1) + col;
        indices.push(start, start + ribs + 1, start + 1, start + 1, start + ribs + 1, start + ribs + 2);
      }
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.82 }),
  );
}
function aura(scene, profile) {
  const outline = [
    ...profile,
    ...profile
      .slice(1, -1)
      .reverse()
      .map(({ x, y }) => new THREE.Vector2(-x, y)),
  ];
  const positions = [],
    uv = [],
    indices = [];
  for (const [index, pos] of outline.entries()) {
    const next = (index + 1) % outline.length,
      before = outline[(index + outline.length - 1) % outline.length];
    const tangent = outline[next].clone().sub(before).normalize();
    for (const distance of [-0.018, 0.215]) {
      positions.push(pos.x + distance * tangent.y, pos.y - distance * tangent.x, -1.4);
      uv.push(distance / 0.215, 0);
    }
    indices.push(index * 2, index * 2 + 1, next * 2, next * 2, index * 2 + 1, next * 2 + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthWrite: false,
    uniforms: { power: { value: 0 } },
    vertexShader: `varying float radius;void main(){radius=uv.x;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying float radius;uniform float power;void main(){float a=power*(1.-smoothstep(0.,1.,radius));float d=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));a=floor(a*255.+d)/255.;gl_FragColor=vec4(vec3(1.,.677,.21)*a,a);}`,
  });
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.renderOrder = -3;
  scene.add(mesh);
  return mesh;
}
// An uneven fan keeps the sparks separated and the space above the twig clear.
const sparkTracks = [
  [-1.28, 0.29],
  [0.85, 0.83],
  [-0.9, 0.81],
  [1.34, 0.18],
  [-1.16, -0.28],
  [0.46, 1.12],
  [1.2, -0.39],
  [-0.41, 1.05],
];
function makeSparkles(scene) {
  const quad = new THREE.PlaneGeometry(0.21, 0.21);
  return sparkTracks.map(() => {
    const spark = new THREE.Mesh(
      quad,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { opacity: { value: 0 }, edged: { value: 0 } },
        vertexShader: `varying vec2 disc;void main(){disc=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `varying vec2 disc;uniform float opacity,edged;
        void main(){
          vec2 d=abs(disc);
          float r=pow(pow(d.x,.85)+pow(d.y,.85),1./.85);
          float a=1.-smoothstep(.46,1.,r);
          vec3 core=mix(vec3(1.,.82,.42),vec3(.97,.72,.27),edged);
          vec3 edge=mix(vec3(1.,.78,.35),vec3(.65,.40,.10),edged);
          gl_FragColor=vec4(mix(core,edge,smoothstep(.32,.58,r)),a*opacity);
        }`,
      }),
    );
    spark.renderOrder = 3;
    scene.add(spark);
    return spark;
  });
}
export function buildRig(scene) {
  scene.add(new THREE.HemisphereLight(0xfffae0, 0xaf946d, 1.55));
  for (const [pos, power] of [
    [[-3, 5, 4], 2.2],
    [[3, 1, 3], 0.65],
    [[3, 4, -3], 1.25],
  ]) {
    const light = new THREE.DirectionalLight(0xfffaeb, power);
    light.position.copy(point(pos));
    scene.add(light);
  }
  const root = new THREE.Group(),
    torso = new THREE.Group(),
    sprig = new THREE.Group();
  scene.add(root);
  root.add(torso);
  torso.add(sprig);
  const environment = studioReflection(),
    body = oilMaterial(true, environment),
    limb = oilMaterial(false, environment);
  const drop = new THREE.Mesh(oilDrop(), body);
  drop.scale.z = 0.81;
  torso.add(drop);
  const bark = new THREE.MeshStandardMaterial({ color: 0x796637, roughness: 0.94 });
  sprig.position.set(0, 2.731, 0.012);
  tube(
    sprig,
    [
      [0, 0, 0],
      [-0.006, 0.084, 0],
      [-0.055, 0.176, -0.013],
      [-0.154, 0.268, -0.025],
    ],
    0.026,
    bark,
  );
  tube(
    sprig,
    [
      [-0.018, 0.102, 0],
      [0.044, 0.137, -0.003],
      [0.1, 0.17, -0.014],
    ],
    0.018,
    bark,
  );
  tube(
    sprig,
    [
      [-0.01, 0.077, 0.005],
      [0.054, 0.095, 0.018],
      [0.115, 0.086, 0.02],
    ],
    0.016,
    bark,
  );
  const large = blade(0.735, 0.176),
    small = blade(0.515, 0.124);
  sprig.add(large, small);
  large.position.set(0.075, 0.156, -0.008);
  small.position.set(0.071, 0.092, 0.018);
  const oval = new THREE.SphereGeometry(1, 48, 32);
  const feet = [-1, 1].map(() => {
    const mesh = new THREE.Mesh(oval, limb);
    root.add(mesh);
    return mesh;
  });
  const arms = [-1, 1].map(() => {
    const mesh = new THREE.Mesh(armSurface(), limb);
    torso.add(mesh);
    return mesh;
  });
  const halo = aura(torso, drop.geometry.parameters.points);
  const sparks = makeSparkles(scene);
  let seed = 0x5a617974;
  const random = () => (seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296;
  const moteQuad = new THREE.PlaneGeometry(0.157, 0.157);
  const motes = Array.from({ length: 5 }, (_, index) => {
    const mesh = new THREE.Mesh(
      moteQuad,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { strength: { value: 0 } },
        vertexShader: `varying vec2 disc;void main(){disc=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `varying vec2 disc;uniform float strength;void main(){float a=1.-smoothstep(.17,1.,length(disc));gl_FragColor=vec4(1.,.82,.45,strength*a*a);}`,
      }),
    );
    scene.add(mesh);
    return {
      mesh,
      x: (index % 2 ? -1 : 1) * (0.08 + random() * 0.31),
      raise: 0.38 + random() * 0.07,
    };
  });
  return (pose, style) => {
    root.position.set(...pose.root);
    root.rotation.set(0, pose.spin || 0, pose.lean || 0, "ZXY");
    torso.scale.set(pose.width, pose.height, 1 / (pose.width * pose.height));
    torso.position.y = 0.19 * (1 - pose.height) - 0.177 * pose.sit;
    body.uniforms.breathHeight.value = pose.breathHeight || 0;
    body.uniforms.baseWidth.value = pose.baseWidth || 0;
    sprig.position.y = 2.731 + 2.55 * (pose.breathHeight || 0);
    const oil = palettes[style.color ?? "gold"];
    for (const mat of [body, limb]) mat.uniforms.oil.value.set(...oil.map((channel) => channel / 255));
    for (const [key, value] of Object.entries({
      joy: 0,
      ...pose.face,
      eyeArc: pose.face.eyeArc ?? pose.face.joy ?? 0,
      eyeScale: style.eyes ?? 0.7,
      glow: pose.glow,
      fillHeight: pose.fillHeight,
      sweep: pose.sweep,
      drift: pose.drift,
      chest: pose.chest,
    }))
      body.uniforms[key].value = value;
    large.rotation.set(0.07, -0.09, ((43 + pose.leaf) * Math.PI) / 180);
    small.rotation.set(-0.16, 0.1, ((-12 + pose.leafFollower) * Math.PI) / 180);
    feet.forEach((foot, index) => {
      const sign = index ? 1 : -1;
      foot.scale.set(0.179 + 0.055 * pose.feet, 0.158 + 0.011 * pose.feet, 0.249 + 0.058 * pose.feet);
      foot.rotation.z = sign * (-0.2 + 0.14 * pose.feet);
      foot.rotation.y = sign * (0.27 + 0.22 * pose.feet);
      foot.rotation.x = -0.35 * pose.feet;
      foot.position.set(sign * (0.33 + 0.2 * pose.feet), 0.16 + 0.034 * pose.feet, 0.17 + 0.48 * pose.feet);
    });
    arms.forEach((arm, index) => {
      const sign = index ? 1 : -1,
        angle = (pose.arms[index] * Math.PI) / 180,
        heart = index ? 0 : pose.chest;
      shapeArm(arm, sign, angle, heart, pose.arms[index] === 29 ? 0 : pose.reach || 0);
    });
    halo.visible = style.variant === "dark" && pose.halo > 0;
    halo.material.uniforms.power.value = pose.halo * 0.28;
    sparks.forEach((spark, index) => {
      const t = pose.burst,
        [x, y] = sparkTracks[index];
      spark.visible = index < pose.sparkleCount && t > 0 && t < 1;
      if (!spark.visible) return;
      const outward = 0.52 + 0.6 * (1 - (1 - t) ** 2);
      spark.position.set(x * outward, 1.8 + y * outward - 0.12 * t * t, 1.05);
      spark.rotation.z = 0.16 * ((index % 3) - 1);
      spark.material.uniforms.edged.value = Number(style.variant !== "dark");
      spark.material.uniforms.opacity.value = Math.min(1, t / 0.19) * (1 - t * t);
    });
    motes.forEach(({ mesh, x, raise }, index) => {
      const progress = pose.motes[index] ?? 0;
      mesh.visible = progress > 0 && progress < 1;
      mesh.position.set(x, 3.5 + raise * progress, -0.1);
      mesh.material.uniforms.strength.value = 0.96 * Math.sin(Math.PI * progress);
    });
  };
}
