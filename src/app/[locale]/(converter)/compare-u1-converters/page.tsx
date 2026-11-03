import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import Link from "@/components/SiteLink";
import { canonicalOnly } from "@/lib/seo";
import { SOURCE_REPO_URL } from "@/lib/links";

// Honest comparison against the other Snapmaker U1 .3mf converters. Targets the searches a U1 owner
// actually makes ("bl2u1 alternative", "U1 Forge vs", "best U1 3mf converter").
//
// ENGLISH ONLY, deliberately — same as the source→U1 landing pages (all of which mark <main> lang="en"
// dir="ltr", or under /ar the page direction flips their punctuation). Two reasons: the queries this
// targets are English, and a comparison page makes factual claims about other people's products that
// change without notice. Six stale translations of a competitor's pricing is worse than none.
//
// RULES FOR EDITING THIS PAGE:
//   1. Every claim about another tool must come from THEIR public page, and be linked.
//   2. Date-stamp it. Competitors ship; a comparison is only true on a given day.
//   3. Keep the "when to use them instead" section honest. A comparison nobody believes is worthless,
//      and the fastest way to lose that is to pretend the alternatives have no advantages.
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Snapmaker U1 .3mf converters compared — u1convert, any2orca, U1 Forge, bl2u1, PaintPort",
    description:
      "An honest comparison of the tools that convert Bambu, Prusa, Orca and MakerWorld .3mf files for the Snapmaker U1, including the one Snapmaker's wiki links to: what each supports, what it costs, whether there's a limit, and whether your file is uploaded.",
    alternates: canonicalOnly("/compare-u1-converters"),
  };
}

// Every column re-read on this date from the tool's own site, README, release notes or store page.
const UPDATED = "2 November 2026";

const U1CONVERT = "https://u1convert.com/";
const U1CONVERT_REPO = "https://github.com/thadius83/bambu-to-snapmaker-u1";
const WIKI_GUIDE = "https://wiki.snapmaker.com/en/resource_hub/u1_3mf_converter_user_guide";
const FORGE = "https://inkwell.wiki/snapmaker-u1-3mf-forge";
const ANY2ORCA = "https://any2orca.com/";
const ANY2ORCA_REPO = "https://github.com/KuzuriAo/any2orca";
const B2O = "https://b2o.kuzuriao.com/";
const MW_EXT = "https://github.com/Dragon2203/makerworld-to-snapmaker-u1";
const PAINTPORT = "https://perspektive3d.github.io/paintport/";

type Row = { label: string; bedready: string; u1c: string; bl2u1: string; forge: string; a2o: string; mw: string; pp: string; note?: string };

const NS = "Not stated";

