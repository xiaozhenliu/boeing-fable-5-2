// 数值查询：机头段截面（驾驶舱仪表板/遮光罩是否在蒙皮内）
import { F, fuseSection, fuseHalfWidthAtY } from '../src/aircraft/shape.js';
const FY = F.floorY;
const hs = [0.05, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0, 1.2, 1.4];
console.log('FY', FY, 'cols: hw at FY+', hs.join(' '));
for (const x of [2.6, 2.8, 3.0, 3.2, 3.4, 3.6, 3.8, 4.0, 4.2, 4.4, 4.6, 5.0]) {
  const s = fuseSection(x);
  console.log('x', x.toFixed(1), 'yT-FY', (s.yT - FY).toFixed(2), 'w', s.w.toFixed(2), hs.map(h => fuseHalfWidthAtY(x, FY + h).toFixed(2)).join(' '));
}
