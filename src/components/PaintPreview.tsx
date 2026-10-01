"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { MeshData } from "@/lib/paint";

// Soft studio-gradient backdrop so the contact shadow + lighting read (a flat near-black hid them).
function gradientTexture(top: string, bottom: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Renders a painted mesh in its real (or remapped) colors. `colorKey` triggers recolor.
 *
 * With `compareColorForState`, the canvas splits in two: the LEFT half paints with that function (the
 * model's original colours), the RIGHT with `colorForState` (what will print). It is one scene, one
 * camera and one set of controls drawn twice per frame through two scissored viewports, so dragging
 * either half turns both identically. Two components side by side would each own a camera, and a
 * comparison that drifts out of alignment the moment you touch it is not a comparison.
 */
export default function PaintPreview({
  mesh,
  colorForState,
  colorKey,
  compareColorForState,
  labels,
}: {
  mesh: MeshData;
  colorForState: (state: number) => string;
  colorKey: string;
  compareColorForState?: (state: number) => string;
  /** [left, right] captions for compare mode. */
  labels?: [string, string];
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const geomRef = useRef<THREE.BufferGeometry | null>(null);
  // The original-colour buffer for compare mode, and whether it is on. Refs, because the render loop is
  // built once per mesh and must read the CURRENT choice rather than the one it was created with.
  const origAttrRef = useRef<THREE.BufferAttribute | null>(null);
  const compareRef = useRef(false);
  const compare = !!compareColorForState;
  compareRef.current = compare;

  // build scene once per mesh
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const width = mount.clientWidth || 600;
    const height = 380;

    const scene = new THREE.Scene();
    const bgTex = gradientTexture("#48566b", "#0b0f1a");
    scene.background = bgTex;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // NB: no ACES tone mapping here (unlike ModelViewer) — this is the colour-checking view, so painted
    // hexes must render true. Soft shadows only.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    // Procedural studio environment for soft, even lighting (metalness 0 → no mirror reflections, just a
    // flattering ambient that keeps hues true). Dim the fill light since the env now carries most of it.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0002;
    scene.add(key);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geom.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(mesh.positions.length), 3),
    );
    geom.computeVertexNormals();
    geomRef.current = geom;
    const mappedAttr = geom.getAttribute("color") as THREE.BufferAttribute;
    const origAttr = new THREE.BufferAttribute(new Float32Array(mesh.positions.length), 3);
    origAttrRef.current = origAttr;

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
    const obj = new THREE.Mesh(geom, mat);
    obj.castShadow = true;

    // center + frame (3MF is usually Z-up)
    obj.rotation.x = -Math.PI / 2;
    scene.add(obj);
    geom.computeBoundingBox();
    const box = geom.boundingBox!;
    const center = box.getCenter(new THREE.Vector3());
    obj.position.set(-center.x, center.z, center.y); // account for the x rotation
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 1.8;
    camera.position.set(dist, dist * 0.7, dist);
    camera.near = maxDim / 100;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();

    // Key light + shadow frustum scaled to the model, and a shadow-only floor just beneath it.
    key.position.set(maxDim, maxDim * 1.6, maxDim * 0.6);
    const sc = key.shadow.camera;
    sc.left = -maxDim; sc.right = maxDim; sc.top = maxDim; sc.bottom = -maxDim;
    sc.near = maxDim * 0.1; sc.far = maxDim * 8;
    sc.updateProjectionMatrix();
    const worldBox = new THREE.Box3().setFromObject(obj);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(maxDim * 6, maxDim * 6), new THREE.ShadowMaterial({ opacity: 0.28 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = worldBox.min.y - maxDim * 0.002;
    ground.receiveShadow = true;
    scene.add(ground);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.8;
    controls.addEventListener("start", () => { controls.autoRotate = false; });

    let raf = 0;
    let wasCompare: boolean | null = null;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      const w = mount.clientWidth || width;
      const split = compareRef.current;
      if (split !== wasCompare) {
        // Each half is its own picture, so the camera takes a half-width aspect in compare mode.
        camera.aspect = (split ? w / 2 : w) / height;
        camera.updateProjectionMatrix();
        wasCompare = split;
      }
      if (!split) {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, w, height);
        geom.setAttribute("color", mappedAttr);
        renderer.render(scene, camera);
        return;
      }
      const half = Math.floor(w / 2);
      renderer.setScissorTest(true);
      geom.setAttribute("color", origAttr);
      renderer.setViewport(0, 0, half, height);
      renderer.setScissor(0, 0, half, height);
      renderer.render(scene, camera);
      geom.setAttribute("color", mappedAttr);
      renderer.setViewport(half, 0, w - half, height);
      renderer.setScissor(half, 0, w - half, height);
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth;
      camera.aspect = (compareRef.current ? w / 2 : w) / height;
      camera.updateProjectionMatrix();
      renderer.setSize(w, height);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      geom.dispose();
      origAttrRef.current = null;
      mat.dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      envTex.dispose();
      bgTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      geomRef.current = null;
    };
  }, [mesh]);

  // recolor when the mapping changes
  useEffect(() => {
    const geom = geomRef.current;
    if (!geom) return;
    // The render loop swaps the "color" attribute between the two buffers in compare mode, so the
    // mapped buffer is found by elimination rather than by whatever happens to be attached right now.
    const orig = origAttrRef.current;
    const current = geom.getAttribute("color") as THREE.BufferAttribute;
    const mapped = current === orig ? null : current;
    const fill = (attr: THREE.BufferAttribute, fn: (state: number) => string) => {
      const colors = attr.array as Float32Array;
      const cache = new Map<number, [number, number, number]>();
      const tmp = new THREE.Color();
      for (let f = 0; f < mesh.faceState.length; f++) {
        const s = mesh.faceState[f];
        let rgb = cache.get(s);
        if (!rgb) {
          // Vertex colours must be LINEAR — the renderer's colour management converts linear→sRGB at
          // output. setStyle() parses the hex as sRGB and stores linear-light in r/g/b. Feeding raw
          // sRGB here (the old hexRgb) is what made colours look faded and clipped bright ones
          // (yellow→white, green→pale) — the sRGB curve was applied twice.
          tmp.setStyle(fn(s));
          rgb = [tmp.r, tmp.g, tmp.b];
          cache.set(s, rgb);
        }
        const o = f * 9;
        for (let v = 0; v < 3; v++) {
          colors[o + v * 3] = rgb[0];
          colors[o + v * 3 + 1] = rgb[1];
          colors[o + v * 3 + 2] = rgb[2];
        }
      }
      attr.needsUpdate = true;
    };
    if (mapped) fill(mapped, colorForState);
    if (orig && compareColorForState) fill(orig, compareColorForState);
  }, [mesh, colorForState, colorKey, compareColorForState]);

  return (
    <div className="relative">
      <div
        ref={mountRef}
        className="w-full overflow-hidden rounded-lg border border-white/10"
        style={{ height: 380 }}
      />
      {compare && labels && (
        <>
          {/* Captions sit over the canvas, one per half, and a hairline marks the seam. PHYSICAL left
              and right, not start/end: the WebGL halves do not mirror in RTL, so logical positioning
              would put the "original" caption over the mapped half on /ar. */}
          <span className="pointer-events-none absolute left-3 top-3 rounded bg-black/55 px-2 py-0.5 text-xs text-white">
            {labels[0]}
          </span>
          <span className="pointer-events-none absolute top-3 rounded bg-black/55 px-2 py-0.5 text-xs text-white" style={{ left: "calc(50% + 0.75rem)" }}>
            {labels[1]}
          </span>
          <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-white/20" aria-hidden />
        </>
      )}
    </div>
  );
}
