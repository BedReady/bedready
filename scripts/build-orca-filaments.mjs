#!/usr/bin/env node
/**
 * build-orca-filaments.mjs — bake the /orca-filaments dataset.
 *
 * Reads OrcaSlicer's bundled filament library, dedupes it to the DISTINCT filaments
 * (collapsing the per-printer and per-nozzle variants of the same filament), flattens
 * each one's `inherits` chain into a self-contained preset, retargets it to the
 * Snapmaker U1, and writes:
 *
 *   public/orca-filaments/manifest.json          — index the web UI reads
 *   public/orca-filaments/profiles/<id>.json     — install-ready presets (written verbatim)
 *
 * This is a DEV/build-time generator, not part of `next build` — run it by hand when you
 * want to refresh the library from a newer OrcaSlicer, then commit the output. This repo owns the
 * maintained copy (ported from makerrun's scripts/ on 2026-11-19; makerrun no longer has the pages).
 *
 * SOURCE: a git checkout of OrcaSlicer at a release tag, NOT the installed app. From OrcaSlicer
 * 2.5.1 the app packs each vendor into a binary <Vendor>.opc and keeps almost no .json, so the old
 * default source would have produced an empty catalogue without a word. The repo still has JSON:
 *
 *   git clone --depth 1 --branch v2.5.1 --filter=blob:none --sparse \
 *     https://github.com/OrcaSlicer/OrcaSlicer.git /tmp/orca && \
 *     git -C /tmp/orca sparse-checkout set resources/profiles
 *   ORCA_PROFILES_DIR=/tmp/orca/resources/profiles node scripts/build-orca-filaments.mjs
 *
 * Guards (each exits 1 BEFORE the committed output is touched): the source holds any *.opc, the
 * source has fewer than MIN_SOURCE filament files, any filament .json fails to parse, or the result
 * has fewer than MIN_PROFILES presets. Output is built in a temp dir and swapped in at the end.
 * A leading UTF-8 BOM is stripped (some vendor JSON has one; JSON.parse rejects it).
 *
 * Snapmaker Orca is a fork with the same preset format, but OrcaSlicer ships the far larger vendor
 * library, so we source from it and retarget compatible_printers to the Snapmaker U1 machine names.
 *
 * Why flatten + retarget (the whole point): upstream presets `inherit` a per-vendor base
 * (fdm_filament_pla → fdm_filament_common) and are tagged compatible only with their source
 * printer. Copied as-is into Snapmaker Orca they either don't resolve (missing parent) or
 * never appear (wrong printer). Flattening makes them self-contained; retargeting makes them
 * show for the U1. Inherit resolution is scoped to the same top-level vendor dir, matching how
 * OrcaSlicer loads a vendor bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SRC = process.env.ORCA_PROFILES_DIR;
const MIN_SOURCE = 1000; // filament .json files in the source (v2.5.1 has ~9,000)
const MIN_PROFILES = 1000; // distinct presets written (1,271 in the Aug 2026 bake)
// Snapmaker Orca's own profiles — used to learn exactly which filament keys its (forked, slightly
// older) build understands, so we can drop keys from newer upstream OrcaSlicer that it doesn't.
const SNAP_SRC = process.env.SNAPMAKER_PROFILES_DIR
  || '/Applications/Snapmaker Orca.app/Contents/Resources/profiles';
const OUT = path.join(REPO, 'public', 'orca-filaments');
const OUT_TMP = path.join(REPO, 'public', `.orca-filaments-tmp-${process.pid}`);
const OUT_PROFILES = path.join(OUT_TMP, 'profiles');

// All U1 nozzle variants — bind to every one so the preset shows regardless of the nozzle the
// user has selected. Exact names come from Snapmaker Orca's machine presets.
const U1_PRINTERS = [
  'Snapmaker U1 (0.4 nozzle)',
  'Snapmaker U1 (0.2 nozzle)',
  'Snapmaker U1 (0.6 nozzle)',
  'Snapmaker U1 (0.8 nozzle)',
];
const MACHINE = 'Snapmaker U1 (0.4 nozzle)'; // display value in the manifest

// A few top-level dir codes → friendly vendor facet. Everything else uses the dir/subdir name.
const VENDOR_ALIAS = { BBL: 'Bambu Lab', Bambu: 'Bambu Lab', OrcaFilamentLibrary: 'Orca', Custom: 'Custom' };

// Keys that must not survive into a standalone user preset.
const STRIP_KEYS = new Set([
  'inherits', 'instantiation', 'from', 'setting_id',
  'compatible_printers_condition', 'compatible_prints', 'compatible_prints_condition',
]);

const isJson = (f) => f.endsWith('.json');
const parseFailures = [];
const readJson = (f, { required = false } = {}) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { if (required) parseFailures.push(`${f}: ${e.message}`); return null; }
};
const die = (msg) => { fs.rmSync(OUT_TMP, { recursive: true, force: true }); console.error(msg); process.exit(1); };
const firstStr = (v) => (Array.isArray(v) ? v[0] : v);
const toInt = (v) => { const n = parseInt(String(firstStr(v) ?? ''), 10); return Number.isFinite(n) ? n : null; };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'filament';

// canonical filament identity: drop the " @printer" binding and the " 0.X nozzle" variant tag.
const canonicalName = (name) => String(name).replace(/\s*@.*$/, '').replace(/\s+0\.\d+\s*nozzle\s*$/i, '').trim();

// Collapse the raw (and often messy) filament_type into a clean base-material family for the
// UI's type filter. The precise filament_type is preserved untouched inside the install file;
// this is only the facet. Order matters — check more specific prefixes first (PETG before PET,
// PA12/PA6 before PA). Anything unrecognised falls into "Other" rather than bloating the filter.
const FAMILIES = ['PETG', 'PCTG', 'PET', 'PLA', 'ABS', 'ASA', 'TPU', 'TPE', 'PVA', 'PVB', 'HIPS',
  'PPS', 'PPA', 'PEEK', 'PEKK', 'PEI', 'PA12', 'PA6', 'PAHT', 'PA', 'PC', 'PP', 'PE', 'PHA',
  'SBS', 'EVA', 'BVOH', 'PEBA', 'SILK'];
function familyOf(ft) {
  const s = String(ft || '').toUpperCase().trim();
  for (const f of FAMILIES) if (s.startsWith(f)) return f === 'PA12' || f === 'PA6' || f === 'PAHT' ? 'PA' : f;
  return 'Other';
}

// Typical bed temp per family — only used as a display fallback when a profile carries no bed/plate
// temp key at all (a few generic presets don't). The install file is untouched; this is just the card.
const BED_DEFAULT = {
  PLA: 55, PETG: 70, ABS: 90, ASA: 90, TPU: 40, PC: 100, PA: 80, PET: 70, PCTG: 75,
  PVA: 55, PVB: 60, HIPS: 90, PP: 80, PPS: 100, PPA: 90, PEEK: 120, PHA: 45,
};

// Keys we set/keep regardless of what Snapmaker's presets happen to use.
const META_KEEP = new Set([
  'type', 'name', 'from', 'instantiation', 'compatible_printers', 'filament_type', 'filament_vendor',
  'filament_settings_id', 'filament_id', 'setting_id', 'version', 'is_custom_defined',
]);

/**
 * The set of filament keys Snapmaker Orca actually understands, learned from the union of keys across
 * all of its own bundled filament presets. Keys outside this set come from a newer upstream OrcaSlicer
 * (filament tower, epoxy plate, brass/HS nozzle temp variants, …) — irrelevant on a U1 and a source of
 * "unknown option" noise on load, so we strip them. Returns null if Snapmaker Orca isn't installed
 * (then we ship the full flattened preset unchanged).
 */
