# Markdown to DOCX Converter

A Python script that converts markdown files to properly formatted DOCX documents with support for mermaid diagrams.

## Features

- **Standard Markdown Elements**:
  - Headings (H1-H6)
  - Paragraphs with inline formatting (bold, italic, code)
  - Links
  - Images
  - Code blocks with syntax highlighting support
  - Bulleted lists
  - Numbered lists
  - Horizontal rules

- **Mermaid Diagrams**: Automatically converts mermaid code blocks to PNG images and embeds them in the document

## Installation

1. Install Python dependencies:
```bash
pip install -r requirements_md_converter.txt
```

2. (Optional) For mermaid diagram support, install mermaid-cli:
```bash
npm install -g @mermaid-js/mermaid-cli
```

## Usage

Basic usage:
```bash
python md_to_docx.py input.md
```

Specify output file:
```bash
python md_to_docx.py input.md output.docx
```

## Example

Create a test markdown file:

```markdown
# My Document

This is a **bold** statement with *italic* text and `inline code`.

## Features

- Bullet point 1
- Bullet point 2

### Code Example

\`\`\`python
def hello():
    print("Hello, World!")
\`\`\`

### Mermaid Diagram

\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
\`\`\`

[Link to Google](https://google.com)
```

Then convert it:
```bash
python md_to_docx.py example.md
```

## How It Works

1. **Markdown Parsing**: Reads the markdown file and processes it line-by-line
2. **Mermaid Detection**: Identifies mermaid code blocks using regex
3. **Mermaid Rendering**: Converts mermaid diagrams to PNG using mermaid-cli (mmdc)
4. **DOCX Generation**: Uses python-docx to create formatted Word document
5. **Cleanup**: Removes temporary image files

## Notes

- If mermaid-cli is not installed, the script will warn you but continue processing other content
- Images are embedded at 5 inches width by default
- Relative image paths are resolved relative to the input markdown file
- Temporary files are automatically cleaned up after conversion
