notes from the appset incident review, raw

the delete/recreate loop (T-28511) reproduced in staging with the reverse deletion order. mitigation for now: incident runbook says switch the ApplicationSet to AllAtOnce deletion before deleting any child app by hand. that's the operational rule until the controller fix lands — worth remembering as a standing practice.

the wave-restart thing on hydrated repos: we confirmed each hydrator push restarts the rolling sync wave. interim call from the review: hydrator pilot repos must not use progressive sync until there's a debounce. the pilot ticket (T-27949) should carry that restriction so the next team doesn't trip it.

someone asked whether the strategy doc still says appset deletion stays manual — if the PRD ships ordered deletion those two disagree, needs an owner. not deciding here.
