import { zipSync, strToU8 } from "fflate";
import { writeFileSync } from "node:fs";
// A painted two-colour cube in a Bambu-shaped project, so the converter has real work to do.
const v=[[0,0,0],[40,0,0],[40,40,0],[0,40,0],[0,0,30],[40,0,30],[40,40,30],[0,40,30]];
const f=[[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]];
const tris=f.map(([a,b,c],i)=>`<triangle v1="${a}" v2="${b}" v3="${c}"${i>5?' paint_color="4"':''}/>`).join("");
const model=`<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">`
 +`<resources><object id="1" type="model"><mesh><vertices>${v.map(([x,y,z])=>`<vertex x="${x}" y="${y}" z="${z}"/>`).join("")}</vertices>`
 +`<triangles>${tris}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
const cfg=JSON.stringify({printer_model:"Bambu Lab P1S",filament_colour:["#FF0000","#00AA55"],layer_height:"0.2",
  filament_type:["PLA","PLA"],printer_settings_id:"Bambu Lab P1S 0.4 nozzle"});
writeFileSync("sample.3mf", Buffer.from(zipSync({
  "[Content_Types].xml":strToU8('<?xml version="1.0"?><Types/>'),
  "_rels/.rels":strToU8('<?xml version="1.0"?><Relationships/>'),
  "3D/3dmodel.model":strToU8(model),
  "Metadata/project_settings.config":strToU8(cfg),
})));
console.log("wrote sample.3mf");
