/**
 * templates/distribution/construct-pdf.typ — fallback layout for any artifact
 * type without a mapped class (see lib/publish-template.mjs ARTIFACT_TEMPLATE_MAP).
 *
 * Metadata contract (Pandoc -M vars, sourced from artifact YAML frontmatter by
 * lib/publish-template.mjs parseArtifactMetadata): title, subtitle, date, status,
 * owner, artifactType, version, docId, classification. All optional; the masthead
 * and running chrome degrade gracefully when a field is absent. Page geometry and
 * all type/spacing tokens come from construct-brand.typ — never hardcode them here.
 */

#import "construct-brand.typ": *

#show: construct-theme

#set page(
  paper: construct-page-paper,
  margin: construct-page-margin,
  numbering: "1",
  header: construct-running-header(
    "$if(title)$$title$$endif$",
    doc-id: "$if(docId)$$docId$$endif$",
    version: "$if(version)$$version$$endif$",
  ),
  footer: construct-running-footer(
    "Document",
    classification: "$if(classification)$$classification$$endif$",
    doc-id: "$if(docId)$$docId$$endif$",
    version: "$if(version)$$version$$endif$",
  ),
)

$if(title)$
#construct-masthead(
  "$title$",
  "$if(subtitle)$$subtitle$$endif$",
  "$if(status)$$status$$endif$",
  "$if(owner)$$owner$$endif$",
  "$if(date)$$date$$endif$",
  "$if(artifactType)$$artifactType$$endif$",
  version: "$if(version)$$version$$endif$",
  doc-id: "$if(docId)$$docId$$endif$",
  classification: "$if(classification)$$classification$$endif$",
)
$endif$

$body$
