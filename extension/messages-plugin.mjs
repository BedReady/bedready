// esbuild plugin: when the extension imports ../../messages/<locale>.json, hand it only what it uses —
// the `ext` namespace and the converter's `convert.warn*` sentences — not the whole website's copy.
// Shared by build.mjs; the imports stay real files, so pack-source.mjs's metafile still lists them.
import { readFileSync } from "node:fs";

export const messagesSubset = {
  name: "bedready-messages-subset",
  setup(b) {
    b.onLoad({ filter: /[\\/]messages[\\/][a-z]{2}\.json$/ }, (args) => {
      const all = JSON.parse(readFileSync(args.path, "utf8"));
      const convert = Object.fromEntries(Object.entries(all.convert ?? {}).filter(([k]) => k.startsWith("warn")));
      return { contents: JSON.stringify({ ext: all.ext, convert }), loader: "json" };
    });
  },
};
