/**
 * templates/distribution/construct-decision.typ — Construct distribution PDF.
 */

#import "construct-brand.typ": *

#set page(
  paper: "a4",
  margin: (x: 2cm, top: 1.8cm, bottom: 2.2cm),
  numbering: "1",
  header: construct-running-header(
    "$if(title)$$title$$endif$",
    doc-id: "$if(docId)$$docId$$endif$",
    version: "$if(version)$$version$$endif$",
  ),
  footer: construct-running-footer(
    "Decision record",
    classification: "$if(classification)$$classification$$endif$",
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
