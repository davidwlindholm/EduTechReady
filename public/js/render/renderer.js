// WebGL renderer plus the CSS2D label layer, sized together.
import { THREE, CSS2DRenderer } from './three.js';

export const MAX_PIXEL_RATIO = 2;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} labelHost element the label layer is appended to
 */
export function createRenderers(canvas, labelHost) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const labels = new CSS2DRenderer();
  labels.domElement.classList.add('label-layer');
  labelHost.appendChild(labels.domElement);

  return {
    renderer,
    labels,
    /** Resize both layers to CSS pixels; re-reads devicePixelRatio (zoom, monitor change). */
    setSize(width, height) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
      renderer.setSize(width, height, false);
      labels.setSize(width, height);
    },
    render(scene, camera) {
      renderer.render(scene, camera);
      labels.render(scene, camera);
    },
    dispose() {
      renderer.dispose();
      labels.domElement.remove();
    },
  };
}
