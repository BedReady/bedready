import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { alternates } from "@/lib/seo";
import { SOURCE_REPO_URL } from "@/lib/links";

// Honest comparison against the other Snapmaker U1 .3mf converters. Targets the searches a U1 owner
// actually makes ("bl2u1 alternative", "U1 Forge vs", "best U1 3mf converter").
//
// ENGLISH ONLY, deliberately — same as the source→U1 landing pages. Two reasons: the queries this
// targets are English, and a comparison page makes factual claims about other people's products that
// change without notice. Six stale translations of a competitor's pricing is worse than none.
//
// RULES FOR EDITING THIS PAGE:
//   1. Every claim about another tool must come from THEIR public page, and be linked.
//   2. Date-stamp it. Competitors ship; a comparison is only true on a given day.
//   3. Keep the "when to use them instead" section honest. A comparison nobody believes is worthless,
//      and the fastest way to lose that is to pretend the alternatives have no advantages.
export const metadata: Metadata = {
  title: "Snapmaker U1 .3mf converters compared — official, bl2u1, U1 Forge, bambu2orca",
  description:
    "An honest comparison of the tools that convert Bambu, Prusa and MakerWorld .3mf files for the Snapmaker U1 — including Snapmaker's own free converter: what each supports, what it costs, whether there's a daily limit, and what actually gets sent to a server.",
  alternates: alternates("/compare-u1-converters"),
};

const UPDATED = "17 August 2026";

type Row = { label: string; bedready: string; bl2u1: string; forge: string; b2o: string; note?: string };

const ROWS: Row[] = [
  { label: "Source files", bedready: "Bambu, Prusa, Creality, Orca", bl2u1: "Bambu Lab only", forge: "Bambu, Prusa, MakerWorld", b2o: "Bambu Studio only" },
  {
    label: "Where conversion runs",
    bedready: "Your browser",
    bl2u1: "Their server",
    forge: "Your browser",
    b2o: "Your browser, but settings are sent to their server",
    note: "bl2u1's own page states uploaded files are deleted from the server after 8 hours. bambu2orca keeps your geometry local and posts the project's settings and object names to its own API — see the section above.",
  },
  { label: "Price", bedready: "Free", bl2u1: "Free (donations)", forge: "First export free, then ~$2 each", b2o: "Free" },
  {
    label: "Daily limit",
    bedready: "None",
    bl2u1: "Not documented",
    forge: "Not documented",
    b2o: "35 conversions per 24 hours; 150 on the Ko-fi supporter tier",
    note: "A converter that runs entirely on your own machine has nothing to meter. One that calls an API has to.",
  },
  { label: "Keeps painted multicolor", bedready: "Yes", bl2u1: "Yes", forge: "Yes", b2o: "Yes" },
  {
    label: "More than 4 colors",
    bedready: "Full Spectrum mixing, M600 swap pauses, or band-swap",
    bl2u1: "Pick 4, the rest are dropped",
    forge: "Not documented",
    b2o: "All slots passed through; you map them in Orca",
    note: "The U1 has 4 physical slots, so every tool has to do something here — the question is what.",
  },
  {
    label: "U1 nozzle profiles",
    bedready: "0.4",
    bl2u1: "Not documented",
    forge: "Not documented",
    b2o: "0.2, 0.4, 0.6, 0.8",
    note: "The one row on this page where somebody beats me outright. If you print with a 0.2 or 0.6 nozzle, that matters — it's on my list.",
  },
  { label: "Retarget to other printers", bedready: "U1 → Bambu / Prusa / Creality", bl2u1: "No", forge: "No", b2o: "No" },
  { label: "STL ⇄ 3MF", bedready: "Yes", bl2u1: "No", forge: "Not documented", b2o: "No" },
  { label: "Batch convert a folder", bedready: "Yes", bl2u1: "No", forge: "Not documented", b2o: "Ko-fi supporter tier only" },
  { label: "Live colored 3D preview", bedready: "Yes, before you download", bl2u1: "No", forge: "Not documented", b2o: "Not documented" },
  { label: "Installs Orca filament profiles", bedready: "Yes", bl2u1: "No", forge: "No", b2o: "No — but it relabels presets to Generic or Snapmaker" },
  { label: "Browser extension", bedready: "Chrome + Firefox", bl2u1: "Separate extension exists", forge: "No", b2o: "No" },
  { label: "Desktop app", bedready: "macOS, Windows, Linux", bl2u1: "No", forge: "No", b2o: "No" },
  { label: "Languages", bedready: "7", bl2u1: "English", forge: "English", b2o: "English" },
];

