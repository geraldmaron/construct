/**
 * templates/distribution/construct-brand.typ — product-editorial PDF brand tokens,
 * bundled Geist typography (matches dashboard/docs), compact masthead, body styles.
 *
 * Document-wide #set/#show rules live at module scope so Pandoc $body$ inherits Geist.
 */

#let brand-accent = rgb("#8b5cf6")
#let brand-warm = rgb("#fb923c")
#let brand-navy = rgb("#0c1018")
#let brand-ink = rgb("#111827")
#let brand-muted = rgb("#6b7280")
#let brand-surface = rgb("#f9fafb")
#let brand-surface-alt = rgb("#f5f3ff")
#let brand-violet-soft = rgb("#7c3aed")
#let brand-rule = brand-accent.transparentize(75%)

#let construct-font-sans = ("Geist",)
#let construct-font-display = ("Geist",)
#let construct-font-mono = ("Geist Mono",)
#let construct-figure-max-width = 84%
#let construct-figure-max-width = 84%

#let construct-badge-label(artifact-type) = {
  if artifact-type == "" [Document]
  else {
    let lower = lower(artifact-type)
    if lower.contains("prd") [PRD]
    else if lower.contains("research") or lower.contains("brief") or lower.contains("finding") [Research]
    else if lower.contains("adr") [ADR]
    else if lower.contains("rfc") [RFC]
    else if lower.contains("strategy") [Strategy]
    else if lower.contains("runbook") [Runbook]
    else [upper(artifact-type)]
  }
}

#let construct-meta-chips(
  artifact-type,
  doc-id: "",
  version: "",
  classification: "",
) = {
  let chips = ()
  if artifact-type != "" { chips.push(construct-badge-label(artifact-type)) }
  if doc-id != "" { chips.push(doc-id) }
  if version != "" { chips.push("v" + version) }
  if classification != "" { chips.push(upper(classification)) }
  if chips.len() == 0 { none }
  else {
    set text(font: construct-font-sans, size: 8pt, weight: "medium", fill: brand-violet-soft, tracking: 0.03em)
    chips.join([#text(fill: brand-muted)[ · ]])
  }
}

#let construct-editorial-line(status, owner, date) = {
  let parts = ()
  if status != "" { parts.push(status) }
  if owner != "" { parts.push(owner) }
  if date != "" { parts.push(date) }
  if parts.len() == 0 { none }
  else {
    set text(font: construct-font-sans, size: 8.5pt, fill: brand-muted)
    parts.join([#text(fill: brand-muted.lighten(20%))[ · ]])
  }
}

#let construct-masthead(
  title,
  subtitle,
  status,
  owner,
  date,
  artifact-type,
  version: "",
  doc-id: "",
  classification: "",
) = {
  block(
    width: 100%,
    stroke: (left: 3pt + brand-accent, rest: none),
    inset: (left: 14pt, rest: 0pt),
  )[
    #let chips = construct-meta-chips(
      artifact-type,
      doc-id: doc-id,
      version: version,
      classification: classification,
    )
    #if chips != none [
      #chips
      #v(0.45em)
    ]
    #text(font: construct-font-display, size: 22pt, weight: "semibold", fill: brand-ink)[#title]
    #if subtitle != "" [
      #v(0.35em)
      #text(font: construct-font-sans, size: 10.5pt, fill: brand-muted)[#subtitle]
    ]
    #v(0.45em)
    #let byline = construct-editorial-line(status, owner, date)
    #if byline != none [#byline]
  ]
  v(0.65em)
  line(length: 100%, stroke: 0.5pt + brand-rule)
  v(0.85em)
}

#let construct-at-a-glance(body) = {
  block(
    fill: brand-surface-alt,
    stroke: (left: 2.5pt + brand-accent),
    inset: (left: 14pt, rest: 12pt),
    width: 100%,
    radius: (right: 2pt),
  )[
    #set par(leading: 0.65em, spacing: 0.75em)
    #set text(font: construct-font-sans, size: 10.5pt, fill: brand-ink, tracking: 0.01em)
    #text(font: construct-font-sans, size: 7.5pt, weight: "semibold", fill: brand-accent, tracking: 0.06em)[AT A GLANCE]
    #v(0.35em)
    #body
  ]
  v(0.9em)
}

#let construct-key-metrics(body) = {
  block(
    fill: brand-surface,
    stroke: (top: 1.5pt + brand-accent, rest: 0.5pt + brand-rule),
    inset: 12pt,
    width: 100%,
    radius: 2pt,
  )[
    #set text(font: construct-font-sans, size: 7.5pt, weight: "semibold", fill: brand-accent, tracking: 0.06em)
    KEY METRICS
    #v(0.4em)
    #body
  ]
  v(0.9em)
}

