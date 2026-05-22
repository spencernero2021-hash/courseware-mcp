# courseware-mcp

Local MCP server for extracting courseware from PDF and PPTX files into structured text that DeepSeek can use for summaries, mind maps, review plans, and simulated exam questions.

## Tools

- `extract_courseware`: Extracts `.pdf`, `.pptx`, or `.ppt` into Markdown and structured JSON.
- `make_study_pack_prompt`: Produces a reusable single-pass prompt for turning extracted material into an exam-oriented study pack.
- `make_layered_study_prompts`: Produces four separate prompts for learning extraction, mind maps, review advice, and simulated questions.

## PPTX Strategy

PPTX extraction uses a dual-engine design:

1. `python-pptx` when available, for normal slide text and tables.
2. OOXML ZIP parsing as a fallback/merge path for slide order, text nodes, notes, charts, and image alt text.

This avoids relying on the model to improvise `.pptx` ZIP parsing every time.

## PDF Strategy

PDF extraction uses `pypdf` when available in the configured Python runtime. If a PDF has little extractable text, it is probably scanned; the MCP can render pages locally with Windows `Windows.Data.Pdf` and run Windows OCR on the rendered page images.

Useful `extract_courseware` PDF options:

- `ocr_scanned_pdf`: defaults to `true`.
- `ocr_language`: `auto`, `en-US`, or `zh-Hans-CN`.
- `max_ocr_pages`: defaults to `80`; set `0` for no explicit limit.

## Claude Code config

Add this to `.mcp.json`, replacing paths as needed:

```json
{
  "mcpServers": {
    "courseware": {
      "command": "node",
      "args": ["D:\\Codex\\New\\courseware-mcp\\index.js"],
      "env": {
        "COURSEWARE_PYTHON": "C:\\PYTHON\\python.exe",
        "COURSEWARE_PDF_PYTHON": "C:\\Users\\YourName\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe"
      }
    }
  }
}
```

## Recommended DeepSeek Workflow

1. Call `extract_courseware` on the PDF/PPTX.
   - For scanned Chinese PDFs, pass `ocr_language: "zh-Hans-CN"`.
   - For scanned English PDFs, pass `ocr_language: "en-US"`.
2. For short courseware, call `make_study_pack_prompt` and generate the whole study pack in one pass.
3. For long courseware, call `make_layered_study_prompts` and generate these layers separately:
   - learning extraction
   - Mermaid mind map
   - review advice
   - simulated questions
4. Use the extracted Markdown plus the selected prompt to generate:
   - key points
   - difficult and error-prone points
   - Mermaid mind map
   - review advice
   - simulated questions with answers and explanations

## Study Assistant Layers

The layered workflow is designed to make DeepSeek act less like a generic summarizer and more like an exam assistant:

1. Learning extraction layer: reorganizes the courseware into concepts, formulas, methods, examples, prerequisites, high-frequency points, and common mistakes.
2. Mind map layer: converts the extracted knowledge into a compact Mermaid `mindmap` organized by exam logic.
3. Review advice layer: produces review order, daily or staged plan, memorization checklist, practice checklist, final-day sprint, and self-test method.
4. Simulated questions layer: creates exam-style questions with type, difficulty, tested point, source page/slide, answer, explanation, and common mistake reminder.
