# bigint-buffer compatibility package

This local package implements the four `bigint-buffer` conversion functions in
pure JavaScript. It intentionally contains no native addon and validates output
widths instead of truncating values. It replaces the unpatched transitive
`bigint-buffer@1.1.5` dependency used by Dynamic's optional Solana connector.
