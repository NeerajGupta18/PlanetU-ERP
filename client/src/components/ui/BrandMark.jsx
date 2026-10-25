import { BRAND } from '../../config/brand.js';

/** The logo in the sidebar and on the login page: the institute's own when it has uploaded one, else PlanetU's. */
export default function BrandMark({ size = 28, src }) {
  return <img src={src || BRAND.logo} alt="" width={size} height={size} draggable="false" style={src ? { objectFit: 'contain' } : undefined} />;
}