const ROWS: Row[] = [
  {
    label: "Source files",
    bedready: "Bambu, Prusa, Creality, Orca",
    u1c: "MakerWorld, Bambu Studio, OrcaSlicer; PrusaSlicer in part; Cura (layer height only)",
    bl2u1: "Bambu Lab only",
    forge: "Bambu, MakerWorld, Orca (its announcement adds Prusa)",
    a2o: "Bambu Studio, Creality Print, Anycubic, ELEGOO, Flashforge",
    mw: "MakerWorld and Bambu Studio",
    pp: "Painted Bambu, MakerWorld and Orca files",
  },
  {
    label: "Where conversion runs",
    bedready: "Your browser",
    u1c: "Their server: the file is uploaded (or self-host it)",
    bl2u1: "Their server (or self-host it)",
    forge: "Your browser",
    a2o: "Your browser, or its command-line tool",
    mw: "Your browser",
    pp: "Your browser, or offline as one HTML file",
    note: "bl2u1's page says uploads are deleted after 8 hours. any2orca replaced bambu2orca, which sent a project's settings to its server; that older version is still online at b2o.kuzuriao.com.",
  },
  {
    label: "Price",
    bedready: "Free",
    u1c: "Free",
    bl2u1: "Free (donation link)",
    forge: "First export free, then paid in \"ink\"",
    a2o: "Free; tips optional",
    mw: "Free",
    pp: "Free",
    note: "U1 Forge's announcement priced an export at 40 ink, about $2; ink is sold in packs from $5. Its page doesn't show the current price.",
  },
  {
    label: "Usage limit",
    bedready: "None",
    u1c: NS,
    bl2u1: NS,
    forge: "Paid per export after the first",
    a2o: "None (\"no quota\")",
    mw: "None stated; runs locally",
    pp: "None stated; runs locally",
    note: "The older b2o version allows 10 conversions a day.",
  },
  {
    label: "More than 4 colors",
    bedready: "Full Spectrum mixing, M600 swap pauses, or band-swap",
    u1c: "Reassign the extras to the 4 heads, or keep them all; swap pauses for unpainted files",
    bl2u1: "Pick 4, the rest are dropped",
    forge: NS,
    a2o: "Every slot kept; you map them in Orca",
    mw: NS,
    pp: "Matched to the spools you have loaded; the rest as ColorMix blends",
    note: "The U1 has 4 physical heads, so every tool has to do something here. The question is what.",
  },
  {
    label: "U1 nozzles",
    bedready: "0.4 tested; 0.2, 0.6 and 0.8 derived from it, and labeled as derived; High Flow on 0.4, from Snapmaker's own presets",
    u1c: "0.4 only",
    bl2u1: "0.20 mm Standard profile; nozzle not stated",
    forge: "0.4",
    a2o: "0.2, 0.4, 0.6, 0.8; High Flow on 0.4",
    mw: "0.2, 0.4, 0.6, 0.8; can import your own Orca printer profile",
    pp: "Not applicable: it remaps paint, not printer profiles",
    note: "Only my 0.4 profile is a real export from a U1 that has printed; the other three scale it by nozzle ratio, and the converter says so when you pick one.",
  },
  {
    label: "Retarget to other printers",
    bedready: "U1 → Bambu / Prusa / Creality; Bambu or Orca → a Prusa CORE One INDX project",
    u1c: "No",
    bl2u1: NS,
    forge: NS,
    a2o: NS,
    mw: NS,
    pp: "Painted 3MF → Prusa CORE One INDX, Bambu Studio or Snapmaker Orca",
  },
  { label: "STL ⇄ 3MF", bedready: "Yes", u1c: "No: 3MF only", bl2u1: NS, forge: NS, a2o: NS, mw: NS, pp: "No: painted 3MF only" },
  { label: "Batch convert", bedready: "Yes, a folder at a time", u1c: NS, bl2u1: NS, forge: NS, a2o: "Yes, in the command-line tool, including watched folders", mw: NS, pp: NS },
  { label: "See the result first", bedready: "Colored 3D preview before you download", u1c: "A report of what changed", bl2u1: NS, forge: NS, a2o: NS, mw: "A project and error report", pp: "Original against mapped" },
  { label: "Browser extension", bedready: "Chrome + Firefox", u1c: NS, bl2u1: NS, forge: NS, a2o: "Only as an example in its repository", mw: "It is one: Chrome, Edge, Firefox, with a button on MakerWorld", pp: NS },
  { label: "Other ways to run it", bedready: "Desktop app for macOS, Windows, Linux", u1c: "Self-host with Docker", bl2u1: "Self-host", forge: NS, a2o: "npx any2orca on Windows, macOS, Linux", mw: NS, pp: "One HTML file, works offline" },
  { label: "Languages", bedready: "7", u1c: "English", bl2u1: "English", forge: NS, a2o: NS, mw: NS, pp: "English, German" },
  { label: "License", bedready: "MIT", u1c: "PolyForm Noncommercial", bl2u1: "GPL-3.0 on GitHub, MIT in its README", forge: NS, a2o: "MIT core, AGPL-3.0 web and profiles", mw: "MIT, plus a PolyForm Noncommercial file", pp: "AGPL-3.0" },
];

const ext = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;
const a = "text-violet-300 hover:underline";

