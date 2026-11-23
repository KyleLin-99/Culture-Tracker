# 0002: Culture codes are built by the database and never edited

**Decision:** A trigger builds each code from the item's parent and position (`S-2A1`, backups `(n)`, revivals `-n`), enforces the 20-character limit, and blocks later edits to code and lineage.

**Why:** A code is written on a physical label. If it could be typed by hand or edited, the label and the record could disagree, and lineage tracing would be wrong without anyone noticing.

**Gave up:** Fixing a mistake by editing; instead, retire the wrong item and make a new one. The app keeps a copy of the rules (`src/domain/cultureCode.ts`) for display and offline use; tests keep the two in step.
