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

/** Renders a painted mesh in its real (or remapped) colors. `colorKey` triggers recolor. */
export default function PaintPreview({
  mesh,
  colorForState,
  colorKey,
}: {
  mesh: MeshData;
  colorForState: (state: number) => string;
  colorKey: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const geomRef = useRef<THREE.BufferGeometry | null>(null);

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
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth;
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
      renderer.setSize(w, height);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      geom.dispose();
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
    const colorAttr = geom.getAttribute("color") as THREE.BufferAttribute;
    const colors = colorAttr.array as Float32Array;
    const cache = new Map<number, [number, number, number]>();
    const tmp = new THREE.Color();
    for (let f = 0; f < mesh.faceState.length; f++) {
      const s = mesh.faceState[f];
      let rgb = cache.get(s);
      if (!rgb) {
        // Vertex colours must be LINEAR — the renderer's colour management converts linear→sRGB at
        // output. setStyle() parses the hex as sRGB and stores linear-light in r/g/b. Feeding raw sRGB
        // here (the old hexRgb) is what made colours look faded and clipped bright ones (yellow→white,
        // green→pale) — the sRGB curve was applied twice.
        tmp.setStyle(colorForState(s));
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
    colorAttr.needsUpdate = true;
  }, [mesh, colorForState, colorKey]);

  return (
    <div
      ref={mountRef}
      className="w-full overflow-hidden rounded-lg border border-white/10"
      style={{ height: 380 }}
    />
  );
}
