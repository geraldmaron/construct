/**
 * templates/distribution/construct-prd.typ — Forbes-style editorial PDF for PRD family.
 */

#import "construct-brand.typ": *

#set page(
  paper: "a4",
  margin: (x: 2.2cm, y: 2.4cm),
  numbering: "1",
  header: construct-page-header("$if(title)$$title$$endif$"),
)
#set par(justify: true, leading: 0.68em, spacing: 0.68em)
#set text(font: brand-serif, size: 11pt, lang: "en")
#set heading(numbering: "1.1", outlined: true)

#construct-heading-style()
#construct-table-style()
#construct-figure-style()
#construct-quote-style()

$if(title)$
#construct-cover("$title$", "$if(subtitle)$$subtitle$$endif$")
#construct-metadata-band("$if(status)$$status$$endif$", "$if(owner)$$owner$$endif$", "$if(date)$$date$$endif$", "$if(artifactType)$$artifactType$$endif$")
$endif$

$body$

#v(1fr)
#align(center)[
  #line(length: 40%, stroke: 0.5pt + brand-accent)
  #v(0.3em)
  #text(font: brand-sans, size: 8pt, fill: brand-muted)[Construct · Editorial brief]
]