function snapmakerVocabulary() {
  if (!fs.existsSync(SNAP_SRC)) return null;
  const vocab = new Set();
  for (const f of walkFilaments(SNAP_SRC, [])) {
    const j = readJson(f);
    if (j && j.type === 'filament') for (const k of Object.keys(j)) vocab.add(k);
  }
  return vocab.size ? vocab : null;
}

/**
 * The config `version` stamped on every baked preset. Orca silently DROPS a user preset whose
 * `version` is missing or in a format it rejects (upstream OrcaSlicer's "2.0.0.x" was one), so this
 * is PINNED to the value every shipped preset has carried since July 2026 and that users have
 * imported into Snapmaker Orca without trouble. It used to be learned as the mode of Snapmaker
 * Orca's own presets, but Snapmaker Orca 2.4.1's bundled filament presets mostly say "0.0.0.0", so
 * learning it would now stamp that on all 1,300 files. Override with ORCA_PRESET_VERSION only after
 * importing a sample into the current Snapmaker Orca and seeing it in the filament dropdown.
 */
function presetVersion() {
  const v = process.env.ORCA_PRESET_VERSION || '02.03.01.10';
  if (!/^\d{2}\.\d{2}\.\d{2}\.\d{2}$/.test(v) || /^00\.00\.00\.00$/.test(v)) die(`Refusing preset version "${v}": expected NN.NN.NN.NN, not all zeros.`);
  return v;
}

