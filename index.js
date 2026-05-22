#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { extname, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extractorScript = join(__dirname, "extract_courseware.py");

const bundledPython =
  "C:\\Users\\沈云浩\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";

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
  return ext === ".pdf" ? bundledPython : "python";
}

function runExtractor(args) {
  return new Promise((resolve, reject) => {
    const python = choosePython(args.file_path);
    const py = spawn(python, [
      extractorScript,
      "--file",
      args.file_path,
      "--max-chars",
      String(args.max_chars ?? 60000),
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
  return [
    `Use the extracted courseware to help the student ${goal}.`,
    "",
    "Produce a concise but high-value study pack in Chinese unless the courseware is clearly in another language.",
    "",
    "Required sections:",
    "1. Course overview: one paragraph.",
    "2. Chapter/slide structure: identify the main modules.",
    "3. Key points: definitions, formulas, methods, and conclusions.",
    "4. Difficult points and common mistakes.",
    "5. Exam-oriented priority ranking: high/medium/low with reasons.",
    "6. Mermaid mind map using `mindmap` syntax.",
    "7. Review advice: a practical plan for short-term exam prep.",
    `8. ${questionCount} simulated questions: mix choice, fill-in, short answer, calculation/application when suitable.`,
    "9. Answer key and explanations. Include source page/slide references whenever possible.",
    "",
    "Do not merely summarize in order. Reorganize the material from an exam-preparation perspective.",
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
        serverInfo: { name: "courseware-mcp", version: "0.1.0" },
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