export default async function CompareConvertersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const cell = "px-3 py-2.5 align-top text-sm";

  return (
    // max-w-5xl, not 4xl: a fifth competitor column pushes the table past a 4xl container, and a
    // comparison table that needs sideways scrolling on a desktop is a comparison nobody compares.
    // The prose below stays at max-w-2xl, so only the table uses the extra width.
    <main className="shell py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        Snapmaker U1 .3mf converters, <span className="brand-text">compared</span>
      </h1>
      <div className="brand-rule mt-4 w-28" aria-hidden />
      <p className="mt-5 max-w-2xl text-lg text-fg-muted">
        Several tools convert multicolor files for the Snapmaker U1 — including one from Snapmaker
        themselves. I build one of them, so treat this as informed rather than neutral: every claim
        below comes from the other tools&apos; own pages and is linked, so you can check it.
      </p>
      <p className="mt-2 text-xs text-fg-subtle">Last checked: {UPDATED}. These tools ship changes; if something here is out of date, <Link href="/feedback" className="text-violet-300 hover:underline">tell me</Link> and I&apos;ll fix it.</p>

      {/* Start with the official one. A comparison page that quietly omits the manufacturer's own
          free tool is the kind of thing that destroys the credibility of everything else on it. */}
      <section className="mt-8 rounded-lg border border-line bg-surface-2 p-5">
        <h2 className="font-semibold text-fg">First: Snapmaker has its own converter, and it&apos;s free</h2>
        <p className="mt-2 text-base text-fg-muted">
          Snapmaker publishes a{" "}
          <a href="https://wiki.snapmaker.com/en/resource_hub/u1_3mf_converter_user_guide" target="_blank" rel="noopener noreferrer nofollow" className="text-violet-300 hover:underline">
            U1 3MF Converter guide
          </a>{" "}
          covering Bambu Studio and MakerWorld files, keeping your print settings, with up to 4
          filaments per plate. If that covers your file, use it — it&apos;s from the people who make
          the printer, and nothing on this page beats &ldquo;official and free&rdquo; for a
          straightforward conversion.
        </p>
        <p className="mt-2 text-base text-fg-muted">
          The tools below exist for what falls outside that: sources other than Bambu and MakerWorld,
          more than 4 colors, batch work, STL, or retargeting a U1 file to another printer.
        </p>
      </section>

      {/* Still a real difference, but "runs in your browser" now covers three different architectures.
          Spell out what each one actually sends instead of grading them on the adjective. */}
      <section className="mt-6 rounded-lg border border-emerald-400/25 bg-emerald-500/[0.07] p-5">
        <h2 className="font-semibold text-fg">Does your file leave your computer?</h2>
        <p className="mt-2 text-base text-fg-muted">
          BedReady, U1 Forge and the{" "}
          <a href="https://github.com/ericreid/3mf-to-u1" target="_blank" rel="noopener noreferrer nofollow" className="text-violet-300 hover:underline">3mf-to-u1</a>{" "}
          extension all convert inside your browser. <strong className="text-fg">bl2u1 uploads your
          file to a server</strong> and, per its own page, keeps it there for 8 hours. That&apos;s fine
          for a free MakerWorld model. It is not fine for a paid model, a client&apos;s file, or
          anything you don&apos;t have redistribution rights to.
        </p>
        <p className="mt-3 text-base text-fg-muted">
          <strong className="text-fg">&ldquo;In your browser&rdquo; has stopped being one thing, though.</strong>{" "}
          <a href="https://bambu2orca.kuzuriao.com/" target="_blank" rel="noopener noreferrer nofollow" className="text-violet-300 hover:underline">bambu2orca</a>{" "}
          is billed as a zero-upload converter, and its geometry really does stay local — its own FAQ
          says so, and invites you to check in DevTools. What it posts to its API is the project&apos;s
          settings, its object names and their bounding boxes. No mesh, but not nothing.
        </p>
        <p className="mt-3 text-base text-fg-muted">
          So the honest version of my own claim is the specific one, not the adjective:{" "}
          <strong className="text-fg">BedReady sends no part of your file anywhere — not the model, not
          its settings, not even the file name.</strong> The one exception is labelled where it happens:
          for files too large for a browser tab there&apos;s an optional server converter, and it&apos;s a
          button you press, never something that happens on its own.
        </p>
      </section>

      {/* Wider than the measure, so it widens about the same centre rather than moving the page. */}
      <div className="breakout mt-8 overflow-x-auto">
        <table className="w-full min-w-[58rem] border-collapse">
          <thead>
            <tr className="border-b border-line text-left">
              <th className={`${cell} font-medium text-fg-muted`}></th>
              {/* Anchored, because it is the column the page is about. It had no emphasis of any
                  kind — same weight, same ground — in a table this site commissioned. */}
              <th className={`${cell} bg-violet-400/10 font-semibold text-fg`}>BedReady</th>
              <th className={`${cell} font-semibold text-fg-muted`}>bl2u1</th>
              <th className={`${cell} font-semibold text-fg-muted`}>U1 Forge</th>
              <th className={`${cell} font-semibold text-fg-muted`}>bambu2orca</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label} className="border-b border-line/60 align-top">
                <th scope="row" className={`${cell} text-left font-medium text-fg-muted`}>
                  {r.label}
                  {r.note && <span className="mt-1 block text-xs font-normal text-fg-subtle">{r.note}</span>}
                </th>
                <td className={`${cell} bg-violet-400/[0.06] text-fg`}>{r.bedready}</td>
                <td className={`${cell} text-fg-muted`}>{r.bl2u1}</td>
                <td className={`${cell} text-fg-muted`}>{r.forge}</td>
                <td className={`${cell} text-fg-muted`}>{r.b2o}</td>
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
            <strong className="text-fg">U1 Forge</strong> has modes BedReady doesn&apos;t: painting color
            regions in the browser, applying surface textures, and cutting models. If you want to
            <em> author</em> color rather than convert someone else&apos;s file, it does things I don&apos;t.
          </li>
          <li>
            <strong className="text-fg">bl2u1</strong> is open source (GPL-3.0) and self-hostable — as
            is BedReady, at{" "}
            <a href={SOURCE_REPO_URL} target="_blank" rel="noopener noreferrer" className="text-violet-300 hover:underline">
              github.com/BedReady/bedready
            </a>
            . If you
            want to run the conversion on your own infrastructure, or read exactly what it does to your
            file, that&apos;s a real advantage.
          </li>
          <li>
            <strong className="text-fg">Snapmaker&apos;s own converter</strong> is official and free. For a
            straightforward Bambu or MakerWorld file inside 4 filaments, that is the obvious first stop.
          </li>
          <li>
            <a href="https://bambu2orca.kuzuriao.com/" target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-fg hover:underline">bambu2orca</a>{" "}
            ships U1 profiles for <strong className="text-fg">0.2, 0.4, 0.6 and 0.8 nozzles</strong> and picks
            one to match your file&apos;s layer height. I only ship 0.4. If you print with a different nozzle,
            use it — that is a real gap on my side and no amount of the rest of this table closes it. It also
            carries every filament slot through untouched rather than fitting them to the U1&apos;s 4 heads,
            which is what you want if you&apos;d rather do the mapping yourself in Orca.
          </li>
          <li>
            <a href="https://github.com/ericreid/3mf-to-u1" target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-fg hover:underline">3mf-to-u1</a>{" "}
            is a Chrome and Firefox extension that catches .3mf downloads from any site and converts them
            before they hit your disk, entirely locally. If a browser extension is all you want, it does
            that job and it&apos;s open source (GPL-3.0).
          </li>
          <li>
            <strong className="text-fg">Full Spectrum color mixing</strong> is no longer something only I
            do. Snapmaker Orca has 2–3 color mixing natively, and there are community tools —{" "}
            <a href="https://github.com/halloworld007/snapmaker-u1-fullspectrum-helper" target="_blank" rel="noopener noreferrer nofollow" className="text-violet-300 hover:underline">fullspectrum-helper</a>,{" "}
            <a href="https://github.com/dlgambill/u1hub" target="_blank" rel="noopener noreferrer nofollow" className="text-violet-300 hover:underline">u1hub</a>{" "}
            — that plan mixes too. Mine does more (arbitrary painted colors mapped onto 4 heads, a custom
            CMYK basis, per-color overrides), but &ldquo;we do Full Spectrum&rdquo; on its own is no longer
            a reason to pick this over those.
          </li>
          <li>
            <strong className="text-fg">Snapmaker Orca itself</strong> keeps improving. If your file is
            already a U1 or Orca project, you very likely don&apos;t need any converter — open it directly.
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
        Sources:{" "}
        <a href="https://bl2u1.nbn.cat/" target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">bl2u1.nbn.cat</a>,{" "}
        <a href="https://github.com/josuanbn/bl2u1" target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">josuanbn/bl2u1</a>,{" "}
        <a href="https://forum.snapmaker.com/t/u1-forge-convert-any-bambu-prusa-makerworld-3mf-to-work-on-the-u1-toolchanger/42002" target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">U1 Forge announcement</a>,{" "}
        <a href="https://wiki.snapmaker.com/en/resource_hub/u1_3mf_converter_user_guide" target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">Snapmaker U1 3MF Converter guide</a>,{" "}
        <a href="https://github.com/ericreid/3mf-to-u1" target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">ericreid/3mf-to-u1</a>,{" "}
        <a href="https://bambu2orca.kuzuriao.com/" target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">bambu2orca</a>{" "}
        (its landing page and FAQ, read {UPDATED}).
        BedReady is an independent project and is not affiliated with Snapmaker, Bambu Lab, or the authors of the tools above.
        &ldquo;Not documented&rdquo; means the tool&apos;s public page doesn&apos;t mention the feature — not that it definitely lacks it.
      </p>
    </main>
  );
}
