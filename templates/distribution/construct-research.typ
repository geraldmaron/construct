/**
 * templates/distribution/construct-research.typ — UN-style analytics PDF for research family.
 */

#import "construct-brand.typ": *

#set page(
  paper: "a4",
  margin: (x: 2cm, y: 2.2cm),
  numbering: "1",
  header: construct-page-header("$if(title)$$title$$endif$"),
)
#set par(justify: true, leading: 0.65em, spacing: 0.65em)
#set text(font: brand-sans, size: 10.5pt, lang: "en")
#set heading(numbering: "1.1", outlined: true)

#construct-heading-style()
#construct-table-style()
#construct-figure-style()

#let analytics-header(title, subtitle, status, owner, date, artifact-type) = {
  block(
    fill: brand-navy,
    inset: (x: 18pt, y: 16pt),
    width: 100%,
  )[
    #set text(fill: white)
    #text(font: brand-sans, size: 20pt, weight: "bold")[#title]
    #if subtitle != "" [
      #v(0.35em)
      #text(size: 11pt, fill: rgb("#c4b5fd"))[#subtitle]
    ]
    #v(0.6em)
    #set text(font: brand-sans, size: 8.5pt, fill: rgb("#9ca3af"))
    #if status != "" [Status: #text(fill: white)[#status] #h(1em)]
    #if owner != "" [Owner: #text(fill: white)[#owner] #h(1em)]
    #if date != "" [Date: #text(fill: white)[#date] #h(1em)]
    #if artifact-type != "" [Type: #text(fill: brand-accent.lighten(20%))[#artifact-type]]
  ]
  v(1em)
}

$if(title)$
#analytics-header("$title$", "$if(subtitle)$$subtitle$$endif$", "$if(status)$$status$$endif$", "$if(owner)$$owner$$endif$", "$if(date)$$date$$endif$", "$if(artifactType)$$artifactType$$endif$")
$endif$

$body$

#v(1fr)
#align(center)[
  #text(font: brand-sans, size: 8pt, fill: brand-muted)[Construct · Research analytics]
]
