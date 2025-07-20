# ImageCanvas Project Documentation

## Project Overview

ImageCanvas is a high-performance, collaborative media canvas application that supports real-time multi-user editing, manipulation, and organization of images, videos, and text content. The project has evolved from a single-user canvas to a full-featured collaborative platform with enterprise-grade performance and reliability.

## Claude Memories

- Always work normally and apply edits directly unless I specifically ask you to stage an edit. Then clear the STAGED_CHANGES.md and put your code there.
- When asked to review the staged changes or staged edits, read through the STAGED_CHANGES.md file in the root and make edits if necessary.
- When creating test files, diagnostic files, or temporary experimental files, ALWAYS place them in the appropriate folder:
  - `.scratch/` - For temporary experiments, diagnostic tests, and quick prototypes
  - `tests/integration/` - For multi-file integration tests
  - `tests/fixtures/` - For test HTML files and test data
  - NEVER place test files in the project root unless explicitly requested
- please write all documentation md files into the docs subdirectory