/** Recursively collect every filament .json under a directory. */
function walkFilaments(dir, acc) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFilaments(p, acc);
    else if (e.isFile() && isJson(p)) acc.push(p);
  }
  return acc;
}

/**
 * For a top-level vendor dir, index every filament preset by its `name` so `inherits` can be
 * resolved by name within the bundle (this is how OrcaSlicer resolves it).
 */
function indexVendor(vendorDir) {
  const filamentRoot = path.join(vendorDir, 'filament');
  const files = walkFilaments(filamentRoot, []);
  const byName = new Map();
  const records = [];
  for (const file of files) {
    const j = readJson(file, { required: true });
    if (!j || j.type !== 'filament' || !j.name) continue;
    // vendor facet. Most vendors put filaments directly under filament/ (vendor = the top-level
    // dir). A few "aggregator" vendors (Bambu's BBL, the Orca library) instead nest real
    // third-party BRANDS in subdirs — use the subdir there. Everywhere else the subdirs are
    // printer-series/nozzle groupings (EN2SERIES, ELEGOO_02_NOZZLE, …), NOT brands, so ignore them.
    const rel = path.relative(filamentRoot, file);
    const relDir = path.dirname(rel);
    const topDir = path.basename(vendorDir);
    const sub = relDir === '.' ? null : relDir.split(path.sep)[0];
    const AGGREGATORS = new Set(['BBL', 'OrcaFilamentLibrary']);
    const vendor = AGGREGATORS.has(topDir)
      ? (sub ? (VENDOR_ALIAS[sub] || sub) : (VENDOR_ALIAS[topDir] || topDir))
      : (VENDOR_ALIAS[topDir] || topDir);
    const rec = { file, json: j, vendor };
    byName.set(j.name, rec);
    records.push(rec);
  }
  return { byName, records };
}

/** Merge a preset's full inherit chain (root→leaf, leaf wins) into one flat object. */
function flatten(rec, byName, seen = new Set()) {
  const j = rec.json;
  if (j.inherits && !seen.has(j.name)) {
    seen.add(j.name);
    const parent = byName.get(String(j.inherits));
    if (parent) {
      const base = flatten(parent, byName, seen);
      return { ...base, ...j };
    }
  }
  return { ...j };
}

// Per-filament temperature fields are per-extruder arrays in Orca. A few source profiles store
// them as bare scalars ("250"); coerce to arrays so every install file is uniform.
const ARRAY_FIELDS = [
  'nozzle_temperature', 'nozzle_temperature_initial_layer',
  'hot_plate_temp', 'hot_plate_temp_initial_layer',
  'cool_plate_temp', 'cool_plate_temp_initial_layer',
  'textured_plate_temp', 'textured_plate_temp_initial_layer',
  'eng_plate_temp', 'eng_plate_temp_initial_layer', 'bed_temperature',
  'graphic_effect_plate_temp', 'graphic_effect_plate_temp_initial_layer',
];

