// 材质库：外观材质 + 结构/系统示意材质，并支持"透视 (X-ray)"与剖切
import * as THREE from 'three';

export const U = {
  xray: { value: 0 },            // 0 = 实体, 1 = 透视
  xrayTint: { value: new THREE.Color(0x6fb6ff) },
};

export const M = {};                 // 具名材质
export const skinMats = new Set();   // 受透视/剖切影响的"蒙皮类"材质
export const allMats = new Set();

function patchXray(m) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uXray = U.xray;
    sh.uniforms.uXrayTint = U.xrayTint;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uXray;\nuniform vec3 uXrayTint;')
      .replace('#include <opaque_fragment>', `
        if (uXray > 0.001) {
          float fr = 1.0 - abs(dot(normalize(vViewPosition), normalize(normal)));
          float a = mix(0.035, 0.62, pow(fr, 2.4));
          diffuseColor.a *= mix(1.0, a, uXray);
          vec3 ghost = uXrayTint * (0.25 + 1.1 * pow(fr, 1.6)) + outgoingLight * 0.25;
          outgoingLight = mix(outgoingLight, ghost, uXray);
        }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'xray';
}

function def(name, params, o = {}) {
  const Cls = o.basic ? THREE.MeshBasicMaterial : (o.std ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial);
  const m = new Cls(params);
  m.name = name;
  if (o.skin) { skinMats.add(m); patchXray(m); m.userData.skin = true; }
  m.userData.base = { transparent: !!params.transparent, opacity: params.opacity ?? 1, depthWrite: params.depthWrite ?? true, side: params.side ?? THREE.FrontSide };
  allMats.add(m);
  M[name] = m;
  return m;
}

export function buildMaterials() {
  // ---- 外表面（蒙皮类）----
  const paint = { roughness: 0.34, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.12, envMapIntensity: 1.0 };
  def('fusePaint', { color: 0xffffff, ...paint }, { skin: true });            // 机身（带涂装贴图）
  def('fusePaintTop', { color: 0xffffff, ...paint, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }, { skin: true });   // 舱门等贴面件（与机身共用涂装贴图）
  def('white', { color: 0xf1f3f5, ...paint }, { skin: true });
  def('wingGrey', { color: 0xb4bbc3, ...paint, roughness: 0.42 }, { skin: true });
  def('wingGreyLE', { color: 0xa4acb5, ...paint, roughness: 0.3, metalness: 0.35 }, { skin: true });
  def('fairGrey', { color: 0xb9c0c8, ...paint, roughness: 0.45 }, { skin: true });
  def('tailPaint', { color: 0xffffff, ...paint }, { skin: true });
  def('navy', { color: 0x12305c, ...paint }, { skin: true });
  def('nacelle', { color: 0xeef0f2, ...paint }, { skin: true });
  def('polished', { color: 0xdfe3e8, roughness: 0.16, metalness: 1.0, envMapIntensity: 1.25 }, { skin: true });
  def('titaniumLE', { color: 0xb6b3ad, roughness: 0.32, metalness: 0.95 }, { skin: true });
  def('radome', { color: 0xf1f3f5, ...paint }, { skin: true });
  def('doorSeal', { color: 0x3b424b, roughness: 0.7, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, { skin: true });
  def('jointLine', { color: 0x9aa2ab, roughness: 0.6, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, { skin: true });
  def('glass', { color: 0x0a1118, roughness: 0.04, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, { skin: true });
  def('cabinWindow', { color: 0x0d1620, roughness: 0.06, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }, { skin: true });
  def('windowRim', { color: 0xd9dde2, roughness: 0.45, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, { skin: true });
  def('darkWell', { color: 0x1a1d21, roughness: 0.85, metalness: 0.2, side: THREE.DoubleSide });
  def('markDark', { color: 0x2a2f36, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }, { skin: true });

  // ---- 金属 / 机械 ----
  def('steel', { color: 0x9aa0a8, roughness: 0.38, metalness: 0.95 });
  def('steelDark', { color: 0x5a6068, roughness: 0.5, metalness: 0.9 });
  def('chrome', { color: 0xf2f4f6, roughness: 0.08, metalness: 1.0, envMapIntensity: 1.4 });
  def('titanium', { color: 0x8f8a84, roughness: 0.42, metalness: 0.92 });
  def('titaniumHot', { color: 0x7a6f66, roughness: 0.5, metalness: 0.9 });
  def('alu', { color: 0xc9ced4, roughness: 0.4, metalness: 0.9 });
  def('gearWhite', { color: 0xe8eaec, roughness: 0.42, metalness: 0.15, clearcoat: 0.5 });
  def('rubber', { color: 0x15171a, roughness: 0.92, metalness: 0.0 });
  def('black', { color: 0x0c0d0f, roughness: 0.6, metalness: 0.3 });
  def('fanBlade', { color: 0x23272d, roughness: 0.36, metalness: 0.55, clearcoat: 0.6, side: THREE.DoubleSide });
  def('fanLE', { color: 0xc8ccd2, roughness: 0.25, metalness: 1.0, side: THREE.DoubleSide });
  def('liner', { color: 0x8c949c, roughness: 0.75, metalness: 0.3, side: THREE.DoubleSide });
  def('ductDark', { color: 0x3a3f46, roughness: 0.6, metalness: 0.6, side: THREE.DoubleSide });
  def('cascade', { color: 0x30353b, roughness: 0.65, metalness: 0.5, side: THREE.DoubleSide });

  // ---- 内部结构（示意配色）----
  const S = (c, r = 0.55, mt = 0.25) => ({ color: c, roughness: r, metalness: mt });
  def('cfrp', S(0x30363d, 0.5, 0.3));
  def('frame', { ...S(0x3f4c5e, 0.5, 0.3), side: THREE.DoubleSide });
  def('stringer', { ...S(0x5b6878, 0.55, 0.25), side: THREE.DoubleSide });
  def('floorBeam', S(0x7d8996, 0.5, 0.4));
  def('floorPanel', { ...S(0x9aa3ad, 0.7, 0.05), side: THREE.DoubleSide });
  def('bulkhead', { ...S(0x566270, 0.5, 0.35), side: THREE.DoubleSide });
  def('spar', S(0xd08a3c, 0.5, 0.25));
  def('rib', { ...S(0x4f8f96, 0.55, 0.25), side: THREE.DoubleSide });
  def('wingStringer', { ...S(0x6f7b88, 0.55, 0.25), side: THREE.DoubleSide });
  def('wingBoxC', { ...S(0x8a6a3e, 0.55, 0.25), side: THREE.DoubleSide });
  def('keel', S(0xb5653c, 0.5, 0.4));
  def('lining', { color: 0xe9e6df, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  def('insulation', { color: 0xcdbb8a, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });

  // ---- 客舱 ----
  def('seatBiz', S(0x3e4a63, 0.8, 0.0));
  def('seatPrem', S(0x6a4d73, 0.8, 0.0));
  def('seatEco', S(0x3f6f8f, 0.8, 0.0));
  def('seatShell', S(0xd9dcdf, 0.5, 0.0));
  def('galley', S(0xb9bec5, 0.5, 0.3));
  def('lav', S(0xd8d2c4, 0.6, 0.0));
  def('bin', { ...S(0xf1efe9, 0.6, 0.0), side: THREE.DoubleSide });
  def('carpet', S(0x4a5566, 0.95, 0.0));
  def('uld', { color: 0xbfc6cd, roughness: 0.45, metalness: 0.75 });
  def('uldEdge', S(0x7b848e, 0.5, 0.6));
  def('cockpitPanel', S(0x2b3038, 0.6, 0.2));
  def('screen', { color: 0x0b1a26, roughness: 0.2, metalness: 0, emissive: 0x1d6a8f, emissiveIntensity: 0.9 });

  // ---- 系统 ----
  def('fuel', { color: 0xffb02e, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, emissive: 0x7a4a00, emissiveIntensity: 0.25 });
  def('fuelCenter', { color: 0xff7a2e, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, emissive: 0x7a2a00, emissiveIntensity: 0.25 });
  def('fuelSurge', { color: 0xffe38a, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  def('sysElec', S(0x3fa66b, 0.45, 0.4));
  def('sysElecWire', { color: 0x4ee08a, roughness: 0.4, metalness: 0.2, emissive: 0x1c8a4a, emissiveIntensity: 0.7 });
  def('sysAir', S(0x58b7d6, 0.45, 0.4));
  def('sysHyd', { color: 0xb86ad6, roughness: 0.4, metalness: 0.3, emissive: 0x5a2a7a, emissiveIntensity: 0.4 });
  def('sysAvionics', S(0xe2c14a, 0.45, 0.4));
  def('apu', S(0xa9a39a, 0.4, 0.85));
  def('battery', S(0x3a7bd5, 0.45, 0.3));
  def('radarDish', { ...S(0xd9d2b8, 0.5, 0.3), side: THREE.DoubleSide });
  def('recorder', S(0xff6a1a, 0.45, 0.1));
  def('water', S(0x4d8fd6, 0.4, 0.3));
  def('waste', S(0x7a6a58, 0.5, 0.3));
  def('firewall', { ...S(0x8d7b6a, 0.5, 0.8), side: THREE.DoubleSide });

  // ---- 灯光 ----
  def('lightRed', { color: 0x551010, emissive: 0xff2020, emissiveIntensity: 2.2, roughness: 0.3 });
  def('lightGreen', { color: 0x0f4a1c, emissive: 0x18ff50, emissiveIntensity: 2.0, roughness: 0.3 });
  def('lightWhite', { color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 2.0, roughness: 0.3 });
  def('lightBeacon', { color: 0x551010, emissive: 0xff1010, emissiveIntensity: 0.0, roughness: 0.3 });
  def('lightStrobe', { color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 0.3 });
  def('lightLanding', { color: 0xeeeeee, emissive: 0xfff4d6, emissiveIntensity: 0.0, roughness: 0.2 });
  def('lens', { color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false });
  return M;
}

/** "材料分布"模式使用的纯色材质 */
export const MATERIAL_CLASSES = {
  cfrp: { name: '碳纤维层压板', en: 'Carbon laminate', color: 0x2f7fd6 },
  sandwich: { name: '碳纤维夹层结构', en: 'Carbon sandwich', color: 0x4fc3e8 },
  glass: { name: '玻璃纤维', en: 'Fiberglass', color: 0x7fd67a },
  alu: { name: '铝合金', en: 'Aluminum', color: 0xf0c23c },
  ti: { name: '钛合金', en: 'Titanium', color: 0xe8774a },
  steel: { name: '钢', en: 'Steel', color: 0xc74b6b },
  other: { name: '其他（玻璃/橡胶等）', en: 'Other', color: 0x8f98a3 },
};
const mcCache = {};
export function materialClassMat(mc) {
  if (!mcCache[mc]) {
    const c = MATERIAL_CLASSES[mc] || MATERIAL_CLASSES.other;
    mcCache[mc] = new THREE.MeshPhysicalMaterial({ color: c.color, roughness: 0.5, metalness: 0.05, clearcoat: 0.4, side: THREE.DoubleSide });
  }
  return mcCache[mc];
}
