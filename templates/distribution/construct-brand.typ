/**
 * templates/distribution/construct-brand.typ — Construct distribution brand system.
 *
 * Single source of typographic, spacing, and color tokens for every bundled PDF
 * layout (prd, research, decision, fallback). The system is monochrome: black,
 * white, and a grey ink ramp carry all document chrome and accents, so printed
 * artifacts read as one consistent family regardless of type. Color belongs to
 * diagrams, not to the page furniture.
 *
 * Space Grotesk is referenced by explicit numeric weight (400/500/600/700) and ships
 * as a single weight-axis variable TTF registered under the family name "Space
 * Grotesk"; named weights like "Space Grotesk SemiBold" must never be used — they
 * fall back to a serif. Document-wide #set/#show rules sit at module scope so the Pandoc $body$
 * inherits them; exported helpers keep stable signatures for the layout templates.
 */

// Monochrome ink ramp. `ink` is the single strong accent (rules, ticks, header
// underlines, emphasis); the greys below it carry hierarchy; hairlines and
// surfaces stay near-white so panels read as paper, not color.

#let ink = rgb("#0a0c10")
#let ink-strong = rgb("#16191f")
#let ink-body = rgb("#23272e")
#let ink-muted = rgb("#565c66")
#let ink-faint = rgb("#9499a2")
#let hairline = rgb("#e3e4e8")
#let hairline-strong = rgb("#cdd0d6")
#let surface = rgb("#fafafa")
#let surface-alt = rgb("#f3f4f6")
#let paper = rgb("#ffffff")

// Back-compatible token names kept for any external reference, remapped onto the
// monochrome ramp so legacy callers inherit the new palette automatically.

#let brand-accent = ink
#let brand-accent-deep = ink
#let brand-violet-soft = ink-muted
#let brand-warm = ink
#let brand-warm-deep = ink-strong
#let brand-info = ink-muted
#let brand-success = ink
#let brand-navy = rgb("#0c1018")
#let brand-ink = ink-strong
#let brand-ink-soft = ink-body
#let brand-muted = ink-muted
#let brand-faint = ink-faint
#let brand-surface = surface
#let brand-surface-alt = surface-alt
#let brand-surface-warm = surface
#let brand-surface-info = surface-alt
#let brand-hairline = hairline
#let brand-rule = hairline-strong

#let construct-font-sans = ("Space Grotesk",)
#let construct-font-display = ("Space Grotesk",)
#let construct-font-mono = ("JetBrains Mono",)

// Type scale. One modular ramp shared by every document type so sizing never
// drifts between a PRD, a research brief, and a decision record.

#let fs-micro = 8pt
#let fs-small = 8.5pt
#let fs-meta = 9pt
#let fs-body = 10pt
#let fs-h4 = 8.5pt
#let fs-h3 = 11pt
#let fs-h2 = 13pt
#let fs-h1 = 17pt
#let fs-subtitle = 11.5pt
#let fs-title = 24pt

// Weight scale. Numeric only; these resolve to the bundled Space Grotesk variable face.

#let wt-regular = 400
#let wt-medium = 500
#let wt-semibold = 600
#let wt-bold = 700

#let construct-figure-max-width = 74%

// A document-type word maps to a compact badge so the masthead reads as a
// labelled artifact rather than a bare title.

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
    else [#upper(artifact-type)]
  }
}

// Status pill, monochrome. Settled states (approved/shipped) read as a solid
// black chip; active states as a black outline; everything else as a faint
// outline. Color is never used to encode status.

#let construct-status-pill(status) = {
  let s = lower(status).trim()
  let settled = s == "approved" or s == "shipped"
  let active = s.contains("review") or s.contains("progress")
  let fill-c = if settled { ink } else { paper }
  let stroke-c = if settled { ink } else if active { ink } else { hairline-strong }
  let text-c = if settled { paper } else if active { ink } else { ink-muted }
  box(
    fill: fill-c,
    inset: (x: 6pt, y: 2.5pt),
    radius: 3pt,
    stroke: 0.6pt + stroke-c,
    baseline: 0.16em,
  )[
    #text(font: construct-font-sans, size: 7pt, weight: wt-bold, fill: text-c, tracking: 0.05em)[#upper(status)]
  ]
}

// Kicker chips above the title: artifact badge, doc id, version, classification,
// separated by a faint dot.

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
    set text(font: construct-font-sans, size: fs-micro, weight: wt-bold, fill: ink, tracking: 0.08em)
    chips.join([#text(fill: ink-faint, weight: wt-regular)[ #sym.dot.c ]])
  }
}

// Byline pairs the status pill with owner and date in muted text.

