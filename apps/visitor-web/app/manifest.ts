import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Đầm Sen Smart Guide',
    short_name: 'Đầm Sen Guide',
    description: 'Khám phá POI, nghe thuyết minh và dẫn đường trong công viên.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f1e7',
    theme_color: '#075f46',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
