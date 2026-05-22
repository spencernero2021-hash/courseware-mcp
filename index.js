#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { extname, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extractorScript = join(__dirname, "extract_courseware.py");
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

async function handle(request) {
  const { id, method, params } = request;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "courseware-mcp", version: "0.3.0" },
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

    if (name === "make_layered_study_prompts") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: makeLayeredStudyPrompts(args) }],
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
