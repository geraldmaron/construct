/**
 * templates/distribution/construct-pdf.typ — fallback Pandoc Typst PDF template.
 *
 * Uses construct-brand tokens when no type-specific template matches.
 */

#import "construct-brand.typ": *

#set page(
  paper: "a4",
  margin: (x: 2.4cm, y: 2.6cm),
  numbering: "1",
  header: construct-page-header("$if(title)$$title$$endif$"),
)
#set par(justify: true, leading: 0.65em, spacing: 0.65em)
#set text(font: brand-serif, size: 11pt, lang: "en")
#set heading(numbering: "1.1", outlined: true)

#construct-heading-style()
#construct-table-style()
#construct-figure-style()

$if(title)$
#align(center)[
  #block(spacing: 0.4em)[
    #text(font: brand-serif, size: 22pt, weight: "bold", fill: brand-ink)[$title$]
  ]
  $if(subtitle)$
  #text(font: brand-sans, size: 12pt, fill: brand-muted)[$subtitle$]
  $endif$
  $if(date)$
  #v(0.5em)
  #text(font: brand-sans, size: 10pt, fill: brand-muted)[$date$]
  $endif$
]
#v(1.5em)
#line(length: 100%, stroke: 0.8pt + brand-accent)
#v(1.2em)
$endif$

$body$
