// 舞台：渲染器、相机、程序化环境光、地面、后期（选中描边）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const THEMES = {
  studio: { top: 0x0b1220, horizon: 0x26344a, ground: 0x151c28, floor: 0x1b2330, grid: 'rgba(160,190,230,0.10)', fog: 0x26344a, envTop: 0x9fb4d0, envHorizon: 0xe9eef5, envGround: 0x3a3f48, exposure: 1.0, sun: 3.0 },
  day: { top: 0x2f72cc, horizon: 0xc9dcee, ground: 0xa9b1b9, floor: 0x70777e, grid: 'rgba(20,28,36,0.16)', fog: 0xc9dcee, envTop: 0x6fa8e6, envHorizon: 0xf4f8fc, envGround: 0x7d838a, exposure: 0.84, sun: 3.1 },
};

export function createStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, container.clientWidth / container.clientHeight, 0.3, 4000);
  camera.position.set(-62, 24, 66);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 5.5, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 1.2; controls.maxDistance = 260;
  controls.maxPolarAngle = Math.PI * 0.497;
  controls.zoomSpeed = 0.9; controls.rotateSpeed = 0.7;
  controls.screenSpacePanning = true;

  // ---- 背景天穹（渐变着色器）----
  const skyU = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color() } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizon, ground, pow(clamp(-h*6.0,0.0,1.0), 0.6));
      gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);

  // ---- 程序化环境贴图（影棚：天光渐变 + 柔光箱）----
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  function buildEnv(t) {
    const es = new THREE.Scene();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: new THREE.Color(t.envTop) }, horizon: { value: new THREE.Color(t.envHorizon) }, ground: { value: new THREE.Color(t.envGround) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vP;
        void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.5)) : mix(horizon*0.55, ground, pow(clamp(-h*3.0,0.0,1.0), 0.5));
        gl_FragColor = vec4(c, 1.0); }`,
    }));
    es.add(dome);
    const box = (w, h, x, y, z, i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(i, i, i * 0.98), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); es.add(m);
    };
    box(30, 12, 12, 34, 18, 7.0);      // 主光（太阳侧）
    box(46, 8, -30, 24, -24, 2.6);     // 轮廓光
    box(60, 4, 0, 40, 0, 2.2);         // 顶光条
    box(20, 10, 34, 12, -20, 1.6);
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(es, 0.03);
    scene.environment = envRT.texture;
    es.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }

  // ---- 灯光 ----
  const sun = new THREE.DirectionalLight(0xfff3e2, 3.0);
  sun.position.set(30, 70, 38);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera; sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46; sc.near = 10; sc.far = 180;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x2a2f38, 0.55);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0x9db8e8, 0.55); fill.position.set(-40, 18, -50); scene.add(fill);

  // ---- 地面 ----
  const gridCv = document.createElement('canvas'); gridCv.width = gridCv.height = 512;
  const gridTex = new THREE.CanvasTexture(gridCv);
  gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping; gridTex.repeat.set(160, 160); gridTex.anisotropy = 8;
  gridTex.colorSpace = THREE.SRGBColorSpace;
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: gridTex, roughness: 0.82, metalness: 0.05 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.userData.noPick = true;
  scene.add(floor);
  function drawGrid(t) {
    const g = gridCv.getContext('2d'); const c = new THREE.Color(t.floor);
    g.fillStyle = '#' + c.getHexString(); g.fillRect(0, 0, 512, 512);
    // 混凝土板缝（每 10 m 一格，细分 5 m）
    g.strokeStyle = t.grid; g.lineWidth = 3; g.strokeRect(0, 0, 512, 512);
    g.lineWidth = 1; g.beginPath(); g.moveTo(256, 0); g.lineTo(256, 512); g.moveTo(0, 256); g.lineTo(512, 256); g.stroke();
    // 轻微噪点
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},0.012)`; g.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 5, 2 + Math.random() * 5); }
    gridTex.needsUpdate = true;
  }
  // 停机位引导线
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const apron = new THREE.Group();
  const lead = new THREE.Mesh(new THREE.PlaneGeometry(150, 0.3), lineMat); lead.rotation.x = -Math.PI / 2; lead.position.set(0, 0.006, 0);
  const stop = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 5), lineMat); stop.rotation.x = -Math.PI / 2;
  apron.add(lead, stop);
  apron.traverse(o => { o.receiveShadow = true; o.userData.noPick = true; });
  scene.add(apron);

  let theme = 'studio';
  function setTheme(name) {
    theme = name; const t = THEMES[name];
    skyU.top.value.set(t.top); skyU.horizon.value.set(t.horizon); skyU.ground.value.set(t.ground);
    scene.fog = new THREE.Fog(t.fog, 90, 640);   // 雾色与天穹地平线同色，远处地面才能无缝融进天空
    drawGrid(t); buildEnv(t);
    renderer.toneMappingExposure = t.exposure; sun.intensity = t.sun;
    hemi.intensity = name === 'day' ? 0.6 : 0.55;
    document.body.dataset.theme = name;
  }

  // ---- 后期：选中 / 悬停描边 ----
  const size = new THREE.Vector2(container.clientWidth, container.clientHeight);
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const outlineSel = new OutlinePass(size, scene, camera);
  outlineSel.edgeStrength = 4.5; outlineSel.edgeGlow = 0.35; outlineSel.edgeThickness = 1.6; outlineSel.pulsePeriod = 0;
  outlineSel.visibleEdgeColor.set(0x35c8ff); outlineSel.hiddenEdgeColor.set(0x1a5d86);
  const outlineHover = new OutlinePass(size, scene, camera);
  outlineHover.edgeStrength = 2.6; outlineHover.edgeGlow = 0.0; outlineHover.edgeThickness = 1.0;
  outlineHover.visibleEdgeColor.set(0xffffff); outlineHover.hiddenEdgeColor.set(0x56606c);
  composer.addPass(outlineHover); composer.addPass(outlineSel);
  composer.addPass(new OutputPass());

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h); composer.setSize(w, h);
  }
  window.addEventListener('resize', resize);

  function render() {
    sky.position.copy(camera.position);
    composer.render();
  }
  setTheme('studio');
  return { renderer, scene, camera, controls, sun, floor, apron, composer, outlineSel, outlineHover, render, resize, setTheme, get theme() { return theme; } };
}