const plateTemp = (v) => {
  const n = parseInt(Array.isArray(v) ? v[0] : v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The U1's default bed is the Graphic Effect plate, and upstream OrcaSlicer filaments carry no
 * temperature for it, so Snapmaker Orca showed a 0 °C bed for every downloaded profile
 * (BedReady/bedready#88). Fill it from the first heated plate in hot → textured → eng order:
 * hot first, the same order the manifest's bedTemp reads, so the page and the file agree. The
 * initial-layer value comes from that same plate. A filament with no heated plate at all (made for
 * unheated beds) is left without one rather than given an invented number.
 *
 * PLA only. Snapmaker's own U1 presets set this plate to the hot-plate value for PLA and to 0 for
 * ABS, ASA, PC, PETG, PVA and TPU, where 0 means "not supported on this plate": Orca then refuses
 * the combination instead of heating a decorated sheet to 100 °C. Leaving the key out for those
 * materials keeps that refusal.
 */
function graphicEffectPlate(out) {
  const type = Array.isArray(out.filament_type) ? out.filament_type[0] : out.filament_type;
  if (!/^PLA/i.test(String(type ?? ''))) return;
  if (plateTemp(out.graphic_effect_plate_temp)) return;
  for (const src of ['hot_plate_temp', 'textured_plate_temp', 'eng_plate_temp']) {
    const base = plateTemp(out[src]);
    if (!base) continue;
    const first = plateTemp(out[`${src}_initial_layer`]) ?? base;
    out.graphic_effect_plate_temp = [String(base)];
    out.graphic_effect_plate_temp_initial_layer = [String(first)];
    return;
  }
}

/**
 * Turn a flattened preset into a Snapmaker-U1 user preset. Returns null if incomplete.
 * When `vocab` is provided, drops keys Snapmaker Orca doesn't understand (see snapmakerVocabulary).
 * `stripStats` accumulates which keys were dropped, for the run summary.
 */
function normalize(flat, name, vocab, stripStats, version) {
  const out = {};
  for (const [k, v] of Object.entries(flat)) if (!STRIP_KEYS.has(k)) out[k] = v;
  for (const k of ARRAY_FIELDS) if (k in out && !Array.isArray(out[k])) out[k] = [String(out[k])];
  if (!out.filament_type || !out.nozzle_temperature || !out.nozzle_temperature.length) return null;
  if (vocab) {
    for (const k of Object.keys(out)) {
      if (!vocab.has(k) && !META_KEEP.has(k)) { delete out[k]; if (stripStats) stripStats.set(k, (stripStats.get(k) || 0) + 1); }
    }
  }
  out.type = 'filament';
  out.name = name;
  out.from = 'User';
  out.instantiation = 'true';
  out.compatible_printers = [...U1_PRINTERS];
  // Fields Snapmaker Orca expects on a user preset. Without `version` (in ITS format) the preset is
  // silently dropped on load — the #1 reason a correctly-placed profile never shows in the dropdown.
  out.compatible_printers_condition = '';
  out.setting_id = '';
  out.version = version;
  graphicEffectPlate(out); // last, so the two keys follow `version` in every file
  return out;
}

function main() {
  if (!SRC || !fs.existsSync(SRC)) {
    die(`Source profiles not found: ${SRC ?? '(unset)'}\nSet ORCA_PROFILES_DIR to resources/profiles in a git checkout of OrcaSlicer (see the header).`);
  }
  const opc = fs.readdirSync(SRC).filter((n) => n.endsWith('.opc'));
  if (opc.length) die(`${SRC} holds ${opc.length} packed .opc vendor bundle(s) (e.g. ${opc[0]}): that is an installed OrcaSlicer >= 2.5.1, not JSON. Use a git checkout (see the header).`);
  const sourceCount = fs.readdirSync(SRC, { withFileTypes: true }).filter((e) => e.isDirectory())
    .reduce((n, e) => n + walkFilaments(path.join(SRC, e.name, 'filament'), []).length, 0);
  if (sourceCount < MIN_SOURCE) die(`Only ${sourceCount} filament .json files under ${SRC} (expected >= ${MIN_SOURCE}). Refusing to rebuild the catalogue from it.`);

  // Build into a temp dir; the committed output is replaced only once every check has passed.
  fs.rmSync(OUT_TMP, { recursive: true, force: true });
  fs.mkdirSync(OUT_PROFILES, { recursive: true });

  const vocab = snapmakerVocabulary();
  console.log(vocab
    ? `Filtering to Snapmaker Orca's ${vocab.size}-key filament vocabulary (${SNAP_SRC}).`
    : `Snapmaker Orca not found at ${SNAP_SRC} — shipping full flattened presets (set SNAPMAKER_PROFILES_DIR to filter).`);
  const version = presetVersion();
  console.log(`Stamping preset version ${version}${process.env.ORCA_PRESET_VERSION ? ' (ORCA_PRESET_VERSION)' : ' (pinned)'}.`);
  const stripStats = new Map();

  const vendorDirs = fs.readdirSync(SRC, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(SRC, e.name));

  // group by vendor-facet + canonical name → pick one representative to flatten.
  const groups = new Map();
  for (const vd of vendorDirs) {
    const { byName, records } = indexVendor(vd);
    for (const rec of records) {
      if (String(rec.json.instantiation) === 'false') continue; // abstract @base — parent only
      const canon = canonicalName(rec.json.name);
      if (!canon) continue;
      const key = `${rec.vendor}||${canon}`;
      const noNozzle = !/\s+0\.\d+\s*nozzle/i.test(rec.json.name); // prefer the default (0.4) variant
      const prev = groups.get(key);
      if (!prev || (noNozzle && !prev.noNozzle)) {
        groups.set(key, { rec, byName, canon, vendor: rec.vendor, noNozzle });
      }
    }
  }

  if (parseFailures.length) die(`${parseFailures.length} filament file(s) failed to parse:\n  ` + parseFailures.slice(0, 20).join('\n  '));

  const profiles = [];
  const usedIds = new Set();
  for (const { rec, byName, canon, vendor } of groups.values()) {
    const flat = flatten(rec, byName);
    const preset = normalize(flat, canon, vocab, stripStats, version);
    if (!preset) continue;

    let id = slug(`${vendor}-${canon}`);
    if (usedIds.has(id)) { let n = 2; while (usedIds.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
    usedIds.add(id);

    const family = familyOf(firstStr(preset.filament_type));
    const bed = toInt(preset.hot_plate_temp) ?? toInt(preset.bed_temperature)
      ?? toInt(preset.cool_plate_temp) ?? toInt(preset.textured_plate_temp);
    fs.writeFileSync(path.join(OUT_PROFILES, `${id}.json`), JSON.stringify(preset, null, 2) + '\n');
    profiles.push({
      id,
      name: canon,
      vendor,
      type: family,
      nozzleTemp: toInt(preset.nozzle_temperature),
      bedTemp: bed ?? BED_DEFAULT[family] ?? 60,
      file: `profiles/${id}.json`,
    });
  }

  profiles.sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
  const vendors = [...new Set(profiles.map((p) => p.vendor))].sort((a, b) => a.localeCompare(b));
  const typeOrder = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PC', 'PA', 'PET', 'PCTG', 'PVA',
    'PVB', 'HIPS', 'PP', 'PPS', 'PPA', 'PEEK', 'PHA', 'Other'];
  const types = [...new Set(profiles.map((p) => p.type))]
    .sort((a, b) => { const ia = typeOrder.indexOf(a), ib = typeOrder.indexOf(b);
      return (ia < 0 ? 98 : ia) - (ib < 0 ? 98 : ib) || a.localeCompare(b); });

  if (profiles.length < MIN_PROFILES) die(`Only ${profiles.length} presets built (expected >= ${MIN_PROFILES}). Committed output left untouched.`);
  const manifest = { machine: MACHINE, vendors, types, profiles };
  fs.writeFileSync(path.join(OUT_TMP, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.renameSync(OUT_TMP, OUT);

  console.log(`Wrote ${profiles.length} profiles across ${vendors.length} vendors, ${types.length} types → public/orca-filaments/`);
  if (stripStats.size) {
    const top = [...stripStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(`Dropped ${stripStats.size} foreign key(s) not in Snapmaker Orca's vocabulary: `
      + top.map(([k, n]) => `${k}(${n})`).join(', ') + (stripStats.size > 12 ? ', …' : ''));
  }
}

main();
