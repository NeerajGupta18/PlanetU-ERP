import { BRAND } from '../../config/brand.js';

export default function BrandMark({ size = 28 }) {
  return <img src={BRAND.logo} alt="" width={size} height={size} draggable="false" />;
}
