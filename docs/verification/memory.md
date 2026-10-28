# Export memory measurement

Same isolated Chromium 141 / macOS, 100,000 rows × 8 columns (one text identifier, seven decimal columns). CDP Runtime.getHeapUsage sampled every 50 ms, summing processing workers' used heap and backing storage. This measures the complete import/merge/export run, not total browser RSS or a guaranteed instantaneous maximum. Raw results are in memory-before.json and memory-after.json.

| Implementation | Sampled peak | Whole batch elapsed | Output |
|---|---:|---:|---:|
| ExcelJS document model + writeBuffer | 509.3 MiB | 62.06 s | 2,585,045 bytes |
| Incremental XLSX XML + ZIP/Deflate | 111.1 MiB | 61.63 s | see memory-after.json |

The output remains one Merged Data worksheet. The writer keeps a maximum of 1,000 source records and one page of XML in addition to compressed output chunks. Parsing input workbooks and duplicate fingerprints still consume memory. A browser/OS killing the entire worker cannot be caught as a JavaScript exception; saved rows can be retried after reload if conversion had completed.
