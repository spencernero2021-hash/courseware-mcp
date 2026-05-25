#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { extname, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extractorScript = join(__dirname, "extract_courseware.py");
const artifactScript = join(__dirname, "create_artifacts.py");
const runtimePython = join(
  process.env.USERPROFILE || "",
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "python",
  "python.exe",
);

const tools = [
  {
    name: "extract_courseware",
    description:
      "Extract PDF or PPTX courseware into structured text for summarization, mind maps, study plans, and practice questions.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to a .pdf, .pptx, or .ppt file.",
        },
        max_chars: {
          type: "integer",
          description: "Maximum Markdown characters to return. Defaults to 60000.",
          default: 60000,
        },
        include_json: {
          type: "boolean",
          description: "Include structured JSON in addition to Markdown.",
          default: false,
        },
        ocr_scanned_pdf: {
          type: "boolean",
          description: "For PDFs with little extractable text, render pages and OCR them locally.",
          default: true,
        },
        ocr_language: {
          type: "string",
          description: "OCR language tag for scanned PDFs, for example auto, en-US, zh-Hans-CN.",
          default: "auto",
        },
        max_ocr_pages: {
          type: "integer",
          description: "Maximum scanned PDF pages to OCR. 0 means no explicit limit. Defaults to 80.",
          default: 80,
        },
      },
      required: ["file_path"],
      additionalProperties: false,
    },
  },
  {
    name: "diagnose_courseware_intake",
    description:
      "Run a courseware intake diagnosis before summarization. Reports per-page/per-slide text coverage, OCR use, unread units, likely scanned/image-only content, warnings, and recommended next steps.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to a .pdf, .pptx, or .ppt file.",
        },
        ocr_scanned_pdf: {
          type: "boolean",
          description: "For PDFs with little extractable text, render pages and OCR them locally.",
          default: true,
        },
        ocr_language: {
          type: "string",
          description: "OCR language tag for scanned PDFs, for example auto, en-US, zh-Hans-CN.",
          default: "auto",
        },
        max_ocr_pages: {
          type: "integer",
          description: "Maximum scanned PDF pages to OCR. 0 means no explicit limit. Defaults to 80.",
          default: 80,
        },
        include_units: {
          type: "boolean",
          description: "Include detailed per-page/per-slide structured unit diagnostics.",
          default: true,
        },
      },
      required: ["file_path"],
      additionalProperties: false,
    },
  },
  {
    name: "make_study_pack_prompt",
    description:
      "Create a focused DeepSeek prompt for turning extracted courseware into key points, a Mermaid mind map, review advice, and exam-style questions.",
    inputSchema: {
      type: "object",
      properties: {
        exam_goal: {
          type: "string",
          description: "Exam goal, course name, or study scenario.",
          default: "prepare for an exam",
        },
        question_count: {
          type: "integer",
          description: "Number of practice questions to request.",
          default: 20,
        },
        student_level: {
          type: "string",
          description: "Student level, for example beginner, normal, advanced, or sprint review.",
          default: "normal",
        },
        days_available: {
          type: "integer",
          description: "Number of days available for review. If omitted, produce general advice.",
        },
        output_language: {
          type: "string",
          description: "Output language. Defaults to Chinese.",
          default: "Chinese",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "make_exam_pack_prompt",
    description:
      "Create a product-style DeepSeek prompt for turning diagnosed and extracted courseware into a complete exam review pack: intake report, Word-ready notes, mind map, review plan, and mock questions.",
    inputSchema: {
      type: "object",
      properties: {
        exam_goal: {
          type: "string",
          description: "Exam goal, course name, or study scenario.",
          default: "prepare for an exam",
        },
        student_level: {
          type: "string",
          description: "Student level, for example beginner, normal, advanced, or sprint review.",
          default: "normal",
        },
        days_available: {
          type: "integer",
          description: "Number of days available for review. If omitted, produce flexible plans.",
        },
        question_count: {
          type: "integer",
          description: "Number of mock exam questions to include.",
          default: 25,
        },
        output_language: {
          type: "string",
          description: "Output language. Defaults to Chinese.",
          default: "Chinese",
        },
        include_word_notes: {
          type: "boolean",
          description: "Whether the final pack should include Word-ready structured notes.",
          default: true,
        },
        include_mind_map: {
          type: "boolean",
          description: "Whether the final pack should include a Mermaid mind map.",
          default: true,
        },
        include_mock_questions: {
          type: "boolean",
          description: "Whether the final pack should include mock exam questions.",
          default: true,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "make_layered_study_prompts",
    description:
      "Create four separate DeepSeek prompts for learning extraction, Mermaid mind map generation, review planning, and simulated exam questions.",
    inputSchema: {
      type: "object",
      properties: {
        exam_goal: {
          type: "string",
          description: "Exam goal, course name, or study scenario.",
          default: "prepare for an exam",
        },
        question_count: {
          type: "integer",
          description: "Number of practice questions to request.",
          default: 20,
        },
        student_level: {
          type: "string",
          description: "Student level, for example beginner, normal, advanced, or sprint review.",
          default: "normal",
        },
        days_available: {
          type: "integer",
          description: "Number of days available for review. If omitted, produce general advice.",
        },
        output_language: {
          type: "string",
          description: "Output language. Defaults to Chinese.",
          default: "Chinese",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "make_word_summary_prompt",
    description:
      "Create a DeepSeek prompt for producing logically structured Markdown that is ready to be converted into a Word study document.",
    inputSchema: {
      type: "object",
      properties: {
        exam_goal: {
          type: "string",
          description: "Exam goal, course name, or study scenario.",
          default: "prepare for an exam",
        },
        output_language: {
          type: "string",
          description: "Output language. Defaults to Chinese.",
          default: "Chinese",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_study_docx",
    description:
      "Create a clean Word .docx study document from structured Markdown generated by DeepSeek.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Document title.",
          default: "Courseware Study Notes",
        },
        subtitle: {
          type: "string",
          description: "Optional subtitle.",
        },
        content_markdown: {
          type: "string",
          description: "Structured Markdown content to write into the Word document.",
        },
        mindmap_mermaid: {
          type: "string",
          description: "Optional Mermaid mindmap source to append as a source appendix.",
        },
        output_path: {
          type: "string",
          description: "Optional output .docx path. Defaults to ./courseware-output/<title>.docx.",
        },
      },
      required: ["content_markdown"],
      additionalProperties: false,
    },
  },
  {
    name: "create_mind_map_file",
    description:
      "Save a Mermaid mind map as a Markdown .md file or raw .mmd file.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Mind map title.",
          default: "Courseware Mind Map",
        },
        mermaid_mindmap: {
          type: "string",
          description: "Mermaid mindmap source. Can include or omit Markdown code fences.",
        },
        output_path: {
          type: "string",
          description: "Optional output file path. Defaults to ./courseware-output/<title>.md.",
        },
        format: {
          type: "string",
          enum: ["md", "mmd"],
          description: "Output format: md wraps Mermaid in Markdown, mmd writes raw Mermaid.",
          default: "md",
        },
      },
      required: ["mermaid_mindmap"],
      additionalProperties: false,
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function choosePython(filePath) {
  const ext = extname(filePath || "").toLowerCase();
  if (ext === ".pdf" && process.env.COURSEWARE_PDF_PYTHON) {
    return process.env.COURSEWARE_PDF_PYTHON;
  }
  if ((ext === ".pptx" || ext === ".ppt") && process.env.COURSEWARE_PPTX_PYTHON) {
    return process.env.COURSEWARE_PPTX_PYTHON;
  }
  if (process.env.COURSEWARE_PYTHON) {
    return process.env.COURSEWARE_PYTHON;
  }
  return ext === ".pdf" ? runtimePython : "python";
}

function runExtractor(args) {
  return new Promise((resolve, reject) => {
    const python = choosePython(args.file_path);
    const extractorArgs = [
      extractorScript,
      "--file",
      args.file_path,
      "--max-chars",
      String(args.max_chars ?? 60000),
      "--ocr-language",
      args.ocr_language || "auto",
      "--max-ocr-pages",
      String(args.max_ocr_pages ?? 80),
    ];

    if (args.ocr_scanned_pdf !== false) {
      extractorArgs.push("--ocr-scanned-pdf");
    }

    const py = spawn(python, extractorArgs, {
      windowsHide: true,
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    });

    let stdout = "";
    let stderr = "";
    py.stdout.setEncoding("utf8");
    py.stderr.setEncoding("utf8");
    py.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    py.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    py.on("error", reject);
    py.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Extractor exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Could not parse extractor output: ${error.message}\n${stdout}`));
      }
    });
  });
}

function runArtifact(mode, args) {
  return new Promise((resolve, reject) => {
    const python = process.env.COURSEWARE_DOCX_PYTHON || process.env.COURSEWARE_PDF_PYTHON || runtimePython;
    const py = spawn(python, [
      artifactScript,
      "--mode",
      mode,
    ], {
      windowsHide: true,
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    });

    let stdout = "";
    let stderr = "";
    py.stdout.setEncoding("utf8");
    py.stderr.setEncoding("utf8");
    py.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    py.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    py.on("error", reject);
    py.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Artifact creator exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Could not parse artifact output: ${error.message}\n${stdout}`));
      }
    });
    py.stdin.end(JSON.stringify(args));
  });
}

function makeStudyPackPrompt(args = {}) {
  const goal = args.exam_goal || "prepare for an exam";
  const questionCount = args.question_count ?? 20;
  const language = args.output_language || "Chinese";
  const level = args.student_level || "normal";
  const days = args.days_available
    ? `The student has ${args.days_available} day(s) available for review.`
    : "If no exam date is known, give a flexible short-term review plan.";
  return [
    `Use the extracted courseware to help the student ${goal}.`,
    `Student level: ${level}. ${days}`,
    "",
    `Produce a concise but high-value study pack in ${language} unless the courseware strongly requires another language.`,
    "",
    "Required sections:",
    "1. Learning extraction layer: identify modules, concepts, formulas, methods, examples, and prerequisite knowledge.",
    "2. Exam focus layer: rank knowledge points as high/medium/low priority with reasons and source page/slide references.",
    "3. Difficult and error-prone layer: list confusing ideas, common mistakes, and how to avoid them.",
    "4. Mind map layer: output a Mermaid `mindmap` that is compact enough to review before an exam.",
    "5. Review advice layer: produce a practical schedule, review order, memorization targets, exercise targets, and final-day checklist.",
    `6. Simulated question layer: create ${questionCount} exam-style questions with difficulty, tested knowledge point, answer, explanation, and source reference.`,
    "",
    "Question mix guidance:",
    "- Include choice/fill-in/judgment/short-answer/application or calculation questions as appropriate for the subject.",
    "- Include at least 20% common-mistake questions.",
    "- Mark each question as easy, medium, or hard.",
    "",
    "Quality rules:",
    "- Do not merely summarize in order. Reorganize the material from an exam-preparation perspective.",
    "- If the courseware is incomplete or OCR text is noisy, state uncertainty and avoid inventing unsupported facts.",
    "- Include page/slide references whenever possible.",
  ].join("\n");
}

function makeExamPackPrompt(args = {}) {
  const goal = args.exam_goal || "prepare for an exam";
  const language = args.output_language || "Chinese";
  const level = args.student_level || "normal";
  const questionCount = args.question_count ?? 25;
  const days = args.days_available
    ? `The student has ${args.days_available} day(s) available for review.`
    : "No fixed exam date is provided; include both sprint and normal review options.";
  const includeWord = args.include_word_notes !== false;
  const includeMindMap = args.include_mind_map !== false;
  const includeQuestions = args.include_mock_questions !== false;

  const artifacts = [
    includeWord ? "- Word-ready structured Markdown notes suitable for `courseware.create_study_docx`." : "",
    includeMindMap ? "- Mermaid `mindmap` source suitable for `courseware.create_mind_map_file`." : "",
    includeQuestions ? `- ${questionCount} mock exam questions with answers and explanations.` : "",
  ].filter(Boolean).join("\n");

  return [
    "# Exam Pack Prompt",
    "",
    "You are helping create a complete exam review pack from courseware.",
    `Goal: ${goal}.`,
    `Student level: ${level}. ${days}`,
    `Output language: ${language}.`,
    "",
    "Inputs you should use:",
    "1. The `intake_report` from `courseware.diagnose_courseware_intake` or `courseware.extract_courseware`.",
    "2. The extracted courseware Markdown from `courseware.extract_courseware`.",
    "3. Any user-specific exam requirements.",
    "",
    "Critical reliability rules:",
    "- Start by reading the intake report.",
    "- If intake status is `poor` or `failed`, do not produce a confident full study pack. Explain what was unreadable and ask for OCR/visual recovery first.",
    "- If intake status is `partial`, produce the pack but clearly mark low-text, empty, uncertain, or OCR-dependent pages/slides.",
    "- Never invent material for unread pages/slides.",
    "- Preserve page/slide references whenever possible.",
    "",
    "Required Exam Pack structure:",
    "## 1. Intake Summary",
    "- Status, coverage, OCR usage, unread/low-text units, and what that means for trustworthiness.",
    "## 2. Course Knowledge Map",
    "- Reorganize the courseware into modules, subtopics, prerequisites, and dependency relationships.",
    "## 3. High-Frequency Exam Points",
    "- Rank each point as high/medium/low priority with reasons and source references.",
    "## 4. Core Notes",
    "- Definitions, concepts, formulas, procedures, examples, comparisons, and common traps.",
    "## 5. Difficult Points And Common Mistakes",
    "- Explain why each point is difficult, how it appears in exams, and how to avoid mistakes.",
    "## 6. Review Plan",
    "- Review order, memorization targets, practice targets, final-day checklist, and short-time fallback plan.",
    includeMindMap ? "## 7. Mermaid Mind Map\n- Output one compact Mermaid `mindmap` code block organized by exam logic, not slide order." : "",
    includeQuestions ? `## 8. Mock Exam Questions\n- Create ${questionCount} questions with type, difficulty, tested point, source reference, answer, explanation, and common mistake reminder.` : "",
    includeWord ? "## 9. Word Document Markdown\n- Provide a clean Markdown version of the final notes that can be passed to `courseware.create_study_docx`." : "",
    "",
    "Artifact targets:",
    artifacts || "- No file artifacts requested; produce the pack in Markdown.",
    "",
    "Question mix guidance:",
    "- Use choice, judgment, fill-in, short answer, calculation/application, or comprehensive questions as appropriate for the subject.",
    "- Include at least 20% common-mistake questions if mock questions are requested.",
    "- Mark each question as easy, medium, or hard.",
    "",
    "Style rules:",
    "- Be structured, concise, and exam-oriented.",
    "- Do not merely summarize slides in order.",
    "- Prefer tables for comparisons and prioritized lists for exam points.",
    "- When uncertain because of OCR or missing text, say exactly which page/slide caused the uncertainty.",
  ].filter(Boolean).join("\n");
}

function makeLayeredStudyPrompts(args = {}) {
  const goal = args.exam_goal || "prepare for an exam";
  const questionCount = args.question_count ?? 20;
  const language = args.output_language || "Chinese";
  const level = args.student_level || "normal";
  const daysLine = args.days_available
    ? `The student has ${args.days_available} day(s) before the exam.`
    : "No fixed review duration is provided.";

  const shared = [
    `Goal: help the student ${goal}.`,
    `Student level: ${level}. ${daysLine}`,
    `Output language: ${language}.`,
    "Use source page/slide references whenever possible.",
    "If OCR or extraction looks noisy, mention uncertainty instead of inventing details.",
  ].join("\n");

  const prompts = {
    learning_extraction: [
      shared,
      "",
      "Task: Build the learning extraction layer from the extracted courseware.",
      "Output:",
      "1. Course/module outline.",
      "2. Core concepts and definitions.",
      "3. Formulas, rules, methods, and procedures.",
      "4. Examples or case patterns from the material.",
      "5. Prerequisite knowledge the student should review first.",
      "6. High-frequency exam points, with high/medium/low priority and reasons.",
      "7. Difficult points, confusing pairs, and common mistakes.",
    ].join("\n"),
    mind_map: [
      shared,
      "",
      "Task: Create a Mermaid mind map from the extracted courseware and the learning extraction layer.",
      "Output only:",
      "1. A Mermaid code block using `mindmap` syntax.",
      "2. A short legend explaining high-priority and error-prone nodes.",
      "",
      "Rules:",
      "- Keep node names short.",
      "- Use no more than 4 hierarchy levels unless the course is very complex.",
      "- Organize by exam logic, not by slide order.",
    ].join("\n"),
    review_advice: [
      shared,
      "",
      "Task: Create the review advice layer.",
      "Output:",
      "1. Review order and why.",
      "2. Daily plan or flexible staged plan.",
      "3. Memorization checklist.",
      "4. Practice checklist.",
      "5. Final 24-hour sprint plan.",
      "6. What to skip or de-prioritize if time is short.",
      "7. Self-test method for checking mastery.",
    ].join("\n"),
    practice_questions: [
      shared,
      "",
      `Task: Create ${questionCount} simulated exam questions from the extracted courseware.`,
      "For each question include:",
      "- Type: choice, fill-in, judgment, short answer, application, calculation, or comprehensive.",
      "- Difficulty: easy, medium, or hard.",
      "- Tested knowledge point.",
      "- Source page/slide reference.",
      "- Question.",
      "- Answer.",
      "- Explanation.",
      "- Common mistake reminder.",
      "",
      "Question mix rules:",
      "- Cover all high-priority points.",
      "- Include at least 20% common-mistake questions.",
      "- Avoid questions that require facts not present in the courseware unless clearly marked as extension.",
    ].join("\n"),
  };

  return [
    "# Layered Study Prompts",
    "",
    "Use these prompts after `extract_courseware`. Run them separately when the courseware is long, or use the full study pack prompt for a single-pass result.",
    "",
    "## 1. Learning Extraction Layer",
    prompts.learning_extraction,
    "",
    "## 2. Mind Map Layer",
    prompts.mind_map,
    "",
    "## 3. Review Advice Layer",
    prompts.review_advice,
    "",
    "## 4. Simulated Questions Layer",
    prompts.practice_questions,
  ].join("\n");
}

function makeWordSummaryPrompt(args = {}) {
  const goal = args.exam_goal || "prepare for an exam";
  const language = args.output_language || "Chinese";
  return [
    `Use the extracted courseware to create Word-ready study notes that help the student ${goal}.`,
    `Write in ${language} unless the courseware strongly requires another language.`,
    "",
    "Output Markdown only. Make it suitable for `courseware.create_study_docx`.",
    "",
    "Required structure:",
    "# Title",
    "## 1. Course Overview",
    "One concise paragraph explaining the scope and learning goal.",
    "## 2. Knowledge Structure",
    "Organize the material into modules and subtopics.",
    "## 3. Key Points",
    "Use bullets. Include definitions, formulas, procedures, and conclusions.",
    "## 4. Difficult Points And Common Mistakes",
    "Explain why each point is difficult and how to avoid the mistake.",
    "## 5. Exam Focus",
    "Rank high/medium/low priority points and include page/slide references when possible.",
    "## 6. Review Suggestions",
    "Give actionable review order, practice method, and final-day checklist.",
    "## 7. Practice Questions",
    "Include representative questions with answers and short explanations.",
    "",
    "Rules:",
    "- Be clear, hierarchical, and concise.",
    "- Do not dump slide text in order. Reorganize by learning logic.",
    "- Preserve source page/slide references where possible.",
    "- If extraction or OCR is noisy, mark uncertain content instead of inventing facts.",
  ].join("\n");
}

function summarizeIntakeReport(report, includeUnits = true) {
  const lines = [
    "# Courseware Intake Report",
    "",
    `- File: ${report.file}`,
    `- Type: ${report.type}`,
    `- Status: ${report.status}`,
    `- Units: ${report.total_units}`,
    `- Total text characters: ${report.total_text_chars}`,
    `- Average text characters per unit: ${report.average_text_chars}`,
    `- Good coverage: ${report.coverage_percent}%`,
    `- Low/empty units: ${(report.low_text_units || []).length ? report.low_text_units.join(", ") : "none"}`,
  ];
  if (report.ocr_used_units?.length) {
    lines.push(`- OCR used units: ${report.ocr_used_units.join(", ")}`);
  }
  if (report.possibly_image_only_units?.length) {
    lines.push(`- Possibly image-only units: ${report.possibly_image_only_units.join(", ")}`);
  }
  if (report.warnings?.length) {
    lines.push("", "## Warnings", ...report.warnings.map((warning) => `- ${warning}`));
  }
  if (report.recommendations?.length) {
    lines.push("", "## Recommendations", ...report.recommendations.map((item) => `- ${item}`));
  }
  if (includeUnits && report.units?.length) {
    lines.push("", "## Unit Details");
    for (const unit of report.units) {
      const label = unit.kind === "slide" ? "Slide" : "Page";
      const title = unit.title ? ` - ${unit.title}` : "";
      const flags = unit.flags?.length ? unit.flags.join(", ") : "none";
      lines.push(`- ${label} ${unit.index}${title}: ${unit.text_chars} chars, coverage=${unit.coverage}, flags=${flags}`);
    }
  }
  return lines.join("\n");
}

async function handle(request) {
  const { id, method, params } = request;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "courseware-mcp", version: "0.4.0" },
      },
    };
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools } };
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};

    if (name === "make_study_pack_prompt") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: makeStudyPackPrompt(args) }],
        },
      };
    }

    if (name === "make_exam_pack_prompt") {
      const prompt = makeExamPackPrompt(args);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: prompt }],
          structuredContent: { prompt },
        },
      };
    }

    if (name === "make_layered_study_prompts") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: makeLayeredStudyPrompts(args) }],
        },
      };
    }

    if (name === "make_word_summary_prompt") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: makeWordSummaryPrompt(args) }],
        },
      };
    }

    if (name === "create_study_docx") {
      const artifact = await runArtifact("docx", args);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Created Word document: ${artifact.path}` }],
          structuredContent: artifact,
        },
      };
    }

    if (name === "create_mind_map_file") {
      const artifact = await runArtifact("mindmap", args);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Created mind map file: ${artifact.path}` }],
          structuredContent: artifact,
        },
      };
    }

    if (name === "diagnose_courseware_intake") {
      const extracted = await runExtractor({
        ...args,
        max_chars: 2000,
      });
      const report = extracted.intake_report;
      if (!args.include_units && report?.units) {
        report.units = [];
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: summarizeIntakeReport(report, args.include_units !== false) }],
          structuredContent: report,
        },
      };
    }

    if (name !== "extract_courseware") {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `Unknown tool: ${name}` },
      };
    }

    const extracted = await runExtractor(args);
    const text = args.include_json
      ? `${extracted.markdown}\n\nStructured JSON:\n${JSON.stringify(extracted, null, 2)}`
      : extracted.markdown;

    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text }],
        structuredContent: extracted,
      },
    };
  }

  if (id === undefined) {
    return null;
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

const rl = createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: `Parse error: ${error.message}` },
    });
    return;
  }

  try {
    const response = await handle(request);
    if (response) send(response);
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: { code: -32000, message: error.message },
    });
  }
});
