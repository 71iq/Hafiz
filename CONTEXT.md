# Hafiz domain context

Hafiz supports Quran reading, memorization review, and personal reflection. This glossary fixes the project terms that are easy to blur when code moves between routes, storage, and sync.

## Quran reading

**Ayah reference**:
A Surah number and Ayah number that identify one Ayah.
_Avoid_: Verse ID, Ayah ID

**Word reference**:
An Ayah reference plus the word's one-based position within that Ayah.
_Avoid_: Word ID, token index

**Mushaf page**:
One of the 604 canonical reading pages whose navigation and glyph layout follow the bundled page mapping.
_Avoid_: Screen, document page

**Reading selection**:
The Ayah or word range on which the reader can act, such as copying, bookmarking, highlighting, or opening details.
_Avoid_: Highlight, selected text

## Memorization review

**Study card**:
A persisted review item with one Quran target and its current scheduling state.
_Avoid_: Flashcard row, FSRS card

**Review deck**:
A named grouping of study cards that shares review policy and session limits.
_Avoid_: Card list, collection

**Smart deck**:
A review deck whose members come from Quran relationships or content rules rather than manual card selection.
_Avoid_: Virtual deck, dynamic filter

**Deck review policy**:
The limits, ordering, retention target, learning steps, and enabled review modes applied to one review deck.
_Avoid_: Scheduler config, deck options

**Review mode**:
The question and answer perspective used to test one study card, such as the next Ayah, translation, or word meaning.
_Avoid_: Card side, test type

**Review transition**:
The scheduling result of applying one rating to one study card at a specific time. It includes the next card state, the review record, and whether the card remains due that day.
_Avoid_: Grade result, card update

**Review session**:
One ordered run through due study cards, including same-day cards returned to the queue by a review transition.
_Avoid_: Review screen, study run

## Personal content

**Private note**:
User-authored content attached to Quran material and visible only to its owner.
_Avoid_: Reflection

**Reflection**:
User-authored Quran commentary that may participate in the reflection feed and public interactions.
_Avoid_: Note, private note
