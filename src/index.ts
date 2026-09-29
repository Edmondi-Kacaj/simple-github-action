/**
 * Minimal Gofile upload Action for the blog tutorial.
 * - Resolve path / glob
 * - Upload first matched file as guest (or with token)
 * - Set download-page output
 */
import * as core from "@actions/core";
import * as glob from "@actions/glob";
import * as fs from "node:fs";
import * as path from "node:path";

const UPLOAD_URL = "https://upload.gofile.io/contents/uploadfile";

interface GofileUploadData {
  downloadPage?: string;
  fileId?: string;
  id?: string;
  parentFolder?: string;
}

interface GofileEnvelope {
  status?: string;
  data?: GofileUploadData;
}

async function resolveFirstFile(pattern: string): Promise<string> {
  const globber = await glob.create(pattern, {
    matchDirectories: false,
  });
  const matches = await globber.glob();
  const files = matches.filter(
    (p) => fs.existsSync(p) && fs.statSync(p).isFile(),
  );

  if (files.length === 0) {
    throw new Error(`No files matched path: ${pattern}`);
  }

  if (files.length > 1) {
    core.info(
      `Matched ${files.length} files; uploading the first one: ${files[0]}`,
    );
  }

  return files[0]!;
}

async function uploadToGofile(
  filePath: string,
  token?: string,
): Promise<{ downloadPage: string; fileId: string }> {
  const fileName = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);

  core.info(`Uploading ${fileName} (${buffer.length} bytes) to Gofile…`);

  const form = new FormData();
  form.append("file", new Blob([buffer]), fileName);

  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    headers,
    body: form,
  });

  const raw: unknown = await response.json().catch(() => ({}));
  const body =
    raw !== null && typeof raw === "object"
      ? (raw as GofileEnvelope)
      : ({} as GofileEnvelope);

  if (!response.ok || body.status !== "ok" || !body.data) {
    throw new Error(
      `Gofile upload failed: HTTP ${response.status}, status=${body.status ?? "unknown"}`,
    );
  }

  const downloadPage = body.data.downloadPage ?? "";
  const fileId = body.data.fileId ?? body.data.id ?? "";

  if (!downloadPage) {
    throw new Error("Gofile response did not include downloadPage");
  }

  return { downloadPage, fileId };
}

async function run(): Promise<void> {
  try {
    const pathInput = core.getInput("path", { required: true });
    const token =
      core.getInput("token") || process.env.GOFILE_TOKEN || undefined;

    core.info(`path=${pathInput}`);
    core.info(`token=${token ? "(provided)" : "(guest upload)"}`);

    const filePath = await resolveFirstFile(pathInput);
    core.info(`Resolved file: ${filePath}`);

    const result = await uploadToGofile(filePath, token);

    core.setOutput("download-page", result.downloadPage);
    core.setOutput("file-id", result.fileId);

    core.info(`Share link: ${result.downloadPage}`);

    await core.summary
      .addHeading("Gofile upload")
      .addLink("Download page", result.downloadPage)
      .write();
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();