#let construct-editorial-line(status, owner, date) = {
  let parts = ()
  if owner != "" { parts.push(owner) }
  if date != "" { parts.push(date) }
  let tail = if parts.len() == 0 { none } else {
    set text(font: construct-font-sans, size: fs-small, fill: ink-muted)
    parts.join([#text(fill: ink-faint)[ #sym.dot.c ]])
  }
  if status == "" and tail == none { none }
  else {
    box[
      #if status != "" [#construct-status-pill(status)#h(7pt)]
      #if tail != none [#tail]
    ]
  }
}

// Masthead: a cover-grade title block. Kicker chips, large display title, an
// optional subtitle, a byline, and a full hairline pinned by a short black tick
// at the left margin.

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
  let chips = construct-meta-chips(
    artifact-type,
    doc-id: doc-id,
    version: version,
    classification: classification,
  )
  if chips != none {
    chips
    v(0.62em)
  }
  text(font: construct-font-display, size: fs-title, weight: wt-semibold, fill: ink, tracking: -0.02em)[#title]
  if subtitle != "" {
    v(0.45em)
    text(font: construct-font-sans, size: fs-subtitle, fill: ink-muted, tracking: -0.005em)[#subtitle]
  }
  let byline = construct-editorial-line(status, owner, date)
  if byline != none {
    v(0.78em)
    byline
  }
  v(0.95em)
  block(width: 100%, height: 2pt, {
    place(left + horizon, line(length: 100%, stroke: 0.5pt + hairline))
    place(left + horizon, line(length: 46pt, stroke: 2pt + ink))
  })
  v(1.05em)
}

// Shared callout shell: a grey panel with a black left bar and a small bold
// uppercase label. Variants differ only by label and tint, never by color, so
// the differentiator is the word, not a hue.

#let construct-callout(label, body, tint: surface, bar: 2.5pt) = {
  block(
    fill: tint,
    stroke: (left: bar + ink, rest: none),
    inset: (left: 14pt, top: 11pt, bottom: 11pt, right: 13pt),
    width: 100%,
    radius: (right: 3pt),
  )[
    #set par(leading: 0.66em, spacing: 0.72em)
    #set text(font: construct-font-sans, size: fs-body, fill: ink-body)
    #text(size: 7.5pt, weight: wt-bold, fill: ink, tracking: 0.09em)[#upper(label)]
    #v(0.42em)
    #body
  ]
  v(0.85em)
}

#let construct-at-a-glance(body) = construct-callout("At a glance", body, tint: surface-alt)

#let construct-note(body) = construct-callout("Note", body, tint: surface)

#let construct-decision-callout(body) = construct-callout("Decision", body, tint: surface-alt, bar: 3.5pt)

// Key metrics reads as a measured card: clean surface, a top black rule, a bold
// label, then the metrics table.

#let construct-key-metrics(body) = {
  block(
    fill: surface,
    stroke: (top: 1.5pt + ink, rest: 0.5pt + hairline),
    inset: 13pt,
    width: 100%,
    radius: (bottom: 3pt),
  )[
    #text(font: construct-font-sans, size: 7.5pt, weight: wt-bold, fill: ink, tracking: 0.09em)[KEY METRICS]
    #v(0.48em)
    #body
  ]
  v(0.85em)
}

// Running header appears from page two: short title at left, doc id and page at
// right, closed by a hairline.

#let construct-running-header(title, doc-id: "", version: "") = context {
  if counter(page).get().first() > 1 [
    #set text(font: construct-font-sans, size: fs-micro, fill: ink-muted)
    #let short-title = if title.len() > 52 { title.slice(0, 49) + "…" } else { title }
    #text(fill: ink-muted)[#short-title]
    #h(1fr)
    #if doc-id != "" [
      #text(fill: ink, weight: wt-medium)[#doc-id]
      #text(fill: ink-faint)[ #sym.dot.c ]
    ]
    #if version != "" [
      #text(fill: ink-faint)[v#version]
      #text(fill: ink-faint)[ #sym.dot.c ]
    ]
    #text(fill: ink-muted)[#counter(page).display()]
    #v(0.3em)
    #line(length: 100%, stroke: 0.4pt + hairline)
  ]
}

#let construct-running-footer(footer-label, classification: "") = context {
  if counter(page).get().first() > 1 [
    #v(0.3em)
    #line(length: 100%, stroke: 0.4pt + hairline)
    #v(0.28em)
    #set text(font: construct-font-sans, size: fs-micro, fill: ink-faint)
    #align(center)[
      #text(weight: wt-bold, fill: ink, tracking: 0.04em)[Construct]
      #text[ #sym.dot.c #footer-label]
      #if classification != "" [ #sym.dot.c #upper(classification)]
    ]
  ]
}

// The theme function carries every body-level #set/#show rule. Module-scope set
// rules do NOT propagate through `#import`, so each layout template applies this
// with `#show: construct-theme` to wrap the Pandoc $body$ in the styled scope.
// Space Grotesk is referenced by numeric weight throughout to avoid serif fallback.

