var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// analyzeResume-background.mjs
var analyzeResume_background_exports = {};
__export(analyzeResume_background_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(analyzeResume_background_exports);
var import_fs = require("fs");
var import_path = require("path");

// ../../../node_modules/@netlify/runtime-utils/dist/main.js
var getString = (input) => typeof input === "string" ? input : JSON.stringify(input);
var base64Decode = globalThis.Buffer ? (input) => Buffer.from(input, "base64").toString() : (input) => atob(input);
var base64Encode = globalThis.Buffer ? (input) => Buffer.from(getString(input)).toString("base64") : (input) => btoa(getString(input));
var getEnvironment = () => {
  const { Deno, Netlify, process: process2 } = globalThis;
  return Netlify?.env ?? Deno?.env ?? {
    delete: (key) => delete process2?.env[key],
    get: (key) => process2?.env[key],
    has: (key) => Boolean(process2?.env[key]),
    set: (key, value) => {
      if (process2?.env) {
        process2.env[key] = value;
      }
    },
    toObject: () => process2?.env ?? {}
  };
};

// ../../../node_modules/@netlify/otel/dist/main.js
var GET_TRACER = "__netlify__getTracer";
var getTracer = (name, version) => {
  return globalThis[GET_TRACER]?.(name, version);
};
function withActiveSpan(tracer, name, optionsOrFn, contextOrFn, fn) {
  const func = typeof contextOrFn === "function" ? contextOrFn : typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!func) {
    throw new Error("function to execute with active span is missing");
  }
  if (!tracer) {
    return func();
  }
  return tracer.withActiveSpan(name, optionsOrFn, contextOrFn, func);
}

