# ImageCanvas Project Documentation

## A Note

I'm not really a programmer, so sometimes my wording won't be very precise. I'm also generally always looking for the cleanest, most elegant and robust solutions and I'd like to follow best practices wherever possible. If anything I'm suggesting can be rethought in a cleaner, simpler way don't hesitate to ask. I'm not trying to reinvent the wheel.

## Project Overview

ImageCanvas is a high-performance, collaborative media canvas application that supports real-time multi-user editing, manipulation, and organization of images, videos, and text content. The project has evolved from a single-user canvas to a full-featured collaborative platform with enterprise-grade performance and reliability.

## Documentation Library

Documentation can be read, maintained and added to in the `/docs` subdirectory. If you ever need clarification on anything we're doing, it might be a good idea to read through it. Don't put plans or reports of fixes here, just documentation that would be useful to another agent reading about the project.

## Plans and Fixes

Please place plans and fixes in the `/plans` subdirectory. This would include any reports on what was fixed, or audits of systems. Please don't place those in the `/docs` folder.

## Claude Memories

- Always work normally and apply edits directly unless I specifically ask you to stage an edit. Then clear the STAGED_CHANGES.md and put your code there.
- When asked to review the staged changes or staged edits, read through the STAGED_CHANGES.md file in the root and make edits if necessary.
- When creating test files, diagnostic files, or temporary experimental files, ALWAYS place them in the appropriate folder:
  - `.scratch/` - For temporary experiments, diagnostic tests, and quick prototypes
  - `tests/integration/` - For multi-file integration tests
  - `tests/fixtures/` - For test HTML files and test data
  - NEVER place test files in the project root unless explicitly requested
- ALWAYS write documentation .md files into the `/docs` subdirectory.
- NEVER claim that what you've done works perfectly unless you've tested it yourself.
- When troubleshooting and fixing bugs, be more proactive and think ahead to how a bug fix might apply to other similar circumstances, especially across multiple node and synced operation types.
- The node server runs on port 3000 and the client server on port 8000, by default. Try those first when running tests. Also let me know if you feel like it's time to update this or remove this memory.

## Prime Directive

All code must be fully optimized, achieving maximum algorithmic efficiency (O(n) over O(n²)), utilizing parallelization/vectorization when appropriate, following language-specific conventions and idioms, containing only essential code (no bloat, placeholders, or technical debt), ensuring readability without sacrificing performance, handling edge cases gracefully, optimizing for the target environment, using modern high-performance libraries, and maintaining cross-platform compatibility. 