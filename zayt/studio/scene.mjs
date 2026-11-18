import * as THREE from "three";
import { buildRig } from "./model.mjs";

const renderer = new THREE.WebGLRenderer({
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
  premultipliedAlpha: true,
  powerPreference: "low-power",
});
renderer.setClearColor(0, 0);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(),
  apply = buildRig(scene);
const camera = new THREE.OrthographicCamera(-2, 2, 4.08, -0.09, 0.01, 20);
camera.position.z = 8;
window.setup = (width, height) => {
  renderer.setSize(width, height, false);
  camera.right = ((camera.top - camera.bottom) * width) / height / 2;
  camera.left = -camera.right;
  camera.updateProjectionMatrix();
  const gl = renderer.getContext();
  const driver = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    webgl: gl.getParameter(gl.VERSION),
    driver: gl.getParameter(driver.UNMASKED_RENDERER_WEBGL),
    three: THREE.REVISION,
  };
};
window.sample = (pose, style) => {
  apply(pose, style);
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/png").split(",")[1];
};