#let construct-decision-callout(body) = {
  block(
    fill: brand-surface,
    stroke: 1pt + brand-warm,
    inset: 12pt,
    radius: 2pt,
    width: 100%,
  )[
    #set text(font: construct-font-sans, size: 10pt)
    #text(weight: "semibold", fill: brand-warm)[Decision]
    #v(0.25em)
    #body
  ]
  v(0.85em)
}

#let construct-running-header(title, doc-id: "", version: "") = context {
  if counter(page).get().first() > 1 [
    #set text(font: construct-font-sans, size: 8pt, fill: brand-muted)
    #let short-title = if title.len() > 48 { title.slice(0, 45) + "…" } else { title }
    #text(fill: brand-muted)[#short-title]
    #h(1fr)
    #if doc-id != "" [
      #text(fill: brand-accent, weight: "medium")[#doc-id]
      #h(0.5em)
    ]
    #if version != "" [
      #text[v#version]
      #h(0.5em)
    ]
    #counter(page).display()
    #v(0.25em)
    #line(length: 100%, stroke: 0.4pt + brand-rule)
  ]
}

#let construct-running-footer(footer-label, classification: "") = context {
  if counter(page).get().first() > 1 [
    #v(0.25em)
    #line(length: 100%, stroke: 0.4pt + brand-rule)
    #v(0.25em)
    #set text(font: construct-font-sans, size: 7.5pt, fill: brand-muted)
    #align(center)[
      #text(weight: "medium", fill: brand-accent)[Construct]
      #text[ · #footer-label]
      #if classification != "" [ · #upper(classification)]
    ]
  ]
}

#set text(font: construct-font-sans, size: 10.5pt, fill: brand-ink, lang: "en", tracking: 0.01em)
#set par(justify: false, leading: 0.68em, spacing: 0.72em)
#set heading(numbering: none, outlined: true)

#show strong: set text(font: construct-font-sans, weight: "semibold")
#show list.item: set text(font: construct-font-sans)
#show enum.item: set text(font: construct-font-sans)
#show raw: set text(font: construct-font-mono, size: 9.5pt)

#show heading.where(level: 1): it => {
  v(1em, weak: true)
  text(font: construct-font-display, size: 16pt, weight: "semibold", fill: brand-ink)[#it.body]
  v(0.45em, weak: true)
}
#show heading.where(level: 2): it => {
  v(0.85em, weak: true)
  text(font: construct-font-sans, size: 13pt, weight: "semibold", fill: brand-ink)[#it.body]
  v(0.35em, weak: true)
}
#show heading.where(level: 3): it => {
  v(0.55em, weak: true)
  text(font: construct-font-sans, size: 11pt, weight: "semibold", fill: brand-muted)[#it.body]
  v(0.25em, weak: true)
}

#set table(
  stroke: 0.5pt + rgb("#e5e7eb"),
  inset: (x: 9pt, y: 7pt),
  fill: (x, y) => if y == 0 {
    brand-surface-alt
  } else if calc.rem(y, 2) == 0 {
    brand-surface
  } else {
    none
  },
)
#show table.cell: it => {
  if it.y == 0 {
    set text(font: construct-font-sans, weight: "semibold", fill: brand-ink, size: 9pt)
    table.cell(
      it.body,
      stroke: (top: 1pt + brand-accent, rest: 0.5pt + rgb("#e5e7eb")),
    )
  } else {
    set text(
      font: construct-font-sans,
      size: 9pt,
      fill: brand-ink,
      weight: if it.x == 0 { "medium" } else { "regular" },
    )
    it
  }
}

#set figure(supplement: "Figure")
#show figure: it => {
  v(0.75em, weak: true)
  block(
    stroke: 0.5pt + brand-rule,
    inset: 8pt,
    width: 100%,
    radius: 3pt,
  )[
    #align(center)[
      #box(width: construct-figure-max-width)[
        #show image: img => image(img, width: 100%, fit: "contain")
        #it.body
      ]
    ]
  ]
  if it.caption != none {
    v(0.3em)
    align(center)[
      #text(font: construct-font-sans, size: 8.5pt, fill: brand-accent, weight: "medium")[#it.supplement #it.counter.display()]
      #text(font: construct-font-sans, size: 8.5pt, fill: brand-muted)[ — #it.caption.body]
    ]
  }
  v(0.75em, weak: true)
}

#show quote: it => {
  let raw = repr(it.body)
  if raw.contains("Metric") and raw.contains("Baseline") {
    construct-key-metrics(it.body)
  } else {
    construct-at-a-glance(it.body)
  }
}
