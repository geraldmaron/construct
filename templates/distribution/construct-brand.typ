/**
 * templates/distribution/construct-brand.typ — shared Construct PDF brand tokens
 * and reusable layout components for type-specific Pandoc Typst templates.
 */

#let brand-accent = rgb("#8b5cf6")
#let brand-warm = rgb("#fb923c")
#let brand-navy = rgb("#0c1018")
#let brand-ink = rgb("#1a1a2e")
#let brand-muted = rgb("#6b7280")
#let brand-surface = rgb("#f4f4f6")
#let brand-surface-alt = rgb("#ede9fe")

#let brand-serif = ("Libertinus Serif", "New Computer Modern", "Times New Roman")
#let brand-sans = ("Helvetica Neue", "Arial", "Helvetica")
#let brand-mono = ("JetBrains Mono", "Menlo", "Consolas")

#let construct-metadata-band(status, owner, date, artifact-type) = {
  v(0.4em)
  block(
    fill: brand-surface,
    inset: (x: 14pt, y: 10pt),
    radius: 2pt,
    width: 100%,
  )[
    #set text(font: brand-sans, size: 9pt, fill: brand-muted)
    #grid(
      columns: (1fr, 1fr, 1fr, 1fr),
      gutter: 8pt,
      if status != "" [Status: #text(fill: brand-ink, weight: "semibold")[#status]],
      if owner != "" [Owner: #text(fill: brand-ink)[#owner]],
      if date != "" [Date: #text(fill: brand-ink)[#date]],
      if artifact-type != "" [Type: #text(fill: brand-accent)[#artifact-type]],
    )
  ]
  v(1em)
}

#let construct-cover(title, subtitle) = {
  block(
    fill: brand-navy,
    inset: (x: 24pt, y: 28pt),
    width: 100%,
  )[
    #set text(fill: white)
    #text(font: brand-serif, size: 26pt, weight: "bold")[#title]
    #if subtitle != "" [
      #v(0.5em)
      #text(font: brand-sans, size: 12pt, fill: rgb("#c4b5fd"))[#subtitle]
    ]
  ]
  v(1.2em)
  line(length: 100%, stroke: 1.2pt + brand-accent)
  v(0.8em)
}

#let construct-executive-summary(body) = {
  block(
    fill: brand-surface-alt,
    stroke: (left: 3pt + brand-accent),
    inset: (left: 14pt, rest: 12pt),
    width: 100%,
  )[
    #set par(justify: true, leading: 0.7em)
    #set text(font: brand-serif, size: 11.5pt, fill: brand-ink)
    #text(size: 9pt, weight: "bold", fill: brand-accent)[Executive summary]
    #v(0.35em)
    #body
  ]
  v(1em)
}

#let construct-key-metrics(body) = {
  block(
    stroke: 0.5pt + brand-accent.lighten(40%),
    inset: 12pt,
    width: 100%,
  )[
    #set text(size: 9pt, weight: "bold", fill: brand-accent)
    Key metrics
    #v(0.4em)
    #body
  ]
  v(1em)
}

#let construct-decision-callout(body) = {
  block(
    fill: brand-surface,
    stroke: 1pt + brand-warm,
    inset: 14pt,
    radius: 3pt,
    width: 100%,
  )[
    #set text(font: brand-sans, size: 10.5pt)
    #text(weight: "bold", fill: brand-warm)[Decision]
    #v(0.3em)
    #body
  ]
  v(1em)
}

#let construct-page-header(title) = context {
  if counter(page).get().first() > 1 [
    #set text(font: brand-sans, size: 9pt, fill: brand-muted)
    #text(fill: brand-accent, weight: "semibold")[Construct]
    #if title != "" [ · #title]
    #h(1fr)
    #counter(page).display("1")
  ]
}

#let construct-table-style() = {
  set table(
    stroke: 0.5pt + rgb("#e5e7eb"),
    inset: 8pt,
    fill: (x, y) => if y == 0 { brand-surface } else { none },
  )
  show table.cell.where(y: 0): set text(weight: "semibold", fill: brand-ink)
}

#let construct-figure-style() = {
  show figure: it => {
    v(0.8em, weak: true)
    block(
      stroke: 0.5pt + brand-accent.lighten(50%),
      inset: 10pt,
      width: 100%,
    )[
      #align(center)[#it.body]
    ]
    if it.caption != none {
      v(0.35em)
      align(center)[#text(size: 9pt, style: "italic", fill: brand-muted)[#it.caption]]
    }
    v(0.8em, weak: true)
  }
}

#let construct-heading-style() = {
  show heading.where(level: 1): it => {
    v(1.1em, weak: true)
    text(font: brand-sans, size: 17pt, weight: "bold", fill: brand-ink)[#it]
    v(0.55em, weak: true)
  }
  show heading.where(level: 2): it => {
    v(0.85em, weak: true)
    text(font: brand-sans, size: 13.5pt, weight: "semibold", fill: brand-ink)[#it]
    v(0.35em, weak: true)
  }
  show heading.where(level: 3): it => {
    v(0.55em, weak: true)
    text(font: brand-sans, size: 12pt, weight: "semibold", fill: brand-muted)[#it]
    v(0.25em, weak: true)
  }
}

#let construct-quote-style() = {
  show quote: it => construct-executive-summary(it.body)
}

#let construct-drop-cap() = {
  show par: it => {
    if counter(par).get().first() == 1 and query(heading).length == 0 {
      let first = it.body.first()
      if first != none and first.text().len() > 0 {
        let letter = first.text().first()
        let rest = first.text().slice(1)
        box(
          baseline: 20%,
          text(font: brand-serif, size: 2.4em, weight: "bold", fill: brand-accent)[#letter],
        )
        + rest
        + it.body.slice(1, it.body.len())
      } else {
        it
      }
    } else {
      it
    }
  }
}
