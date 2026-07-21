/**
 * templates/distribution/construct-brand.typ — field-notebook distribution brand.
 *
 * Cool stone paper, charcoal ink, slate-teal evidence accent, Plus Jakarta Sans.
 * Visual language is hand-drawn editorial: open (not inverted) cover band, dashed
 * rules, circle section markers, sketched callout frames. Color on the page is for
 * evidence/decision emphasis; diagrams carry sketch geometry separately.
 *
 * Plus Jakarta Sans uses explicit numeric weights (400/500/600/700) on bundled
 * TTF cuts. Document-wide #set/#show rules live in construct-theme; layout
 * templates import helpers from here.
 */

// Field-notebook ink ramp. Accent marks evidence and decision chrome only.

#let ink = rgb("#1a1d24")
#let ink-strong = rgb("#12141a")
#let ink-body = rgb("#2c313a")
#let ink-muted = rgb("#545b66")
#let ink-faint = rgb("#8b919a")
#let hairline = rgb("#d5d8dd")
#let hairline-strong = rgb("#c0c5cc")
#let surface = rgb("#eef1f3")
#let surface-alt = rgb("#e3e7ea")
#let paper = rgb("#f7f8f9")
#let accent = rgb("#1f5c61")
#let accent-soft = rgb("#d8e6e7")

#let construct-font-sans = ("Plus Jakarta Sans",)
#let construct-font-display = ("Plus Jakarta Sans",)
#let construct-font-mono = ("JetBrains Mono",)

#let horizontalrule = block(width: 100%, above: 1.5em, below: 1.5em)[
  #line(length: 100%, stroke: (paint: hairline-strong, thickness: 0.9pt, dash: "dashed"))
]

// Type scale. Modular ramp off an 11pt body; every step must read distinctly.

#let fs-micro = 7.5pt
#let fs-small = 8.5pt
#let fs-meta = 9pt
#let fs-body = 11pt
#let fs-h4 = 8.5pt
#let fs-h3 = 12.5pt
#let fs-h2 = 15pt
#let fs-h1 = 18pt
#let fs-subtitle = 12pt
#let fs-title = 28pt
#let fs-cover-badge = 9pt

#let wt-regular = 400
#let wt-medium = 500
#let wt-semibold = 600
#let wt-bold = 700

// Notebook page geometry: slightly wider outer margin for sketch breathing room.

#let construct-page-paper = "a4"
#let construct-page-margin = (left: 2.4cm, right: 2.2cm, top: 2.2cm, bottom: 2.5cm)

#let construct-figure-max-width = 94%
#let construct-figure-max-height = 3.6in

#let construct-smart-text(s) = {
  str(s).replace("---", "\u{2014}").replace("--", "\u{2013}").replace("...", "\u{2026}")
}

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

// Status reads as bracketed uppercase text beside a hand-drawn accent tick.

