# Obligations: System architecture

What a deliverable this pack owns must carry, as checkable slots. Empty slots are named as empty, never filled with invention.

- **Boundaries.** what each component owns and what it must not know; where the design and the code disagree
- **Coupling.** the dependencies that make a change ripple, and which are deliberate
- **Data ownership.** which component is authoritative for each kind of data, and how the rest reach it
- **Failure modes.** what breaks when each dependency is slow, wrong, or gone
- **Reversibility.** what this design makes hard to undo, and the cost of undoing it
- **Measured properties.** each claimed property (scale, latency, availability) with the measurement or the word unmeasured
