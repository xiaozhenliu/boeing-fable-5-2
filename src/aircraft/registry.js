// 部件注册表：把网格与"可讲解部件"关联起来，供拾取、高亮、图层、材料模式使用
import * as THREE from 'three';

export class Registry {
  constructor() {
    this.parts = new Map();   // id -> { id, objects: [] }
    this.all = [];            // 所有可拾取的网格
    this.flexItems = [];      // 随机翼弯曲的对象
    this.explode = [];        // 爆炸图分组 { obj, dir:Vector3, base:Vector3 }
  }
  /** 注册对象为某部件；o: { layer, mc(材料类别), side } */
  reg(id, obj, o = {}) {
    obj.userData.part = id;
    if (o.side) obj.userData.side = o.side;
    obj.traverse((c) => {
      if (o.layer && !c.userData.layer) c.userData.layer = o.layer;
      if (o.mc && !c.userData.mc) c.userData.mc = o.mc;
    });
    if (!this.parts.has(id)) this.parts.set(id, { id, objects: [] });
    this.parts.get(id).objects.push(obj);
    return obj;
  }
  objectsOf(id) { return this.parts.get(id)?.objects || []; }
  /** 从命中的对象向上查找部件 id */
  static partOf(obj) {
    let o = obj;
    while (o) { if (o.userData && o.userData.part) return { id: o.userData.part, root: o }; o = o.parent; }
    return null;
  }
}

/** 创建网格（默认投射/接收阴影） */
export function mk(geo, mat, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = o.shadow !== false;
  m.receiveShadow = o.receive !== false;
  if (o.layer) m.userData.layer = o.layer;
  if (o.mc) m.userData.mc = o.mc;
  if (o.name) m.name = o.name;
  if (o.noPick) m.userData.noPick = true;
  return m;
}
export function grp(name, ...children) {
  const g = new THREE.Group(); g.name = name;
  for (const c of children) if (c) g.add(c);
  return g;
}