#let construct-status-label(status) = {
  if status == "" { none }
  else {
    grid(
      columns: (auto, auto),
      column-gutter: 8pt,
      align: horizon,
      box(width: 10pt, height: 10pt, stroke: (paint: accent, thickness: 1.1pt, dash: "dashed"), radius: 50%),
      text(font: construct-font-mono, size: fs-small, weight: wt-medium, fill: ink, tracking: 0.06em)[\[#upper(status)\]],
    )
  }
}

#let construct-meta-grid(
  artifact-type,
  owner,
  date,
  doc-id: "",
  version: "",
  classification: "",
) = {
  let rows = ()
  if artifact-type != "" { rows.push(("Type", construct-badge-label(artifact-type))) }
  if doc-id != "" { rows.push(("ID", doc-id)) }
  if version != "" { rows.push(("Version", "v" + version)) }
  if classification != "" { rows.push(("Classification", upper(classification))) }
  if owner != "" { rows.push(("Owner", owner)) }
  if date != "" { rows.push(("Date", date)) }
  if rows.len() == 0 { none }
  else {
    block(
      width: 100%,
      fill: paper,
      stroke: (paint: hairline-strong, thickness: 0.85pt, dash: "dashed"),
      inset: 10pt,
      radius: 4pt,
      above: 1.1em,
      below: 0.4em,
    )[
      #grid(
        columns: (auto, 1fr),
        column-gutter: 14pt,
        row-gutter: 6pt,
        ..rows.map(row => (
          text(font: construct-font-sans, size: fs-micro, weight: wt-bold, fill: accent, tracking: 0.08em)[#upper(row.at(0))],
          text(font: construct-font-sans, size: fs-small, weight: wt-medium, fill: ink-strong)[#row.at(1)],
        )).flatten()
      )
    ]
  }
}

// Cover masthead: open notebook band (paper on stone), display title, dashed rule.

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
    fill: surface,
    stroke: (paint: hairline-strong, thickness: 1pt, dash: "dashed"),
    inset: (x: 16pt, y: 12pt),
    radius: 4pt,
  )[
    #set text(font: construct-font-sans, fill: ink)
    #grid(
      columns: (1fr, auto),
      align: (left, right),
      [
        #text(size: fs-cover-badge, weight: wt-bold, fill: accent, tracking: 0.12em)[#construct-badge-label(artifact-type)]
      ],
      [
        #if doc-id != "" [
          #text(font: construct-font-mono, size: fs-micro, weight: wt-medium, tracking: 0.04em, fill: ink-muted)[#doc-id]
        ]
      ],
    )
  ]
  v(1.35em)
  par(
    leading: 0.38em,
    text(font: construct-font-display, size: fs-title, weight: wt-bold, fill: ink, tracking: -0.02em)[#construct-smart-text(title)],
  )
  if subtitle != "" {
    v(0.65em)
    par(
      leading: 0.52em,
      text(font: construct-font-sans, size: fs-subtitle, weight: wt-regular, fill: ink-muted, tracking: -0.008em)[#construct-smart-text(subtitle)],
    )
  }
  let status-label = construct-status-label(status)
  if status-label != none {
    v(0.85em)
    status-label
  }
  let grid = construct-meta-grid(
    artifact-type,
    owner,
    date,
    doc-id: doc-id,
    version: version,
    classification: classification,
  )
  if grid != none { grid }
  v(1.25em)
  line(length: 100%, stroke: (paint: accent, thickness: 2.2pt, dash: "dashed"))
  v(1.65em)
}

// Sketched callout shell: soft fill, dashed border, overline label.

#let construct-callout(label, body, tint: paper) = {
  block(
    fill: tint,
    stroke: (paint: hairline-strong, thickness: 0.9pt, dash: "dashed"),
    inset: (left: 14pt, top: 13pt, bottom: 12pt, right: 14pt),
    width: 100%,
    radius: 4pt,
    above: 1.15em,
    below: 1.15em,
  )[
    #set par(leading: 0.68em, spacing: 0.78em)
    #set text(font: construct-font-sans, size: fs-body, fill: ink-body)
    #place(top + left, dx: 10pt, dy: -7pt)[
      #box(fill: paper, inset: (x: 4pt, y: 0pt))[
        #text(size: fs-micro, weight: wt-bold, fill: accent, tracking: 0.1em)[#upper(label)]
      ]
    ]
    #v(0.35em)
    #body
  ]
}

#let construct-at-a-glance(body) = construct-callout("At a glance", body, tint: accent-soft)

#let construct-note(body) = construct-callout("Note", body, tint: paper)

#let construct-decision-callout(body) = construct-callout("Decision", body, tint: surface-alt)

#let construct-key-metrics(body) = {
  block(
    fill: surface,
    stroke: (top: 2.2pt + accent, rest: (paint: hairline-strong, thickness: 0.85pt, dash: "dashed")),
    inset: 14pt,
    width: 100%,
    radius: (bottom: 4pt),
    above: 1.15em,
    below: 1.15em,
  )[
    #text(font: construct-font-sans, size: fs-micro, weight: wt-bold, fill: accent, tracking: 0.11em)[KEY METRICS]
    #v(0.55em)
    #body
  ]
}

// Running header: sketched page chip in outer corner.

#let construct-running-header(title, doc-id: "", version: "") = context {
  if counter(page).get().first() > 1 [
    #set text(font: construct-font-mono, size: fs-micro, fill: ink-muted)
    #align(right)[
      #box(
        stroke: (paint: hairline-strong, thickness: 0.7pt, dash: "dashed"),
        inset: (x: 5pt, y: 2pt),
        radius: 3pt,
      )[
        #counter(page).display()
      ]
    ]
  ]
}

// Running footer: doc metadata left, document class right. No product wordmark.

