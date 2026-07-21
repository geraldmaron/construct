/**
 * templates/distribution/construct-decision.typ — layout for decision-class
 * artifacts (adr, rfc, rfc-platform, security-audit-report). Same brand system
 * as every other class; only the footer label differs. Metadata contract
 * documented in construct-pdf.typ.
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
    "Decision record",
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