#let construct-theme(body) = {
  set text(font: construct-font-sans, size: fs-body, fill: ink-body, lang: "en", tracking: 0.002em)
  set par(justify: false, leading: 0.82em, spacing: 1.15em)
  set heading(numbering: none, outlined: true)

  show strong: set text(font: construct-font-sans, weight: wt-semibold, fill: ink)
  show emph: set text(style: "italic")

  // Lists inherit the open body leading; a per-item block gap keeps a wrapped
  // bullet from reading as two bullets, with the gap clearly wider than the
  // line leading within an item.

  show list.item: it => block(below: 0.6em, it)
  show enum.item: it => block(below: 0.6em, it)
  set list(marker: (text(fill: ink)[•], text(fill: ink-muted)[‣], text(fill: ink-faint)[–]), indent: 2pt, body-indent: 8pt, spacing: 0.9em)
  set enum(indent: 2pt, body-indent: 8pt, spacing: 0.9em)

  // Links carry ink with a hairline underline so citations stay legible without
  // introducing color.

  show link: it => {
    set text(fill: ink)
    underline(offset: 1.5pt, stroke: 0.5pt + hairline-strong, it)
  }

  // Headings. Level 2 is the working section header (the H1 title is rendered by
  // the masthead and stripped from the body), so it carries a short black rule.

  show heading.where(level: 1): it => {
    v(1.2em, weak: true)
    block(sticky: true, {
      text(font: construct-font-display, size: fs-h1, weight: wt-semibold, fill: ink, tracking: -0.015em)[#it.body]
      v(0.22em)
      line(length: 100%, stroke: 0.5pt + hairline)
      v(0.55em, weak: true)
    })
  }
  show heading.where(level: 2): it => {
    v(1.65em, weak: true)
    block(sticky: true, {
      text(font: construct-font-display, size: fs-h2, weight: wt-semibold, fill: ink, tracking: -0.01em)[#it.body]
      v(0.4em)
      line(length: 26pt, stroke: 1.5pt + ink)
      v(0.62em, weak: true)
    })
  }
  show heading.where(level: 3): it => {
    v(1.15em, weak: true)
    block(sticky: true, {
      text(font: construct-font-sans, size: fs-h3, weight: wt-semibold, fill: ink-strong)[#it.body]
      v(0.38em, weak: true)
    })
  }
  show heading.where(level: 4): it => {
    v(0.75em, weak: true)
    block(sticky: true, {
      text(font: construct-font-sans, size: fs-h4, weight: wt-bold, fill: ink-muted, tracking: 0.07em)[#upper(it.body)]
      v(0.22em, weak: true)
    })
  }

  // Inline code sits in a faint grey chip; block code in a bordered panel.

  show raw.where(block: false): it => box(
    fill: surface-alt,
    inset: (x: 3.5pt, y: 0pt),
    outset: (y: 2.5pt),
    radius: 2.5pt,
  )[#text(font: construct-font-mono, size: 8.8pt, fill: ink-strong)[#it]]

  show raw.where(block: true): it => block(
    fill: surface,
    stroke: 0.5pt + hairline,
    inset: 11pt,
    radius: 4pt,
    width: 100%,
  )[#text(font: construct-font-mono, size: fs-meta, fill: ink-body)[#it]]

  // Tables use a horizontal-only rule system: a strong black line under the bold
  // header, light hairlines between rows, no vertical chrome. The first column
  // carries semibold weight for scanning.

  set table(
    stroke: (x, y) => (
      bottom: if y == 0 { 1pt + ink } else { 0.5pt + hairline },
      top: none, left: none, right: none,
    ),
    inset: (x: 9pt, y: 7.5pt),
    fill: none,
  )
  show table.cell: it => {
    if it.y == 0 {
      set text(font: construct-font-sans, weight: wt-bold, fill: ink, size: fs-small)
      it
    } else {
      set text(
        font: construct-font-sans,
        size: fs-meta,
        fill: if it.x == 0 { ink-strong } else { ink-body },
        weight: if it.x == 0 { wt-semibold } else { wt-regular },
      )
      it
    }
  }

  // Pandoc wraps markdown tables in a centered figure; lift the table out and
  // left-align it so it reads as a clean data block aligned to the text column.

  show figure.where(kind: table): it => {
    if it.body.has("body") { align(left, it.body.body) } else { align(left, it.body) }
  }

  // Figures: a light bordered frame, a constrained width, and a caption that
  // leads with a bold figure number.

  set figure(supplement: "Figure")
  show figure.where(kind: image): it => {
    v(0.95em, weak: true)
    block(
      stroke: 0.5pt + hairline,
      fill: white,
      inset: 9pt,
      width: 100%,
      radius: 4pt,
    )[
      #align(center)[
        #box(width: construct-figure-max-width)[
          #show image: img => image(img, width: 100%, fit: "contain")
          #it.body
        ]
      ]
    ]
    if it.caption != none {
      v(0.35em)
      align(center)[
        #text(font: construct-font-sans, size: fs-micro, weight: wt-bold, fill: ink, tracking: 0.03em)[#it.supplement #it.counter.display()]
        #text(font: construct-font-sans, size: fs-micro, fill: ink-muted)[ — #it.caption.body]
      ]
    }
    v(0.95em, weak: true)
  }

  // Blockquotes route to callouts: a quote carrying a Metric/Baseline table
  // becomes the key-metrics card, anything else becomes the at-a-glance aside.

  show quote: it => {
    let r = repr(it.body)
    if r.contains("Metric") and r.contains("Baseline") {
      construct-key-metrics(it.body)
    } else {
      construct-at-a-glance(it.body)
    }
  }

  body
}
