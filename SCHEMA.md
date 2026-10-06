# Workbook schema

The workbook has exactly three sheets, in this order: **People**, **Facts**, **Relationships**. Every sheet has a
frozen, filterable header row. All cells are text except **Source line**, which is a number. Text is stored
literally (never as a formula), so values such as `=SUM(A1)`, `+1 555`, `-5`, `@home` or `007` appear exactly as
written. A blank cell means the value is absent in the file.

Rows are linked with **Person ID**, **Family ID**, **Owner ID** and **Owner type**. Names are not unique.

## People (one row per person record, in file order)

| Column | Meaning |
| --- | --- |
| Person ID | The record ID as written, e.g. `@I5@` (or `INDI:L<line>` if the record has none) |
| Name (surname first) | "Surname, Given names Suffix" from the first NAME, blank parts left out |
| Primary name | The first NAME exactly as recorded (continuation lines joined) |
| Surname | Text between the first two slashes of the first NAME (or its SURN) |
| Given names | Text before the first slash (or GIVN) |
| Suffix | Text after the second slash (or NSFX) |
| Recorded sex | The first SEX value |
| All names | Every NAME in order, joined with " \| " |
| Name count | Number of NAME lines |
| Private | `Yes` if the record has a restriction of `privacy` |
| Restriction | The record's own RESN values, joined with " \| " |
| Source line | Line number of the `0 @I..@ INDI` line |
| All metadata 1..N | Lossless JSON of the whole person record |
| Raw GEDCOM 1..N | The original lines of the whole person record |

## Facts

One row for each of, in file order: every level-1 line of a person except NAME, SEX and RESN (those are in People);
every level-1 line of a family except HUSB, WIFE and CHIL (those are in Relationships); every other record (header,
submitter, sources, repositories, media, notes, trailer, custom records); and, at the end, every malformed line.
FAMC/FAMS links stay here as "Family link (child)" / "Family link (spouse)".

| Column | Meaning |
| --- | --- |
| Fact ID | `FACT-000001`, numbered in row order |
| Owner type | `Person`, `Family`, `Standalone record` or `Malformed line` |
| Owner ID | Person or Family ID; for a standalone record its ID or `<TAG>:L<line>` (e.g. `HEAD:L1`); for a malformed line `LINE:<n>` |
| Record type | `INDI`, `FAM` or the standalone record's tag; blank for malformed lines |
| Tag | The fact's own tag (e.g. `BIRT`, `_MILT`); blank for malformed lines |
| Fact type | Readable label (e.g. Birth, "Military service (custom _MILT)", "Unknown tag ZZZX", "Source record", "Malformed or unparsed line") |
| Type detail | The first TYPE under the fact |
| Value | The fact's own text, continuation lines joined; for a malformed line, the line itself |
| Date | The first DATE under the fact, exactly as recorded |
| Place | The first PLAC under the fact, exactly as recorded |
| Private | `Yes` if the fact or its owner record has a `privacy` restriction |
| Restriction | Every RESN value inside the fact, joined with " \| " |
| Owner restriction | The owner record's own RESN values (blank for standalone and malformed rows) |
| Source line | Line number of the fact's first line |
| All metadata 1..N | Lossless JSON of the fact's lines (for a malformed line: `{"line":n,"raw":"…","problem":"…"}`) |
| Raw GEDCOM 1..N | The original lines of the fact |

## Relationships (one row per spouse/child link of each family, in file order)

| Column | Meaning |
| --- | --- |
| Relationship ID | `REL-000001`, numbered in row order |
| Family ID | The family record ID (or `FAM:L<line>`) |
| Role | `Spouse 1` (HUSB), `Spouse 2` (WIFE), `Child` (CHIL), or `No recorded relationship links` for a family with no links (one placeholder row) |
| Original tag | HUSB, WIFE or CHIL; blank for the placeholder |
| Person ID | The linked person's ID exactly as written (kept even if no such person exists) |
| Private | `Yes` if the link or the family has a `privacy` restriction |
| Restriction | RESN values inside the link |
| Family restriction | The family's own RESN values |
| Source line | Line number of the link (the FAM line for a placeholder) |
| All metadata 1..N | Lossless JSON of the link and its sub-lines (e.g. `_FREL`, `_MREL`); for a placeholder, the whole family record |
| Raw GEDCOM 1..N | The original lines, same scope |

No relationship is inferred and nothing is deduplicated.

## All metadata JSON

Each node is `{"line":23,"level":1,"tag":"NAME","id":"@I5@","value":"…","children":[…]}` with keys in that order.
`id` is present only on records that have one, `value` only when not empty, `children` only when there are any.
CONT and CONC lines are kept as their own child nodes, and repeated tags stay separate entries, so the original lines
can be rebuilt exactly.

## Continuation columns

Excel cells hold at most 32,767 characters. The JSON and raw text are therefore split into parts of at most 30,000
characters (never between the two halves of an emoji or other surrogate pair) and written to `All metadata 1`,
`All metadata 2`, … and `Raw GEDCOM 1`, `Raw GEDCOM 2`, …. Columns are always numbered, even when there is only one.
Each sheet has as many columns as its longest row needs; shorter rows leave the extra columns empty. To get the full
text, join the numbered columns of a row in order with nothing between them.

If a readable column such as Value would exceed one cell, it is shortened with the note
"[… shortened here; the full text is in the All metadata and Raw GEDCOM columns]".

## Where things are

| Looking for | Sheet |
| --- | --- |
| Names, sex, record-level privacy | People |
| Events, attributes, notes, sources, media links, FAMC/FAMS, custom tags | Facts (Owner type Person/Family) |
| A family's own restriction line | Facts (Owner type Family, Tag RESN) and the Family restriction column |
| Spouses and children | Relationships |
| Header, sources, repositories, media, note records | Facts (Owner type Standalone record) |
| Lines the converter could not read | Facts (Owner type Malformed line) |
