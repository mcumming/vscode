---
description: Convert markdown files to DOCX format with support for standard markdown elements and mermaid diagrams
---

# Convert Markdown to DOCX

This skill provides instructions for converting markdown files to properly formatted DOCX documents using the repository's built-in converter script.

## When to Use This Skill

Use this skill when asked to:
- Convert a markdown file to DOCX format
- Export markdown to Word document
- Generate a DOCX from markdown content
- Create a Word document from markdown

## Prerequisites

The repository includes a Python-based converter at the root:
- `md_to_docx.py` - Conversion script
- `requirements_md_converter.txt` - Python dependencies

## Conversion Steps

### 1. Ensure Dependencies Are Installed

First, verify Python dependencies are installed:

```powershell
pip install -r requirements_md_converter.txt
```

This installs:
- `python-docx>=0.8.11` - DOCX generation
- `markdown>=3.4.0` - Markdown parsing

### 2. Run the Conversion Script

**Default usage** (output filename = input filename with .docx extension):
```powershell
python md_to_docx.py <input.md>
```

**Custom output filename**:
```powershell
python md_to_docx.py <input.md> <output.docx>
```

### 3. Verify Output

Check that the DOCX file was created successfully and contains the expected content.

## Supported Markdown Features

The converter supports:
- **Headings** (H1-H6)
- **Inline formatting**: `**bold**`, `*italic*`, `` `code` ``
- **Links**: `[text](url)`
- **Images**: `![alt](path)` - embedded at 5 inches width
- **Code blocks**: Fenced code blocks with syntax highlighting
- **Lists**: Bulleted (`-`, `*`, `+`) and numbered (`1.`, `2.`)
- **Horizontal rules**: `---`, `***`, `___`
- **Mermaid diagrams**: Converted to PNG images (requires mermaid-cli)

## Mermaid Diagram Support (Optional)

For mermaid diagram rendering, mermaid-cli must be installed:

```powershell
npm install -g @mermaid-js/mermaid-cli
```

If mermaid-cli is not available, the script continues but skips diagram conversion with a warning.

## Example Usage

Convert a plan document:
```powershell
python md_to_docx.py docs\plan-entra-id-marketplace.md
# Creates: docs\plan-entra-id-marketplace.docx
```

Convert with custom output name:
```powershell
python md_to_docx.py README.md project-readme.docx
# Creates: project-readme.docx
```

## Implementation Notes

- **Relative image paths** are resolved relative to the input markdown file's directory
- **Temporary files** (for mermaid diagrams) are automatically cleaned up after conversion
- **Error handling**: The script continues on non-critical errors (e.g., missing images, mermaid unavailable) and logs warnings
- **Output location**: By default, the DOCX is created in the same directory as the input file

## Common Issues

**Import errors**: If `python-docx` or `markdown` modules are missing, install dependencies:
```powershell
pip install -r requirements_md_converter.txt
```

**Mermaid warnings**: If you see "Mermaid rendering not available" but don't need diagrams, ignore the warning. Otherwise:
```powershell
npm install -g @mermaid-js/mermaid-cli
```

**Image not found**: Ensure image paths in the markdown are correct and images exist at those paths.