// ../../../node_modules/@netlify/blobs/dist/chunk-YAGWSQMB.js
var getEnvironmentContext = () => {
  const context = globalThis.netlifyBlobsContext || getEnvironment().get("NETLIFY_BLOBS_CONTEXT");
  if (typeof context !== "string" || !context) {
    return {};
  }
  const data = base64Decode(context);
  try {
    return JSON.parse(data);
  } catch {
  }
  return {};
};
var MissingBlobsEnvironmentError = class extends Error {
  constructor(requiredProperties) {
    super(
      `The environment has not been configured to use Netlify Blobs. To use it manually, supply the following properties when creating a store: ${requiredProperties.join(
        ", "
      )}`
    );
    this.name = "MissingBlobsEnvironmentError";
  }
};
var BASE64_PREFIX = "b64;";
var METADATA_HEADER_INTERNAL = "x-amz-meta-user";
var METADATA_HEADER_EXTERNAL = "netlify-blobs-metadata";
var METADATA_MAX_SIZE = 2 * 1024;
var encodeMetadata = (metadata) => {
  if (!metadata) {
    return null;
  }
  const encodedObject = base64Encode(JSON.stringify(metadata));
  const payload = `b64;${encodedObject}`;
  if (METADATA_HEADER_EXTERNAL.length + payload.length > METADATA_MAX_SIZE) {
    throw new Error("Metadata object exceeds the maximum size");
  }
  return payload;
};
var decodeMetadata = (header) => {
  if (!header?.startsWith(BASE64_PREFIX)) {
    return {};
  }
  const encodedData = header.slice(BASE64_PREFIX.length);
  const decodedData = base64Decode(encodedData);
  const metadata = JSON.parse(decodedData);
  return metadata;
};
var getMetadataFromResponse = (response) => {
  if (!response.headers) {
    return {};
  }
  const value = response.headers.get(METADATA_HEADER_EXTERNAL) || response.headers.get(METADATA_HEADER_INTERNAL);
  try {
    return decodeMetadata(value);
  } catch {
    throw new Error(
      "An internal error occurred while trying to retrieve the metadata for an entry. Please try updating to the latest version of the Netlify Blobs client."
    );
  }
};
var NF_ERROR = "x-nf-error";
var NF_REQUEST_ID = "x-nf-request-id";
var BlobsInternalError = class extends Error {
  constructor(res) {
    let details = res.headers.get(NF_ERROR) || `${res.status} status code`;
    if (res.headers.has(NF_REQUEST_ID)) {
      details += `, ID: ${res.headers.get(NF_REQUEST_ID)}`;
    }
    super(`Netlify Blobs has generated an internal error (${details})`);
    this.name = "BlobsInternalError";
  }
};
var collectIterator = async (iterator) => {
  const result = [];
  for await (const item of iterator) {
    result.push(item);
  }
  return result;
};
function withSpan(span, name, fn) {
  if (span) return fn(span);
  return withActiveSpan(getTracer(), name, (span2) => {
    return fn(span2);
  });
}
var BlobsConsistencyError = class extends Error {
  constructor() {
    super(
      `Netlify Blobs has failed to perform a read using strong consistency because the environment has not been configured with a 'uncachedEdgeURL' property`
    );
    this.name = "BlobsConsistencyError";
  }
};
var regions = {
  "us-east-1": true,
  "us-east-2": true,
  "eu-central-1": true,
  "ap-southeast-1": true,
  "ap-southeast-2": true
};
var isValidRegion = (input) => Object.keys(regions).includes(input);
var InvalidBlobsRegionError = class extends Error {
  constructor(region) {
    super(
      `${region} is not a supported Netlify Blobs region. Supported values are: ${Object.keys(regions).join(", ")}.`
    );
    this.name = "InvalidBlobsRegionError";
  }
};
var DEFAULT_RETRY_DELAY = getEnvironment().get("NODE_ENV") === "test" ? 1 : 5e3;
var MIN_RETRY_DELAY = 1e3;
var MAX_RETRY = 5;
var RATE_LIMIT_HEADER = "X-RateLimit-Reset";
var fetchAndRetry = async (fetch2, url, options, attemptsLeft = MAX_RETRY) => {
  try {
    const res = await fetch2(url, options);
    if (attemptsLeft > 0 && (res.status === 429 || res.status >= 500)) {
      const delay = getDelay(res.headers.get(RATE_LIMIT_HEADER));
      await sleep(delay);
      return fetchAndRetry(fetch2, url, options, attemptsLeft - 1);
    }
    return res;
  } catch (error) {
    if (attemptsLeft === 0) {
      throw error;
    }
    const delay = getDelay();
    await sleep(delay);
    return fetchAndRetry(fetch2, url, options, attemptsLeft - 1);
  }
};
var getDelay = (rateLimitReset) => {
  if (!rateLimitReset) {
    return DEFAULT_RETRY_DELAY;
  }
  return Math.max(Number(rateLimitReset) * 1e3 - Date.now(), MIN_RETRY_DELAY);
};
var sleep = (ms) => new Promise((resolve2) => {
  setTimeout(resolve2, ms);
});
var SIGNED_URL_ACCEPT_HEADER = "application/json;type=signed-url";
var Client = class {
  constructor({ apiURL, consistency, edgeURL, fetch: fetch2, region, siteID, token, uncachedEdgeURL }) {
    this.apiURL = apiURL;
    this.consistency = consistency ?? "eventual";
    this.edgeURL = edgeURL;
    this.fetch = fetch2 ?? globalThis.fetch;
    this.region = region;
    this.siteID = siteID;
    this.token = token;
    this.uncachedEdgeURL = uncachedEdgeURL;
    if (!this.fetch) {
      throw new Error(
        "Netlify Blobs could not find a `fetch` client in the global scope. You can either update your runtime to a version that includes `fetch` (like Node.js 18.0.0 or above), or you can supply your own implementation using the `fetch` property."
      );
    }
  }
  async getFinalRequest({
    consistency: opConsistency,
    key,
    metadata,
    method,
    parameters = {},
    storeName
  }) {
    const encodedMetadata = encodeMetadata(metadata);
    const consistency = opConsistency ?? this.consistency;
    let urlPath = `/${this.siteID}`;
    if (storeName) {
      urlPath += `/${storeName}`;
    }
    if (key) {
      urlPath += `/${key}`;
    }
    if (this.edgeURL) {
      if (consistency === "strong" && !this.uncachedEdgeURL) {
        throw new BlobsConsistencyError();
      }
      const headers = {
        authorization: `Bearer ${this.token}`
      };
      if (encodedMetadata) {
        headers[METADATA_HEADER_INTERNAL] = encodedMetadata;
      }
      if (this.region) {
        urlPath = `/region:${this.region}${urlPath}`;
      }
      const url2 = new URL(urlPath, consistency === "strong" ? this.uncachedEdgeURL : this.edgeURL);
      for (const key2 in parameters) {
        url2.searchParams.set(key2, parameters[key2]);
      }
      return {
        headers,
        url: url2.toString()
      };
    }
    const apiHeaders = { authorization: `Bearer ${this.token}` };
    const url = new URL(`/api/v1/blobs${urlPath}`, this.apiURL ?? "https://api.netlify.com");
    for (const key2 in parameters) {
      url.searchParams.set(key2, parameters[key2]);
    }
    if (this.region) {
      url.searchParams.set("region", this.region);
    }
    if (storeName === void 0 || key === void 0) {
      return {
        headers: apiHeaders,
        url: url.toString()
      };
    }
    if (encodedMetadata) {
      apiHeaders[METADATA_HEADER_EXTERNAL] = encodedMetadata;
    }
    if (method === "head" || method === "delete") {
      return {
        headers: apiHeaders,
        url: url.toString()
      };
    }
    const res = await this.fetch(url.toString(), {
      headers: { ...apiHeaders, accept: SIGNED_URL_ACCEPT_HEADER },
      method
    });
    if (res.status !== 200) {
      throw new BlobsInternalError(res);
    }
    const { url: signedURL } = await res.json();
    const userHeaders = encodedMetadata ? { [METADATA_HEADER_INTERNAL]: encodedMetadata } : void 0;
    return {
      headers: userHeaders,
      url: signedURL
    };
  }
  async makeRequest({
    body,
    conditions = {},
    consistency,
    headers: extraHeaders,
    key,
    metadata,
    method,
    parameters,
    storeName
  }) {
    const { headers: baseHeaders = {}, url } = await this.getFinalRequest({
      consistency,
      key,
      metadata,
      method,
      parameters,
      storeName
    });
    const headers = {
      ...baseHeaders,
      ...extraHeaders
    };
    if (method === "put") {
      headers["cache-control"] = "max-age=0, stale-while-revalidate=60";
    }
    if ("onlyIfMatch" in conditions && conditions.onlyIfMatch) {
      headers["if-match"] = conditions.onlyIfMatch;
    } else if ("onlyIfNew" in conditions && conditions.onlyIfNew) {
      headers["if-none-match"] = "*";
    }
    const options = {
      body,
      headers,
      method
    };
    if (body instanceof ReadableStream) {
      options.duplex = "half";
    }
    return fetchAndRetry(this.fetch, url, options);
  }
};
var getClientOptions = (options, contextOverride) => {
  const context = contextOverride ?? getEnvironmentContext();
  const siteID = context.siteID ?? options.siteID;
  const token = context.token ?? options.token;
  if (!siteID || !token) {
    throw new MissingBlobsEnvironmentError(["siteID", "token"]);
  }
  if (options.region !== void 0 && !isValidRegion(options.region)) {
    throw new InvalidBlobsRegionError(options.region);
  }
  const clientOptions = {
    apiURL: context.apiURL ?? options.apiURL,
    consistency: options.consistency,
    edgeURL: context.edgeURL ?? options.edgeURL,
    fetch: options.fetch,
    region: options.region,
    siteID,
    token,
    uncachedEdgeURL: context.uncachedEdgeURL ?? options.uncachedEdgeURL
  };
  return clientOptions;
};