export default async function CompareConvertersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const cell = "px-3 py-2.5 align-top text-sm";

  return (
    <main lang="en" dir="ltr" className="page-read py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        Snapmaker U1 .3mf converters, <span className="brand-text">compared</span>
      </h1>
      <div className="brand-rule mt-4 w-28" aria-hidden />
      <p className="mt-5 max-w-2xl text-lg text-fg-muted">
        Several tools convert multicolor files for the Snapmaker U1. I build one of them, so treat this
        as informed rather than neutral: every claim below comes from the other tools&apos; own pages and
        is linked, so you can check it.
      </p>
      <p className="mt-2 text-xs text-fg-subtle">Last checked: {UPDATED}. These tools ship changes; if something here is out of date, <Link href="/feedback" className={a}>tell me</Link> and I&apos;ll fix it.</p>

      {/* Start with the one Snapmaker points people to. It used to be described here as Snapmaker's own;
          it is not, and the wiki says so in its credits. Get that right before grading anyone else. */}
      <section className="mt-8 rounded-lg border border-line bg-surface-2 p-5">
        <h2 className="font-semibold text-fg">First: the converter Snapmaker&apos;s wiki links to</h2>
        <p className="mt-2 text-base text-fg-muted">
          Snapmaker&apos;s{" "}
          <a href={WIKI_GUIDE} {...ext} className={a}>U1 3MF Converter guide</a>{" "}
          sends you to{" "}
          <a href={U1CONVERT} {...ext} className={a}>u1convert.com</a>, a free tool built by community
          members and credited on that page. It handles MakerWorld, Bambu Studio and OrcaSlicer projects,
          keeps your print settings, and lets you reassign extra colors to the U1&apos;s 4 heads or carry
          them all through. If that covers your file, it&apos;s the obvious first stop.
        </p>
        <p className="mt-2 text-base text-fg-muted">
          Two things to know: it <strong className="text-fg">uploads your file to its server</strong> to
          convert it, and its profiles are for the <strong className="text-fg">0.4 mm nozzle</strong> only.
          The tools below exist for what falls outside that: other sources, other nozzles, more than 4
          colors, batch work, STL, or retargeting a U1 file to another printer.
        </p>
      </section>

      <section className="mt-6 rounded-lg border border-emerald-400/25 bg-emerald-500/[0.07] p-5">
        <h2 className="font-semibold text-fg">Does your file leave your computer?</h2>
        <p className="mt-2 text-base text-fg-muted">
          BedReady, <a href={FORGE} {...ext} className={a}>U1 Forge</a>,{" "}
          <a href={ANY2ORCA} {...ext} className={a}>any2orca</a>, the{" "}
          <a href={MW_EXT} {...ext} className={a}>MakerWorld to Snapmaker U1</a> extension,{" "}
          <a href={PAINTPORT} {...ext} className={a}>PaintPort</a> and{" "}
          <a href="https://github.com/ericreid/3mf-to-u1" {...ext} className={a}>3mf-to-u1</a>{" "}
          all convert on your own machine.{" "}
          <strong className="text-fg">u1convert.com and bl2u1 upload your file to a server.</strong>{" "}
          bl2u1&apos;s page says it keeps uploads for 8 hours. That&apos;s fine for a free MakerWorld
          model. It is not fine for a paid model, a client&apos;s file, or anything you don&apos;t have
          redistribution rights to. Both can be self-hosted if you want the server to be yours.
        </p>
        <p className="mt-3 text-base text-fg-muted">
          any2orca is new. It replaces bambu2orca, which kept your geometry local but posted the
          project&apos;s settings and object names to its API. any2orca runs the whole conversion locally,
          and its page says no file, mesh or vertex data is sent anywhere. The older version is still up
          at <a href={B2O} {...ext} className={a}>b2o.kuzuriao.com</a>, so check which one you&apos;re on.
        </p>
        <p className="mt-3 text-base text-fg-muted">
          My own claim, specifically: <strong className="text-fg">BedReady sends no part of your file
          anywhere — not the model, not its settings, not even the file name.</strong> The one exception
          is labeled where it happens: for files too large for a browser tab there&apos;s an optional
          server converter, and it&apos;s a button you press, never something that happens on its own.
        </p>
      </section>

      {/* Wider than the measure, so it widens about the same centre rather than moving the page. */}
      <div className="page-breakout page-breakout-wide mt-8 overflow-x-auto">
        <table className="w-full min-w-[78rem] border-collapse">
          <thead>
            <tr className="border-b border-line text-left">
              <th className={`${cell} font-medium text-fg-muted`}></th>
              {/* Anchored, because it is the column the page is about. */}
              <th className={`${cell} bg-violet-400/10 font-semibold text-fg`}>BedReady</th>
              <th className={`${cell} font-semibold text-fg-muted`}>u1convert.com</th>
              <th className={`${cell} font-semibold text-fg-muted`}>bl2u1</th>
              <th className={`${cell} font-semibold text-fg-muted`}>U1 Forge</th>
              <th className={`${cell} font-semibold text-fg-muted`}>any2orca</th>
              <th className={`${cell} font-semibold text-fg-muted`}>MakerWorld to U1 extension</th>
              <th className={`${cell} font-semibold text-fg-muted`}>PaintPort</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label} className="border-b border-line/60 align-top">
                <th scope="row" className={`${cell} sticky start-0 z-10 w-56 min-w-56 bg-app text-left font-medium text-fg-muted`}>
                  {r.label}
                  {r.note && <span className="mt-1 block text-xs font-normal text-fg-subtle">{r.note}</span>}
                </th>
                <td className={`${cell} bg-violet-400/[0.06] text-fg`}>{r.bedready}</td>
                {[r.u1c, r.bl2u1, r.forge, r.a2o, r.mw, r.pp].map((v, i) => (
                  <td key={i} className={`${cell} ${v === NS ? "text-fg-subtle" : "text-fg-muted"}`}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Credibility depends on this section existing. */}
      <section className="mt-10 rounded-lg border border-line bg-surface-2 p-5">
        <h2 className="font-semibold text-fg">When to use one of the others instead</h2>
        <ul className="mt-3 space-y-2 text-sm text-fg-muted">
          <li>
            <a href={ANY2ORCA} {...ext} className="font-semibold text-fg hover:underline">any2orca</a> ships U1
            profiles for <strong className="text-fg">0.2, 0.4, 0.6 and 0.8 nozzles</strong>, supports the{" "}
            <strong className="text-fg">High Flow</strong> hot end on 0.4, and has a{" "}
            <strong className="text-fg">command-line tool</strong> that converts in batches or watches a
            folder. Only my 0.4 profile is a real export from a machine that has printed; the others are
            derived. If you print with another nozzle, or want conversion in a script, use it. It also reads Creality, Anycubic, ELEGOO and Flashforge projects, and keeps
            every filament slot for you to map in Orca yourself.
          </li>
          <li>
            The <a href={MW_EXT} {...ext} className="font-semibold text-fg hover:underline">MakerWorld to Snapmaker U1</a>{" "}
            extension puts a convert button on MakerWorld itself, covers all four nozzle sizes, and can
            use a printer profile you exported from your own Orca. If you mostly download from MakerWorld,
            that&apos;s the shortest path.
          </li>
          <li>
            <a href={U1CONVERT} {...ext} className="font-semibold text-fg hover:underline">u1convert.com</a>{" "}
            is the one Snapmaker&apos;s wiki recommends, and it is{" "}
            <a href={U1CONVERT_REPO} {...ext} className={a}>open source and self-hostable</a>. For a
            straightforward Bambu or MakerWorld file on a 0.4 nozzle, that&apos;s a reasonable first stop,
            as long as uploading the file is fine with you.
          </li>
          <li>
            <a href={FORGE} {...ext} className="font-semibold text-fg hover:underline">U1 Forge</a> sits
            alongside tools BedReady doesn&apos;t have: turning photos into reliefs and painting them. If you
            want to <em>author</em> color rather than convert someone else&apos;s file, look there. Exports
            after the first are paid.
          </li>
          <li>
            <strong className="text-fg">bl2u1</strong> is open source and self-hostable, as is BedReady, at{" "}
            <a href={SOURCE_REPO_URL} target="_blank" rel="noopener noreferrer" className={a}>
              github.com/BedReady/bedready
            </a>
            . If you want to run the conversion on your own infrastructure, that&apos;s a real advantage.
          </li>
          <li>
            <a href={PAINTPORT} {...ext} className="font-semibold text-fg hover:underline">PaintPort</a>{" "}
            starts from <strong className="text-fg">the spools you actually have loaded</strong>: you enter
            the color in each slot and it matches every painted color to the closest one, blending the rest.
            Both tools turn a Bambu or Orca file into a <strong className="text-fg">Prusa CORE One INDX</strong>{" "}
            project with ColorMix blends. PaintPort also writes Bambu Studio&apos;s mixing format, so if you
            blend on a Bambu printer, use it. It does not supply the target printer&apos;s profile, and its
            README says it was tested against Snapmaker Orca 2.3.5. It&apos;s one HTML file that runs offline.
          </li>
          <li>
            <a href="https://github.com/ericreid/3mf-to-u1" {...ext} className="font-semibold text-fg hover:underline">3mf-to-u1</a>{" "}
            is a Chrome and Firefox extension that catches .3mf downloads from any site and converts them
            locally, mapping any number of filaments onto the U1&apos;s 4 slots.
          </li>
          <li>
            <a href="https://github.com/dlgambill/u1hub" {...ext} className="font-semibold text-fg hover:underline">u1hub</a>{" "}
            is a self-hosted hub for running one or more U1s (status, cameras, sending and scheduling
            prints) with a &ldquo;Convert to U1&rdquo; step for MakerWorld and Bambu projects built in. It
            won an award in Snapmaker&apos;s Innovation Fund. If you run a farm, start there.
          </li>
          <li>
            <strong className="text-fg">Snapmaker Orca itself</strong> keeps closing the gap.{" "}
            <a href="https://github.com/Snapmaker/OrcaSlicer/releases/tag/V2.3.6" {...ext} className={a}>2.3.6</a>{" "}
            added Color Mixing Match Mapping for files with more than 4 colors, and{" "}
            <a href="https://github.com/Snapmaker/OrcaSlicer/releases/tag/v2.4.0" {...ext} className={a}>2.4.0</a>{" "}
            added High Flow hot end support and renamed the U1 print presets (&ldquo;0.2 Standard&rdquo; is now
            &ldquo;0.20mm Standard&rdquo;). If your file is already a U1 or Orca project, you very likely
            don&apos;t need a converter: open it directly. Full Spectrum mixing on its own is no longer a
            reason to pick BedReady; what it adds is mapping arbitrary painted colors onto 4 heads, a custom
            CMYK basis and per-color overrides, before you ever open the slicer.
          </li>
        </ul>
      </section>

      <section className="mt-10 rounded-lg border border-line bg-surface-2 px-6 py-8 text-center">
        <p className="font-medium text-fg">Try it on a file that&apos;s given you trouble</p>
        <p className="mx-auto mt-1 max-w-lg text-base text-fg-muted">
          Nothing uploads, there&apos;s no account, and you see the colors before you download. If it
          gets your file wrong, send it to me — that&apos;s the most useful thing anyone can do.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link href="/convert" className="btn-primary btn-md">
            Open the converter
          </Link>
          <Link href="/verified" className="rounded-lg border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-fg transition hover:bg-surface-3">
            See files verified on a real U1
          </Link>
        </div>
      </section>

      <p className="mt-8 text-xs text-fg-subtle">
        Sources, all read {UPDATED}:{" "}
        <a href={WIKI_GUIDE} {...ext} className="hover:underline">Snapmaker U1 3MF Converter guide</a>,{" "}
        <a href={U1CONVERT} {...ext} className="hover:underline">u1convert.com</a> and{" "}
        <a href={U1CONVERT_REPO} {...ext} className="hover:underline">thadius83/bambu-to-snapmaker-u1</a>,{" "}
        <a href="https://bl2u1.nbn.cat/" {...ext} className="hover:underline">bl2u1.nbn.cat</a> and{" "}
        <a href="https://github.com/josuanbn/bl2u1" {...ext} className="hover:underline">josuanbn/bl2u1</a>,{" "}
        <a href={FORGE} {...ext} className="hover:underline">U1 Forge</a>,{" "}
        <a href="https://inkwell.wiki/ink" {...ext} className="hover:underline">Inkwell ink</a> and the{" "}
        <a href="https://forum.snapmaker.com/t/u1-forge-convert-any-bambu-prusa-makerworld-3mf-to-work-on-the-u1-toolchanger/42002" {...ext} className="hover:underline">U1 Forge announcement</a>,{" "}
        <a href={ANY2ORCA} {...ext} className="hover:underline">any2orca.com</a>,{" "}
        <a href={ANY2ORCA_REPO} {...ext} className="hover:underline">KuzuriAo/any2orca</a> and{" "}
        <a href={B2O} {...ext} className="hover:underline">b2o.kuzuriao.com</a>,{" "}
        <a href={MW_EXT} {...ext} className="hover:underline">Dragon2203/makerworld-to-snapmaker-u1</a>,{" "}
        <a href={PAINTPORT} {...ext} className="hover:underline">PaintPort</a> and{" "}
        <a href="https://github.com/perspektive3d/paintport" {...ext} className="hover:underline">perspektive3d/paintport</a>,{" "}
        <a href="https://github.com/ericreid/3mf-to-u1" {...ext} className="hover:underline">ericreid/3mf-to-u1</a>,{" "}
        <a href="https://github.com/dlgambill/u1hub" {...ext} className="hover:underline">dlgambill/u1hub</a>, and the{" "}
        <a href="https://github.com/Snapmaker/OrcaSlicer/releases" {...ext} className="hover:underline">Snapmaker Orca release notes</a>.
        BedReady is an independent project and is not affiliated with Snapmaker, Bambu Lab, or the authors of the tools above.
        &ldquo;Not stated&rdquo; means the tool&apos;s public page doesn&apos;t mention it — not that it definitely lacks it.
      </p>
    </main>
  );
}
