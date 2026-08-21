// three.js-dependent mesh helpers, split out of ./convert so the conversion core stays three-free
// (and bundles small for the browser extension). Used by the upload + convert pages in the web app.
import * as THREE from "three";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

/** Measure a model's bounding-box size in mm (STL/3MF). null if unmeasurable. */
export async function modelSizeMM(file: File): Promise<[number, number, number] | null> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  try {
    const buf = await file.arrayBuffer();
    if (ext === "stl") {
      const geo = new STLLoader().parse(buf);
      geo.computeBoundingBox();
      const s = new THREE.Vector3();
      geo.boundingBox!.getSize(s);
      return [s.x, s.y, s.z];
    }
    if (ext === "3mf") {
      const grp = new ThreeMFLoader().parse(buf);
      const s = new THREE.Vector3();
      new THREE.Box3().setFromObject(grp).getSize(s);
      return [s.x, s.y, s.z];
    }
  } catch {
    return null;
  }
  return null; // obj/step: not measured
}

/** Convert a .3mf to plain STL geometry (drops everything but the mesh). */
export async function threeMFToSTL(file: File): Promise<Blob> {
  const buffer = await file.arrayBuffer();
  const group = new ThreeMFLoader().parse(buffer);
  group.updateMatrixWorld(true);
  const stl = new STLExporter().parse(group, { binary: true }) as unknown as DataView;
  return new Blob([stl.buffer as ArrayBuffer], { type: "model/stl" });
}