// ../../../node_modules/@netlify/blobs/dist/main.js
var DEPLOY_STORE_PREFIX = "deploy:";
var LEGACY_STORE_INTERNAL_PREFIX = "netlify-internal/legacy-namespace/";
var SITE_STORE_PREFIX = "site:";
var STATUS_OK = 200;
var STATUS_PRE_CONDITION_FAILED = 412;
var Store = class _Store {
  constructor(options) {
    this.client = options.client;
    if ("deployID" in options) {
      _Store.validateDeployID(options.deployID);
      let name = DEPLOY_STORE_PREFIX + options.deployID;
      if (options.name) {
        name += `:${options.name}`;
      }
      this.name = name;
    } else if (options.name.startsWith(LEGACY_STORE_INTERNAL_PREFIX)) {
      const storeName = options.name.slice(LEGACY_STORE_INTERNAL_PREFIX.length);
      _Store.validateStoreName(storeName);
      this.name = storeName;
    } else {
      _Store.validateStoreName(options.name);
      this.name = SITE_STORE_PREFIX + options.name;
    }
  }
  async delete(key) {
    const res = await this.client.makeRequest({ key, method: "delete", storeName: this.name });
    if (![200, 204, 404].includes(res.status)) {
      throw new BlobsInternalError(res);
    }
  }
  async deleteAll() {
    let totalDeletedBlobs = 0;
    let hasMore = true;
    while (hasMore) {
      const res = await this.client.makeRequest({ method: "delete", storeName: this.name });
      if (res.status !== 200) {
        throw new BlobsInternalError(res);
      }
      const data = await res.json();
      if (typeof data.blobs_deleted !== "number") {
        throw new BlobsInternalError(res);
      }
      totalDeletedBlobs += data.blobs_deleted;
      hasMore = typeof data.has_more === "boolean" && data.has_more;
    }
    return {
      deletedBlobs: totalDeletedBlobs
    };
  }
  async get(key, options) {
    return withSpan(options?.span, "blobs.get", async (span) => {
      const { consistency, type } = options ?? {};
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.type": type,
        "blobs.method": "GET",
        "blobs.consistency": consistency
      });
      const res = await this.client.makeRequest({
        consistency,
        key,
        method: "get",
        storeName: this.name
      });
      span?.setAttributes({
        "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200) {
        throw new BlobsInternalError(res);
      }
      if (type === void 0 || type === "text") {
        return res.text();
      }
      if (type === "arrayBuffer") {
        return res.arrayBuffer();
      }
      if (type === "blob") {
        return res.blob();
      }
      if (type === "json") {
        return res.json();
      }
      if (type === "stream") {
        return res.body;
      }
      throw new BlobsInternalError(res);
    });
  }
  async getMetadata(key, options = {}) {
    return withSpan(options?.span, "blobs.getMetadata", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "HEAD",
        "blobs.consistency": options.consistency
      });
      const res = await this.client.makeRequest({
        consistency: options.consistency,
        key,
        method: "head",
        storeName: this.name
      });
      span?.setAttributes({
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200 && res.status !== 304) {
        throw new BlobsInternalError(res);
      }
      const etag = res?.headers.get("etag") ?? void 0;
      const metadata = getMetadataFromResponse(res);
      const result = {
        etag,
        metadata
      };
      return result;
    });
  }
  async getWithMetadata(key, options) {
    return withSpan(options?.span, "blobs.getWithMetadata", async (span) => {
      const { consistency, etag: requestETag, type } = options ?? {};
      const headers = requestETag ? { "if-none-match": requestETag } : void 0;
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "GET",
        "blobs.consistency": options?.consistency,
        "blobs.type": type,
        "blobs.request.etag": requestETag
      });
      const res = await this.client.makeRequest({
        consistency,
        headers,
        key,
        method: "get",
        storeName: this.name
      });
      const responseETag = res?.headers.get("etag") ?? void 0;
      span?.setAttributes({
        "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
        "blobs.response.etag": responseETag,
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200 && res.status !== 304) {
        throw new BlobsInternalError(res);
      }
      const metadata = getMetadataFromResponse(res);
      const result = {
        etag: responseETag,
        metadata
      };
      if (res.status === 304 && requestETag) {
        return { data: null, ...result };
      }
      if (type === void 0 || type === "text") {
        return { data: await res.text(), ...result };
      }
      if (type === "arrayBuffer") {
        return { data: await res.arrayBuffer(), ...result };
      }
      if (type === "blob") {
        return { data: await res.blob(), ...result };
      }
      if (type === "json") {
        return { data: await res.json(), ...result };
      }
      if (type === "stream") {
        return { data: res.body, ...result };
      }
      throw new Error(`Invalid 'type' property: ${type}. Expected: arrayBuffer, blob, json, stream, or text.`);
    });
  }
  list(options = {}) {
    return withSpan(options.span, "blobs.list", (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.method": "GET",
        "blobs.list.paginate": options.paginate ?? false
      });
      const iterator = this.getListIterator(options);
      if (options.paginate) {
        return iterator;
      }
      return collectIterator(iterator).then(
        (items) => items.reduce(
          (acc, item) => ({
            blobs: [...acc.blobs, ...item.blobs],
            directories: [...acc.directories, ...item.directories]
          }),
          { blobs: [], directories: [] }
        )
      );
    });
  }
  async set(key, data, options = {}) {
    return withSpan(options.span, "blobs.set", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "PUT",
        "blobs.data.size": typeof data == "string" ? data.length : data instanceof Blob ? data.size : data.byteLength,
        "blobs.data.type": typeof data == "string" ? "string" : data instanceof Blob ? "blob" : "arrayBuffer",
        "blobs.atomic": Boolean(options.onlyIfMatch ?? options.onlyIfNew)
      });
      _Store.validateKey(key);
      const conditions = _Store.getConditions(options);
      const res = await this.client.makeRequest({
        conditions,
        body: data,
        key,
        metadata: options.metadata,
        method: "put",
        storeName: this.name
      });
      const etag = res.headers.get("etag") ?? "";
      span?.setAttributes({
        "blobs.response.etag": etag,
        "blobs.response.status": res.status
      });
      if (conditions) {
        return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: false } : { etag, modified: true };
      }
      if (res.status === STATUS_OK) {
        return {
          etag,
          modified: true
        };
      }
      throw new BlobsInternalError(res);
    });
  }
  async setJSON(key, data, options = {}) {
    return withSpan(options.span, "blobs.setJSON", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "PUT",
        "blobs.data.type": "json"
      });
      _Store.validateKey(key);
      const conditions = _Store.getConditions(options);
      const payload = JSON.stringify(data);
      const headers = {
        "content-type": "application/json"
      };
      const res = await this.client.makeRequest({
        ...conditions,
        body: payload,
        headers,
        key,
        metadata: options.metadata,
        method: "put",
        storeName: this.name
      });
      const etag = res.headers.get("etag") ?? "";
      span?.setAttributes({
        "blobs.response.etag": etag,
        "blobs.response.status": res.status
      });
      if (conditions) {
        return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: false } : { etag, modified: true };
      }
      if (res.status === STATUS_OK) {
        return {
          etag,
          modified: true
        };
      }
      throw new BlobsInternalError(res);
    });
  }
  static formatListResultBlob(result) {
    if (!result.key) {
      return null;
    }
    return {
      etag: result.etag,
      key: result.key
    };
  }
  static getConditions(options) {
    if ("onlyIfMatch" in options && "onlyIfNew" in options) {
      throw new Error(
        `The 'onlyIfMatch' and 'onlyIfNew' options are mutually exclusive. Using 'onlyIfMatch' will make the write succeed only if there is an entry for the key with the given content, while 'onlyIfNew' will make the write succeed only if there is no entry for the key.`
      );
    }
    if ("onlyIfMatch" in options && options.onlyIfMatch) {
      if (typeof options.onlyIfMatch !== "string") {
        throw new Error(`The 'onlyIfMatch' property expects a string representing an ETag.`);
      }
      return {
        onlyIfMatch: options.onlyIfMatch
      };
    }
    if ("onlyIfNew" in options && options.onlyIfNew) {
      if (typeof options.onlyIfNew !== "boolean") {
        throw new Error(
          `The 'onlyIfNew' property expects a boolean indicating whether the write should fail if an entry for the key already exists.`
        );
      }
      return {
        onlyIfNew: true
      };
    }
  }
  static validateKey(key) {
    if (key === "") {
      throw new Error("Blob key must not be empty.");
    }
    if (key.startsWith("/") || key.startsWith("%2F")) {
      throw new Error("Blob key must not start with forward slash (/).");
    }
    if (new TextEncoder().encode(key).length > 600) {
      throw new Error(
        "Blob key must be a sequence of Unicode characters whose UTF-8 encoding is at most 600 bytes long."
      );
    }
  }
  static validateDeployID(deployID) {
    if (!/^\w{1,24}$/.test(deployID)) {
      throw new Error(`'${deployID}' is not a valid Netlify deploy ID.`);
    }
  }
  static validateStoreName(name) {
    if (name.includes("/") || name.includes("%2F")) {
      throw new Error("Store name must not contain forward slashes (/).");
    }
    if (new TextEncoder().encode(name).length > 64) {
      throw new Error(
        "Store name must be a sequence of Unicode characters whose UTF-8 encoding is at most 64 bytes long."
      );
    }
  }
  getListIterator(options) {
    const { client, name: storeName } = this;
    const parameters = {};
    if (options?.prefix) {
      parameters.prefix = options.prefix;
    }
    if (options?.directories) {
      parameters.directories = "true";
    }
    return {
      [Symbol.asyncIterator]() {
        let currentCursor = null;
        let done = false;
        return {
          async next() {
            return withSpan(options?.span, "blobs.list.next", async (span) => {
              span?.setAttributes({
                "blobs.store": storeName,
                "blobs.method": "GET",
                "blobs.list.paginate": options?.paginate ?? false,
                "blobs.list.done": done,
                "blobs.list.cursor": currentCursor ?? void 0
              });
              if (done) {
                return { done: true, value: void 0 };
              }
              const nextParameters = { ...parameters };
              if (currentCursor !== null) {
                nextParameters.cursor = currentCursor;
              }
              const res = await client.makeRequest({
                method: "get",
                parameters: nextParameters,
                storeName
              });
              span?.setAttributes({
                "blobs.response.status": res.status
              });
              let blobs = [];
              let directories = [];
              if (![200, 204, 404].includes(res.status)) {
                throw new BlobsInternalError(res);
              }
              if (res.status === 404) {
                done = true;
              } else {
                const page = await res.json();
                if (page.next_cursor) {
                  currentCursor = page.next_cursor;
                } else {
                  done = true;
                }
                blobs = (page.blobs ?? []).map(_Store.formatListResultBlob).filter(Boolean);
                directories = page.directories ?? [];
              }
              return {
                done: false,
                value: {
                  blobs,
                  directories
                }
              };
            });
          }
        };
      }
    };
  }
};
var getStore = (input, options) => {
  if (typeof input === "string") {
    const contextOverride = options?.siteID && options?.token ? { siteID: options?.siteID, token: options?.token } : void 0;
    const clientOptions = getClientOptions(options ?? {}, contextOverride);
    const client = new Client(clientOptions);
    return new Store({ client, name: input });
  }
  if (typeof input?.name === "string") {
    const { name } = input;
    const contextOverride = input?.siteID && input?.token ? { siteID: input?.siteID, token: input?.token } : void 0;
    const clientOptions = getClientOptions(input, contextOverride);
    if (!name) {
      throw new MissingBlobsEnvironmentError(["name"]);
    }
    const client = new Client(clientOptions);
    return new Store({ client, name });
  }
  if (typeof input?.deployID === "string") {
    const clientOptions = getClientOptions(input);
    const { deployID } = input;
    if (!deployID) {
      throw new MissingBlobsEnvironmentError(["deployID"]);
    }
    const client = new Client(clientOptions);
    return new Store({ client, deployID });
  }
  throw new Error(
    "The `getStore` method requires the name of the store as a string or as the `name` property of an options object"
  );
};