#let construct-running-footer(
  footer-label,
  classification: "",
  doc-id: "",
  version: "",
) = context {
  if counter(page).get().first() > 1 [
    #v(0.35em)
    #line(length: 100%, stroke: (paint: hairline, thickness: 0.6pt, dash: "dashed"))
    #v(0.38em)
    #grid(
      columns: (1fr, auto),
      align: (left, right),
      {
        let parts = ()
        if doc-id != "" { parts.push(text(fill: ink-muted)[#doc-id]) }
        if version != "" { parts.push(text(fill: ink-faint)[v#version]) }
        if classification != "" { parts.push(text(fill: ink-faint)[#upper(classification)]) }
        if parts.len() == 0 { none }
        else {
          set text(font: construct-font-mono, size: fs-micro)
          parts.join([#text(fill: ink-faint)[ · ]])
        }
      },
      text(font: construct-font-sans, size: fs-micro, weight: wt-bold, fill: ink-muted, tracking: 0.05em)[#footer-label],
    )
  ]
}

#let blockquote(body) = quote(block: true, body)

#let section-counter = counter("construct-section")

#let construct-theme(body) = {
  set page(fill: paper)
  set text(font: construct-font-sans, size: fs-body, fill: ink-body, lang: "en", tracking: 0.001em)
  set par(justify: false, leading: 1.02em, spacing: 1.35em)
  set heading(numbering: none, outlined: true)

  show strong: set text(font: construct-font-sans, weight: wt-semibold, fill: ink)
  show emph: set text(style: "italic")

  set list(marker: (text(fill: accent)[•], text(fill: ink-muted)[◦], text(fill: ink-faint)[·]), indent: 0.3em, body-indent: 0.7em, spacing: 1.05em)
  set enum(numbering: "1.", indent: 0.3em, body-indent: 0.7em, spacing: 1.05em)
  set terms(hanging-indent: 1em, spacing: 1.05em)

  show link: it => {
    set text(fill: accent)
    underline(offset: 2pt, stroke: 0.55pt + accent-soft, it)
  }

  show heading.where(level: 1): it => {
    block(sticky: true, above: 2.2em, below: 1em, {
      v(0.15em)
      line(length: 100%, stroke: (paint: accent, thickness: 1.6pt, dash: "dashed"))
      v(0.55em)
      set par(leading: 0.42em)
      text(font: construct-font-display, size: fs-h1, weight: wt-bold, fill: ink, tracking: -0.018em)[#it.body]
    })
  }

  show heading.where(level: 2): it => {
    section-counter.step()
    block(sticky: true, above: 2.8em, below: 1em, {
      v(0.2em)
      line(length: 100%, stroke: (dash: "dotted", paint: hairline-strong))
      v(0.65em)
      grid(
        columns: (auto, auto, 1fr),
        column-gutter: 8pt,
        align: (horizon, bottom, bottom),
        box(width: 9pt, height: 9pt, stroke: (paint: accent, thickness: 1pt, dash: "dashed"), radius: 50%),
        text(font: construct-font-mono, size: fs-h4, weight: wt-medium, fill: ink-faint)[
          #section-counter.display("01")
        ],
        text(font: construct-font-display, size: fs-h2, weight: wt-semibold, fill: ink, tracking: -0.012em)[#it.body],
      )
    })
  }

  show heading.where(level: 3): it => {
    block(sticky: true, above: 2em, below: 0.85em, {
      set par(leading: 0.46em)
      text(font: construct-font-sans, size: fs-h3, weight: wt-medium, fill: ink-strong)[#it.body]
    })
  }

  show heading.where(level: 4): it => {
    block(sticky: true, above: 1.35em, below: 0.4em, {
      text(font: construct-font-sans, size: fs-h4, weight: wt-bold, fill: ink-muted, tracking: 0.09em)[#upper(it.body)]
    })
  }

  show raw.where(block: false): it => box(
    fill: surface-alt,
    inset: (x: 4pt, y: 0pt),
    outset: (y: 2.5pt),
    radius: 2pt,
    stroke: 0.4pt + hairline,
  )[#text(font: construct-font-mono, size: 9pt, fill: ink-strong)[#it]]

  show raw.where(block: true): it => block(
    fill: surface,
    stroke: (paint: hairline-strong, thickness: 0.7pt, dash: "dashed"),
    inset: 12pt,
    radius: 4pt,
    width: 100%,
    above: 1.35em,
    below: 1.35em,
  )[#text(font: construct-font-mono, size: fs-meta, fill: ink-body)[#it]]

  set table(
    stroke: 0.5pt + hairline,
    inset: (x: 10pt, y: 8pt),
    fill: (x, y) => if y == 0 { accent-soft } else if calc.rem(y, 2) == 0 { surface } else { paper },
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

  show figure.where(kind: table): set block(breakable: true)
  show figure.where(kind: table): it => {
    let content = if it.body.has("body") { it.body.body } else { it.body }
    block(above: 1.25em, below: 1.4em, width: 100%, align(left, content))
  }

  set figure(supplement: "Figure")
  show figure.where(kind: image): it => block(above: 1.25em, below: 1.25em, breakable: false, {
    block(
      stroke: (paint: hairline-strong, thickness: 0.85pt, dash: "dashed"),
      fill: paper,
      inset: 12pt,
      width: 100%,
      radius: 4pt,
    )[
      #align(center, layout(avail => {
        let natural = measure(it.body)
        if natural.width == 0pt or natural.height == 0pt { it.body } else {
          let f = calc.min(
            (avail.width * construct-figure-max-width) / natural.width,
            construct-figure-max-height / natural.height,
            1,
          )
          scale(x: f * 100%, y: f * 100%, reflow: true, it.body)
        }
      }))
    ]
    if it.caption != none {
      v(0.45em)
      align(left)[
        #text(font: construct-font-mono, size: fs-micro, weight: wt-medium, fill: accent)[Fig. #it.counter.display()]
        #text(font: construct-font-sans, size: fs-micro, fill: ink-muted)[: #it.caption.body]
      ]
    }
  })

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
