import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

const requiredEnv = [
  "CHROME_WEB_STORE_CLIENT_ID",
  "CHROME_WEB_STORE_CLIENT_SECRET",
  "CHROME_WEB_STORE_REFRESH_TOKEN",
  "CHROME_WEB_STORE_PUBLISHER_ID",
  "CHROME_WEB_STORE_EXTENSION_ID",
];

const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnv.join(", ")}`);
}

const [zipPath] = process.argv.slice(2);

if (!zipPath) {
  throw new Error("Usage: node scripts/publish-chrome-web-store.mjs <extension-zip-path>");
}

const zipStat = await stat(zipPath);

if (!zipStat.isFile()) {
  throw new Error(`Expected a zip file path, but found something else: ${zipPath}`);
}

const publisherId = encodeURIComponent(process.env.CHROME_WEB_STORE_PUBLISHER_ID);
const extensionId = encodeURIComponent(process.env.CHROME_WEB_STORE_EXTENSION_ID);
const itemName = `publishers/${publisherId}/items/${extensionId}`;
const accessToken = await getAccessToken();
const successfulUploadStates = new Set(["SUCCESS", "SUCCEEDED"]);
const inProgressUploadStates = new Set(["UPLOAD_IN_PROGRESS", "IN_PROGRESS"]);

console.log(`Uploading ${basename(zipPath)} to Chrome Web Store item ${process.env.CHROME_WEB_STORE_EXTENSION_ID}.`);

const uploadResult = await chromeWebStoreRequest(
  `https://chromewebstore.googleapis.com/upload/v2/${itemName}:upload`,
  {
    body: await readFile(zipPath),
    headers: {
      "Content-Type": "application/zip",
    },
    method: "POST",
  },
);

await waitForUpload(uploadResult);

console.log("Submitting uploaded package for Chrome Web Store review.");

await chromeWebStoreRequest(`https://chromewebstore.googleapis.com/v2/${itemName}:publish`, {
  method: "POST",
});

console.log("Chrome Web Store publish request submitted.");

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.CHROME_WEB_STORE_CLIENT_ID,
    client_secret: process.env.CHROME_WEB_STORE_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: process.env.CHROME_WEB_STORE_REFRESH_TOKEN,
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    body,
    method: "POST",
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok || !json.access_token) {
    throw new Error(`Failed to refresh Chrome Web Store access token: ${formatApiError(response, json)}`);
  }

  return json.access_token;
}

async function chromeWebStoreRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  const body = text ? parseJsonResponse(text) : {};

  if (!response.ok) {
    throw new Error(`Chrome Web Store API request failed: ${formatApiError(response, body)}`);
  }

  return body;
}

async function waitForUpload(uploadResult) {
  const uploadState = getUploadState(uploadResult);

  if (successfulUploadStates.has(uploadState)) {
    return;
  }

  if (!inProgressUploadStates.has(uploadState)) {
    throw new Error(`Chrome Web Store upload did not finish successfully: ${JSON.stringify(uploadResult)}`);
  }

  console.log("Chrome Web Store upload is still processing. Polling status.");

  for (let attempt = 1; attempt <= 24; attempt += 1) {
    await sleep(5000);

    const status = await chromeWebStoreRequest(`https://chromewebstore.googleapis.com/v2/${itemName}:fetchStatus`, {
      method: "GET",
    });
    const statusUploadState = getUploadState(status);

    if (successfulUploadStates.has(statusUploadState)) {
      return;
    }

    if (!inProgressUploadStates.has(statusUploadState)) {
      throw new Error(`Chrome Web Store upload did not finish successfully: ${JSON.stringify(status)}`);
    }

    console.log(`Upload still processing (${attempt}/24).`);
  }

  throw new Error("Chrome Web Store upload did not finish within two minutes.");
}

function getUploadState(result) {
  return result?.uploadState ?? result?.lastAsyncUploadState;
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { response: text };
  }
}

function formatApiError(response, body) {
  return JSON.stringify(
    {
      status: response.status,
      statusText: response.statusText,
      body,
    },
    null,
    2,
  );
}