// blobStore.mjs
var PREVIEW_RESULTS_STORE = "preview-results";
function explainBlobStoreError(err) {
  const message = err?.message || "Unknown error";
  const stack = err?.stack || "";
  const missing = [];
  if (!process.env.NETLIFY_SITE_ID) missing.push("NETLIFY_SITE_ID");
  if (!process.env.NETLIFY_AUTH_TOKEN) missing.push("NETLIFY_AUTH_TOKEN");
  const blobContext = /@netlify\/blobs|blobStore\.mjs|getPreviewResult\.mjs|analyzeResume-background\.mjs/.test(stack);
  if (blobContext && /invalid url/i.test(message)) {
    const missingText = missing.length ? ` Missing: ${missing.join(", ")}.` : "";
    return `Netlify Blobs could not resolve a valid site/runtime URL.${missingText} Run this project with \`netlify dev\` from a linked site, or set valid Netlify credentials for local access. Underlying error: ${message}`;
  }
  return message;
}
function getNamedBlobStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  try {
    if (siteID && token) {
      return {
        store: getStore({ name, siteID, token }),
        configError: null
      };
    }
    return {
      store: getStore({ name }),
      configError: null
    };
  } catch (err) {
    const missing = [];
    if (!siteID) missing.push("NETLIFY_SITE_ID");
    if (!token) missing.push("NETLIFY_AUTH_TOKEN");
    const missingText = missing.length ? ` Missing: ${missing.join(", ")}.` : "";
    return {
      store: null,
      configError: `Netlify Blobs is not configured for local/background function access.${missingText} Run via Netlify Dev with a linked site, or set valid Netlify credentials.${err?.message ? ` Underlying error: ${err.message}` : ""}`
    };
  }
}
function getPreviewResultsStore() {
  return getNamedBlobStore(PREVIEW_RESULTS_STORE);
}

