# Share-card fonts

Read by `src/lib/og-card.tsx` for the next/og share cards. Noto Sans and Noto Sans Arabic, SIL Open
Font License 1.1 (`OFL.txt`), from github.com/google/fonts (`ofl/notosans`, `ofl/notosansarabic`).

Built from the variable fonts with fontTools:

```sh
fonttools varLib.instancer NotoSansArabic[wdth,wght].ttf wght=400 wdth=100 -o a.ttf   # and wght=800
pyftsubset a.ttf --unicodes="U+0600-06FF,U+FB50-FDFF,U+FE70-FEFF,U+0020,U+00A0,U+200C-200F" \
  --layout-features='' --drop-tables+=GSUB,GPOS,GDEF --no-hinting --desubroutinize \
  --output-file=NotoSansArabic-400.ttf

fonttools varLib.instancer NotoSans[wdth,wght].ttf wght=400 wdth=100 -o l.ttf          # and wght=800
pyftsubset l.ttf --unicodes="U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+2013-2014,U+2018-201E,U+2022,U+2026,U+2032-2033,U+20AC,U+2122,U+00B7" \
  --layout-features='kern' --drop-tables+=GSUB --no-hinting --output-file=NotoSans-400.ttf
```

Static instances because satori draws a variable font at its default instance only. The Arabic
font keeps no GSUB on purpose: satori's font parser throws on its contextual substitutions, and
`src/lib/card-text.ts` does the shaping itself with the presentation forms this subset keeps.
`card-text.test.mts` fails if the font is missing a form the shaper emits.