// projectIcons.mjs
var EMOJI_DOMAIN_MAP = [
  { id: "space", keywords: ["space", "aerospace", "rocket", "satellite", "orbital"], emoji: ["\u{1F680}", "\u{1F6F8}", "\u{1F30C}"] },
  { id: "game", keywords: ["game", "simulation", "unity", "unreal", "godot", "pygame"], emoji: ["\u{1F3AE}", "\u{1F579}\uFE0F", "\u{1F3B2}"] },
  { id: "biology", keywords: ["biology", "genomics", "bioinformatics", "dna", "rna", "protein", "cell", "organism", "ecology"], emoji: ["\u{1F9EC}", "\u{1F33F}", "\u{1F9A0}"] },
  { id: "chemistry", keywords: ["chemistry", "chemical", "synthesis", "reaction", "molecule", "polymer"], emoji: ["\u2697\uFE0F", "\u{1F9EA}", "\u{1F52C}"] },
  { id: "physics", keywords: ["physics", "optics", "laser", "photon", "quantum", "wave", "acoustic"], emoji: ["\u{1F52C}", "\u{1F4A1}", "\u{1F30A}", "\u{1F52D}"] },
  { id: "electrical", keywords: ["electrical", "circuit", "rf", "antenna", "pcb", "embedded", "fpga", "microcontroller", "arduino", "esp32", "firmware"], emoji: ["\u26A1", "\u{1F4E1}", "\u{1F50C}", "\u{1F50B}"] },
  { id: "mechanical", keywords: ["mechanical", "manufacturing", "cad", "solidworks", "autocad", "3d print", "cnc", "robotics"], emoji: ["\u2699\uFE0F", "\u{1F3D7}\uFE0F", "\u{1F529}"] },
  { id: "environment", keywords: ["environment", "civil", "geospatial", "gis", "hydrology", "climate", "geology", "surveying"], emoji: ["\u{1F30D}", "\u{1F3D4}\uFE0F", "\u{1F331}"] },
  { id: "finance", keywords: ["finance", "accounting", "trading", "portfolio", "stock", "investment", "banking", "audit", "tax"], emoji: ["\u{1F4B0}", "\u{1F4C9}", "\u{1F3E6}"] },
  { id: "data", keywords: ["data", "analytics", "machine learning", "ml", "deep learning", "nlp", "ai", "statistics", "tableau", "power bi", "pandas", "numpy"], emoji: ["\u{1F4CA}", "\u{1F4C8}", "\u{1F916}", "\u{1F9E0}"] },
  { id: "design", keywords: ["art", "illustration", "animation", "figma", "photoshop", "ux", "ui", "media", "film", "video"], emoji: ["\u{1F3A8}", "\u{1F5BC}\uFE0F", "\u{1F3AC}"] },
  { id: "network", keywords: ["network", "security", "cybersecurity", "firewall", "penetration", "siem", "soc", "cryptography"], emoji: ["\u{1F510}", "\u{1F310}", "\u{1F5A7}"] },
  { id: "education", keywords: ["education", "research", "teaching", "curriculum", "pedagogy", "writing", "linguistics", "language"], emoji: ["\u{1F4DA}", "\u{1F393}", "\u{1F4DD}"] },
  { id: "software", keywords: ["web", "app", "frontend", "backend", "api", "react", "vue", "angular", "node", "django", "flask", "software"], emoji: ["\u{1F4BB}", "\u{1F5A5}\uFE0F", "\u{1F6E0}\uFE0F", "\u{1F527}"] }
];
var FALLBACK_EMOJI = ["\u{1F52D}", "\u{1F4A1}", "\u{1F9E9}", "\u{1F4CC}", "\u{1F5C2}\uFE0F", "\u{1F9EE}", "\u{1F4D0}", "\u{1F50E}"];
var DOMAIN_HINTS = [
  { id: "electrical", keywords: ["electrical", "hardware", "embedded", "semiconductor", "circuits", "pcb", "signal", "firmware"] },
  { id: "physics", keywords: ["optics", "laser", "photon", "wave", "schematic"] },
  { id: "mechanical", keywords: ["robot", "mechanical", "manufacturing"] },
  { id: "data", keywords: ["data", "analytics", "ml", "ai"] },
  { id: "software", keywords: ["software", "web", "app", "frontend", "backend"] },
  { id: "biology", keywords: ["bio", "genomics", "clinical", "ecology"] },
  { id: "chemistry", keywords: ["chem", "molecule", "polymer"] },
  { id: "environment", keywords: ["civil", "geo", "climate", "survey"] },
  { id: "finance", keywords: ["finance", "accounting", "investment"] },
  { id: "network", keywords: ["network", "cyber", "security"] },
  { id: "education", keywords: ["teaching", "education", "writing", "research"] },
  { id: "game", keywords: ["game", "simulation"] },
  { id: "space", keywords: ["space", "aerospace", "orbital"] },
  { id: "design", keywords: ["design", "art", "media", "visual"] }
];
function textOf(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.values(value).map(textOf).filter(Boolean).join(" ");
  return String(value);
}
function normalizeEmojiIcon(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return Array.from(text)[0] || "";
}
function mergeAiProjectIcons(projects = [], analysisJson = {}) {
  const notes = [
    ...analysisJson?.resume_strategy?.website_copy_seed?.project_framing_notes || [],
    ...analysisJson?.resume_resolved?.website_copy_seed?.project_framing_notes || []
  ].filter((note) => note && typeof note === "object");
  if (!notes.length) return projects;
  const iconByProjectName = /* @__PURE__ */ new Map();
  for (const note of notes) {
    const key = String(note.project_name || "").trim().toLowerCase();
    const icon = normalizeEmojiIcon(note.project_icon);
    if (key && icon && !iconByProjectName.has(key)) {
      iconByProjectName.set(key, icon);
    }
  }
  return (projects || []).map((project) => {
    if (!project || typeof project !== "object") return project;
    if (project.project_icon) return project;
    const key = String(project.name || "").trim().toLowerCase();
    const aiIcon = key ? iconByProjectName.get(key) : "";
    return aiIcon ? { ...project, project_icon: aiIcon } : project;
  });
}
function inferPrimaryDomain(analysisJson = {}) {
  const motifs = analysisJson?.resume_strategy?.motifs || {};
  const visual = analysisJson?.resume_resolved?.visual_language || {};
  const targetRole = analysisJson?.resume_resolved?.target_role || {};
  const hay = [
    motifs.broad_primary_domain,
    motifs.resume_keywords,
    motifs.potential_visual_motifs,
    motifs.symbolic_objects,
    visual.dominant_motifs,
    visual.symbolic_objects,
    targetRole.role_title,
    targetRole.industry
  ].map(textOf).join(" ").toLowerCase();
  for (const hint of DOMAIN_HINTS) {
    if (hint.keywords.some((keyword) => hay.includes(keyword))) return hint.id;
  }
  return "";
}
function scoreProjectDomains(project = {}, preferredDomain = "") {
  const hay = [
    project.name,
    project.description,
    project.role,
    project.technologies,
    project.bullets
  ].map(textOf).join(" ").toLowerCase();
  const scored = EMOJI_DOMAIN_MAP.map((domain) => {
    let score = 0;
    for (const keyword of domain.keywords) {
      if (hay.includes(keyword)) score += keyword.length > 6 ? 4 : 2;
    }
    if (preferredDomain && domain.id === preferredDomain) score += 3;
    return { domain, score };
  }).filter((entry) => entry.score > 0);
  if (scored.length) {
    scored.sort((a, b) => b.score - a.score);
    return scored.map((entry) => entry.domain);
  }
  const preferred = EMOJI_DOMAIN_MAP.find((domain) => domain.id === preferredDomain);
  return preferred ? [preferred] : [];
}
function pickUniqueEmoji(domains, used, idx) {
  const pool = domains.flatMap((domain) => domain.emoji);
  const uniquePool = pool.filter((emoji, i) => pool.indexOf(emoji) === i);
  for (const emoji of uniquePool) {
    if (!used.has(emoji)) {
      used.add(emoji);
      return emoji;
    }
  }
  const fallbackPool = uniquePool.length ? uniquePool : FALLBACK_EMOJI;
  const chosen = fallbackPool[idx % fallbackPool.length];
  used.add(chosen);
  return chosen;
}
function assignProjectIcons(projects = [], analysisJson = {}) {
  const preferredDomain = inferPrimaryDomain(analysisJson);
  const used = /* @__PURE__ */ new Set();
  const aiFirstProjects = mergeAiProjectIcons(projects, analysisJson);
  return (aiFirstProjects || []).map((project, idx) => {
    if (!project || typeof project !== "object") return project;
    if (project.project_icon) {
      used.add(project.project_icon);
      return project;
    }
    const domains = scoreProjectDomains(project, preferredDomain);
    return {
      ...project,
      project_icon: pickUniqueEmoji(domains, used, idx)
    };
  });
}
function attachProjectIconsToAnalysis(analysisJson = {}) {
  if (!analysisJson || typeof analysisJson !== "object") return analysisJson;
  const factualProfile = analysisJson.resume_facts?.factual_profile;
  if (Array.isArray(factualProfile?.projects)) {
    factualProfile.projects = assignProjectIcons(factualProfile.projects, analysisJson);
  }
  if (Array.isArray(analysisJson.projects)) {
    analysisJson.projects = assignProjectIcons(analysisJson.projects, analysisJson);
  }
  return analysisJson;
}

// usageQuota.mjs
var import_supabase_js = require("@supabase/supabase-js");
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return (0, import_supabase_js.createClient)(url, key, { auth: { persistSession: false } });
}
async function checkAndIncrementCredits(userId) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return { allowed: true };
  const { data: m, error } = await supabase.from("memberships").select("tier, status, credits_used, credits_limit").eq("user_id", userId).single();
  if (error || !m) return { allowed: true };
  const unlimited = m.credits_limit === -1;
  if (!unlimited && m.credits_used >= m.credits_limit) {
    return {
      allowed: false,
      reason: `Credit limit reached (${m.credits_used}/${m.credits_limit}) for tier "${m.tier}".`,
      tier: m.tier,
      used: m.credits_used,
      limit: m.credits_limit
    };
  }
  await supabase.from("memberships").update({ credits_used: m.credits_used + 1 }).eq("user_id", userId);
  return { allowed: true };
}
async function logUsageEvent(userId, fields) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return;
  await supabase.from("usage_events").insert({ user_id: userId, ...fields });
}

// analyzeResume-background.mjs
async function handler(event) {
  let body, jobId, store;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }
  jobId = body.jobId;
  if (!jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing jobId" }) };
  }
  try {
    const { store: previewStore, configError } = getPreviewResultsStore();
    if (!previewStore) {
      return { statusCode: 500, body: JSON.stringify({ error: configError }) };
    }
    store = previewStore;
    await store.set(jobId, JSON.stringify({ status: "pending" }), { ttl: 3600 });
    const {
      resumePdfBase64,
      resumeMime = "application/pdf",
      major = "",
      specialization = "",
      provider = "claude",
      userId = null
    } = body;
    if (!resumePdfBase64) {
      await store.set(jobId, JSON.stringify({ status: "error", error: "resumePdfBase64 is required" }), { ttl: 3600 });
      return { statusCode: 202 };
    }
    if (!/pdf/i.test(resumeMime || "")) {
      await store.set(jobId, JSON.stringify({ status: "error", error: `Unsupported file type: ${resumeMime}. Please upload a PDF.` }), { ttl: 3600 });
      return { statusCode: 202 };
    }
    if (userId) {
      const quota = await checkAndIncrementCredits(userId);
      if (!quota.allowed) {
        await store.set(jobId, JSON.stringify({
          status: "error",
          error: quota.reason,
          quota: true,
          tier: quota.tier,
          used: quota.used,
          limit: quota.limit
        }), { ttl: 3600 });
        return { statusCode: 202 };
      }
    }
    const cwd = process.cwd();
    let promptTemplate;
    for (const candidate of [
      (0, import_path.resolve)(cwd, "src/netlify/functions/extractResumeProfile.md"),
      (0, import_path.resolve)(cwd, "netlify/functions/extractResumeProfile.md"),
      (0, import_path.resolve)(cwd, "extractResumeProfile.md")
    ]) {
      try {
        promptTemplate = (0, import_fs.readFileSync)(candidate, "utf-8");
        break;
      } catch {
      }
    }
    if (!promptTemplate) {
      await store.set(jobId, JSON.stringify({ status: "error", error: "Could not load extractResumeProfile.md" }), { ttl: 3600 });
      return { statusCode: 202 };
    }
    const filledPrompt = promptTemplate.replace(/\{\{MAJOR\}\}/g, major).replace(/\{\{SPECIALIZATION\}\}/g, specialization).replace(/\{\{RESUME\}\}/g, "[See the attached PDF document]").replace(/\{\{COPY_OKAY\}\}/g, "").replace(/\{\{SAMPLE_WEBSITE\}\}/g, "").replace(/\{\{COLOR_SCHEME_JSON\}\}/g, "");
    let rawText;
    if (provider === "openai") {
      const apiKey = process.env.OPENAI_API_KEY_LOCAL || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "OPENAI_API_KEY is not set." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o",
          input: [{ role: "user", content: [
            { type: "input_file", filename: "resume.pdf", file_data: `data:application/pdf;base64,${resumePdfBase64}` },
            { type: "input_text", text: filledPrompt + "\n\nAnalyze this resume according to the instructions above. Return valid JSON only." }
          ] }],
          max_output_tokens: 16e3
        })
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = {};
      }
      if (!res.ok) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "OpenAI API error: " + text.slice(0, 300) }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      rawText = (json.output_text || "").trim();
    } else {
      const apiKey = process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "ANTHROPIC_API_KEY is not set." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 16e3,
          system: filledPrompt,
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: resumePdfBase64 } },
              { type: "text", text: "Analyze this resume according to the instructions. Return valid JSON only." }
            ]
          }]
        })
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = {};
      }
      if (!res.ok) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "Claude API error: " + text.slice(0, 300) }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      rawText = (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    }
    let cleaned = rawText.trim().replace(/^```[a-zA-Z]*\r?\n?/, "").replace(/\r?\n?```\s*$/, "").trim();
    let analysisJson;
    try {
      analysisJson = JSON.parse(cleaned);
    } catch {
      const first = cleaned.indexOf("{"), last = cleaned.lastIndexOf("}");
      if (first !== -1 && last > first) {
        try {
          analysisJson = JSON.parse(cleaned.slice(first, last + 1));
        } catch {
        }
      }
    }
    if (!analysisJson) {
      await store.set(jobId, JSON.stringify({ status: "error", error: "Response was not valid JSON", raw_text: rawText.slice(0, 500) }), { ttl: 3600 });
      return { statusCode: 202 };
    }
    attachProjectIconsToAnalysis(analysisJson);
    await store.set(jobId, JSON.stringify({ status: "done", ...analysisJson }), { ttl: 3600 });
    await logUsageEvent(userId, {
      event_type: "resume_analysis",
      provider,
      model: provider === "openai" ? "gpt-4o" : "claude-sonnet-4-6",
      success: true
    });
  } catch (err) {
    const msg = explainBlobStoreError(err);
    console.error("analyzeResume-background error:", msg);
    if (store) {
      try {
        await store.set(jobId, JSON.stringify({ status: "error", error: msg }), { ttl: 3600 });
      } catch {
      }
    }
  }
  return { statusCode: 202 };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=analyzeResume-background.js.map
