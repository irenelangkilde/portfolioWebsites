var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// buildWebsite-background.mjs
var buildWebsite_background_exports = {};
__export(buildWebsite_background_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(buildWebsite_background_exports);
var import_openai = __toESM(require("openai"), 1);
var import_fs = require("fs");
var import_path = require("path");
var import_url = require("url");

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
async function logAnonUsage() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  try {
    await supabase.rpc("increment_anon_usage");
  } catch {
    try {
      const { data } = await supabase.from("anon_usage").select("credits_used").eq("id", 1).single();
      if (data) await supabase.from("anon_usage").update({ credits_used: data.credits_used + 1 }).eq("id", 1);
    } catch {
    }
  }
}

// buildWebsite-background.mjs
var import_meta = {};
var STAGE1_PROMPT = `You are a resume parser. Extract ALL content from the attached resume PDF and output a single JSON object \u2014 no markdown, no explanation, just the JSON.

Use this exact schema (omit fields that are absent from the resume, but never fabricate):

{
  "personal": {
    "name": "",
    "email": "",
    "phone": "",
    "linkedin": "",
    "github": "",
    "website": "",
    "location": ""
  },
  "summary": "",
  "education": [
    {
      "institution": "",
      "degree": "",
      "major": "",
      "minor": "",
      "graduation_date": "",
      "gpa": "",
      "honors": "",
      "relevant_coursework": [],
      "thesis": "",
      "activities": []
    }
  ],
  "experience": [
    {
      "company": "",
      "title": "",
      "start_date": "",
      "end_date": "",
      "location": "",
      "bullets": [],
      "technologies": []
    }
  ],
  "projects": [
    {
      "name": "",
      "description": "",
      "role": "",
      "dates": "",
      "technologies": [],
      "links": { "github": "", "demo": "", "other": "" },
      "bullets": []
    }
  ],
  "skills": {
    "technical": [],
    "tools": [],
    "programming_languages": [],
    "soft_skills": [],
    "other": []
  },
  "certifications": [
    { "name": "", "issuer": "", "date": "", "credential_id": "" }
  ],
  "awards": [
    { "title": "", "issuer": "", "date": "", "description": "" }
  ],
  "publications": [
    { "title": "", "venue": "", "date": "", "authors": [], "link": "" }
  ],
  "languages": [
    { "language": "", "proficiency": "" }
  ],
  "volunteer": [
    { "organization": "", "role": "", "dates": "", "description": "" }
  ],
  "extracurricular": [
    { "organization": "", "role": "", "dates": "", "description": "" }
  ]
}

Output the JSON only. Do not add any commentary before or after it.`;
var STAGE2_PROMPT = `You are a resume content validator. You will receive a JSON object extracted from a resume.

Your tasks:
1. Fix any formatting issues: normalize dates to "Month YYYY" or "YYYY" format, trim whitespace, remove duplicate entries.
2. Ensure arrays are arrays and strings are strings (never null \u2014 use "" or [] as defaults).
3. If the "personal.name" field is empty, set it to "Unknown".
4. Add a top-level "_validation" object summarizing what was found:
   {
     "_validation": {
       "completeness_score": 0-100,
       "missing_fields": [],
       "warnings": [],
       "section_counts": {
         "education": 0,
         "experience": 0,
         "projects": 0,
         "skills_total": 0,
         "certifications": 0
       }
     }
   }
5. Do NOT add, invent, or infer any content not present in the input JSON.
6. Output the corrected JSON only \u2014 no markdown, no explanation.`;
async function fetchSampleHtml(url) {
  if (!url) return "";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioBuilder/1.0)" },
      signal: AbortSignal.timeout(8e3)
    });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 4e4);
  } catch {
    return "";
  }
}
function templateUsageInstruction(copyrightMode) {
  if (copyrightMode === "owned") {
    return "The sample website is provided with permission \u2014 reproduce its layout structure, card designs, section order, background gradient technique, and visual hierarchy as faithfully as possible. Treat it as the authoritative design specification.";
  }
  return "The sample website is provided for inspiration only \u2014 draw on its general mood, visual energy, and compositional feel, but do NOT copy its specific layout, sections, or unique structural elements. Create a clearly original design that only echoes the spirit of the sample.";
}
function stripGrapesJsCss(html) {
  const styleRe = /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi;
  const blocks = [];
  let m;
  while ((m = styleRe.exec(html)) !== null) {
    blocks.push({ full: m[0], open: m[1], body: m[2], close: m[3], index: m.index });
  }
  if (blocks.length < 2) return html;
  const isGrapesBlock = (b) => /\bbackground-image\s*:\s*initial\s*;/.test(b.body) && /\bpadding-top\s*:\s*0px\s*;/.test(b.body);
  const toRemove = blocks.filter(isGrapesBlock);
  const remaining = blocks.length - toRemove.length;
  if (remaining < 1 || toRemove.length === 0) return html;
  let result = html;
  for (const b of [...toRemove].reverse()) {
    result = result.slice(0, b.index) + result.slice(b.index + b.full.length);
  }
  return result;
}
function cleanHtml(rawHtml) {
  let html = rawHtml.replace(/^```[a-zA-Z]*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  html = html.replace(/background-image\s*:([^;]+);/g, (_match, value) => {
    const parts = [];
    let depth = 0, curr = "";
    for (const ch of value) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(curr.trim());
        curr = "";
      } else curr += ch;
    }
    if (curr.trim()) parts.push(curr.trim());
    const cleaned = parts.filter((p) => p.toLowerCase() !== "initial");
    return cleaned.length ? `background-image:${cleaned.join(", ")};` : "";
  });
  html = html.replace(
    /background-(?:position-x|position-y|size|repeat|attachment|origin|clip)\s*:\s*(?:initial\s*,?\s*)+;/g,
    ""
  );
  return html;
}
function loadPromptFile(filename) {
  const cwd = process.cwd();
  let here = null;
  try {
    here = (0, import_path.dirname)((0, import_url.fileURLToPath)(import_meta.url));
  } catch {
  }
  const candidates = [
    (0, import_path.resolve)(cwd, `src/netlify/functions/${filename}`),
    (0, import_path.resolve)(cwd, `netlify/functions/${filename}`),
    (0, import_path.resolve)(cwd, filename)
  ];
  if (here) candidates.unshift((0, import_path.resolve)(here, filename));
  for (const candidate of candidates) {
    try {
      return (0, import_fs.readFileSync)(candidate, "utf-8");
    } catch {
    }
  }
  throw new Error(`Could not load ${filename} (cwd=${cwd}, here=${here})`);
}
function parseJsonResponse(raw) {
  const cleaned = raw.trim().replace(/^```[a-zA-Z]*\r?\n?/, "").replace(/\r?\n?```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
  }
  const first = cleaned.indexOf("{"), last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
  throw new Error("Response was not valid JSON");
}
function injectCssColors(html, colorSpec, templateHtml) {
  if (!colorSpec || colorSpec.use_sample_colors) return html;
  const rootMatch = (templateHtml || "").match(/:root\s*\{([\s\S]*?)\}/);
  if (!rootMatch) return html;
  const slots = ["primary", "secondary", "accent", "dark", "light"];
  const colorVars = [];
  const re = /(--color-[\w-]+)\s*:\s*#[0-9a-fA-F]{3,8}[^;]*;\s*\/\*\s*(\d+)\./g;
  let m;
  while ((m = re.exec(rootMatch[1])) !== null) {
    colorVars.push({ varName: m[1], index: parseInt(m[2]) });
  }
  colorVars.sort((a, b) => a.index - b.index);
  const varToSlot = {};
  colorVars.forEach((cv, i) => {
    if (i < slots.length) varToSlot[cv.varName] = slots[i];
  });
  if (!Object.keys(varToSlot).length) return html;
  return html.replace(/(--color-[\w-]+)(\s*:\s*)#[0-9a-fA-F]{3,8}/g, (match, varName, colon) => {
    const slot = varToSlot[varName];
    return slot && colorSpec[slot] ? varName + colon + colorSpec[slot] : match;
  });
}
function parseTemplateMetadata(html) {
  const m = (html || "").match(/<!--\s*(\{[\s\S]*?\})\s*-->/);
  if (!m) return {};
  try {
    return JSON.parse(m[1]);
  } catch {
    return {};
  }
}
function buildVisualDirection(motifs, designSpec, colorSpec, visualsJson) {
  const attrs = designSpec?.exemplary_attributes || {};
  const factors = designSpec?.design_factors || {};
  const density = designSpec?.density || attrs.section_density || factors.density || "medium";
  const useEmojiIcons = designSpec?.use_emoji_icons ?? true;
  const alternateSections = designSpec?.alternate_sections ?? true;
  const visualMotifs = motifs?.potential_visual_motifs || [];
  const domain = motifs?.broad_primary_domain || "professional";
  const heroConcept = visualMotifs.length > 0 ? `${visualMotifs[0]} \u2014 ${domain} field concept with ${(motifs?.symbolic_objects || [])[0] || "field-specific imagery"}` : `Abstract representation of the ${domain} domain using layered gradients and symbolic shapes`;
  const rendering = factors.rendering_style || (Array.isArray(motifs?.rendering_style) ? motifs.rendering_style[0] : motifs?.rendering_style) || "clean editorial vector";
  const isUseSampleColors = colorSpec?.use_sample_colors;
  const colorApp = isUseSampleColors ? {
    primary_use: "Preserve template's primary color for headings and key UI elements",
    secondary_use: "Preserve template's secondary color for subheadings and links",
    accent_use: "Preserve template's accent for hover states and CTAs",
    dark_use: "Preserve template's dark color for backgrounds and body text",
    light_use: "Preserve template's light color for cards and section backgrounds",
    gradient_notes: "Use template's existing gradient patterns"
  } : {
    primary_use: `${colorSpec?.primary || "primary"} \u2014 headings, navbar brand, primary buttons`,
    secondary_use: `${colorSpec?.secondary || "secondary"} \u2014 subheadings, links, secondary buttons`,
    accent_use: `${colorSpec?.accent || "accent"} \u2014 hover states, CTAs, highlights, icon accents`,
    dark_use: `${colorSpec?.dark || "dark"} \u2014 hero background, dark section backgrounds`,
    light_use: `${colorSpec?.light || "light"} \u2014 card backgrounds, alternating section fills`,
    gradient_notes: `Hero: ${colorSpec?.dark || "dark"} \u2192 ${colorSpec?.primary || "primary"}. Cards: subtle ${colorSpec?.light || "light"} base. Diagonal breaks: ${colorSpec?.primary || "primary"} \u2192 ${colorSpec?.secondary || "secondary"}.`
  };
  const pace = (attrs.pacing || "").toLowerCase();
  const animationGuidance = [];
  if (pace.includes("fast") || pace.includes("dynamic") || pace.includes("energet")) {
    animationGuidance.push("Fast scroll reveals: 0.3s fade-in with slight translateY(-10px)");
    animationGuidance.push("Subtle parallax on hero background layers");
  } else if (pace.includes("slow") || pace.includes("calm") || pace.includes("elegance") || pace.includes("minimal")) {
    animationGuidance.push("Gentle fade-in on scroll: 0.6s ease-out, staggered by 100ms per card");
    animationGuidance.push("Soft hover lift on cards: translateY(-3px) with deepened box-shadow");
  } else {
    animationGuidance.push("Fade-in on scroll via IntersectionObserver: 0.5s ease");
    animationGuidance.push("Card hover: translateY(-3px) with box-shadow transition 0.25s");
  }
  animationGuidance.push("Sticky frosted-glass navbar: backdrop-filter blur(12px) with subtle border");
  animationGuidance.push("CTA buttons: scale(1.03) on hover with 0.2s ease");
  const visualPlacements = (visualsJson || []).map((a) => {
    const t = (a.type || "").toLowerCase();
    const lbl = (a.label || a.name || "").toLowerCase();
    let section = "about or projects";
    let notes = "Linked with a descriptive anchor button";
    if (t.includes("image") || t.includes("photo")) {
      section = "hero or about";
      notes = "Displayed inline as a rounded portrait or project thumbnail";
    } else if (t.includes("video")) {
      section = "projects";
      notes = "Embedded as autoplay muted loop or linked thumbnail";
    } else if (t.includes("pdf") || lbl.includes("resume")) {
      section = "hero";
      notes = "Linked as a 'Download Resume' button";
    } else if (lbl.includes("project") || lbl.includes("demo")) {
      section = "projects";
      notes = "Linked as 'View Project' button with short description";
    }
    return { visual_label: a.label || a.name || "visual", visual_type: a.type || "file", placement_section: section, presentation_notes: notes };
  });
  return {
    visual_direction: {
      mood: attrs.mood || "professional, modern",
      compositional_feel: attrs.compositional_feel || "balanced, content-rich",
      section_density: density,
      use_emoji_icons: useEmojiIcons,
      alternate_sections: alternateSections,
      visual_treatment: attrs.visual_treatment || "clean with subtle depth and card layering",
      composition_choice: factors.composition_option || "split",
      rendering_style: rendering,
      hero_concept: heroConcept,
      visual_motifs: visualMotifs,
      symbolic_objects: motifs?.symbolic_objects || [],
      animation_guidance: animationGuidance,
      template_inspiration_notes: `Style token: ${factors.style_token || "clean-minimal"}. Pacing: ${attrs.pacing || "moderate"}. Preserve this visual character throughout.`,
      color_application: colorApp,
      visual_placements: visualPlacements
    }
  };
}
function fixMojibake(str) {
  if (typeof str !== "string") return str;
  return str.replace(/\u00e2\u0080\u0094/g, "\u2014").replace(/\u00e2\u0080\u0093/g, "\u2013").replace(/\u00e2\u0080\u0099/g, "\u2019").replace(/\u00e2\u0080\u009c/g, "\u201C").replace(/\u00e2\u0080\u009d/g, "\u201D").replace(/\u00e2\u0080\u00a6/g, "\u2026").replace(/\u00c2\u00b7/g, "\xB7").replace(/\u00c2\u00a9/g, "\xA9").replace(/\u00c2\u00ae/g, "\xAE").replace(/\u00c2\u00a0/g, " ");
}
function fixMojibakeDeep(val) {
  if (typeof val === "string") return fixMojibake(val);
  if (Array.isArray(val)) return val.map(fixMojibakeDeep);
  if (val && typeof val === "object") {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = fixMojibakeDeep(v);
    return out;
  }
  return val;
}
function isMustacheTemplate(html) {
  return /\{\{#\w+\}\}/.test(html);
}
function renderMustache(template, data) {
  const sectionRe = /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
  let result = template;
  let prev;
  do {
    prev = result;
    result = result.replace(sectionRe, (_, key, inner) => {
      const val = data[key];
      if (!val || Array.isArray(val) && val.length === 0) return "";
      if (Array.isArray(val)) {
        return val.map((item) => {
          if (typeof item !== "object" || item === null) {
            return inner.replace(/\{\{\.\}\}/g, String(item));
          }
          return renderMustache(inner, { ...data, ...item });
        }).join("");
      }
      return renderMustache(inner, data);
    });
  } while (result !== prev);
  result = result.replace(/\{\{([^#\/!{][^}]*)\}\}/g, (_, key) => {
    const trimmed = key.trim();
    if (trimmed === ".") return data["."] != null ? String(data["."]) : "";
    const val = data[trimmed];
    return val != null ? String(val) : "";
  });
  result = result.replace(/\{\{[#\/][^}]*\}\}/g, "");
  return result;
}
function toFlatResumeSchema(f) {
  if (!f) return {};
  if (f.personal !== void 0 || f.education !== void 0) return f;
  const identity = f.identity || {};
  const profile = f.factual_profile || {};
  const contact = identity.contact || {};
  const links = contact.other_links || [];
  const findLink = (pred) => links.find((l) => pred(typeof l === "string" ? l : l.url || l.href || "")) || "";
  return {
    personal: {
      name: identity.name || "",
      email: contact.email || "",
      phone: contact.phone || "",
      linkedin: contact.linkedin || "",
      github: findLink((u) => /github/i.test(u)),
      website: findLink((u) => u && !/github|linkedin/i.test(u)),
      location: contact.location || ""
    },
    summary: profile.about || "",
    education: profile.education || [],
    experience: profile.experience || [],
    projects: profile.projects || [],
    skills: profile.skills || {},
    certifications: profile.certifications || [],
    publications: profile.publications || [],
    volunteer: profile.volunteer_experience || [],
    extracurricular: [...profile.leadership || [], ...profile.organizations || []],
    desired_roles: profile.desired_roles || [],
    professional_interests: profile.professional_interests || []
  };
}
function trimAboutToLength(text, targetWords) {
  if (!targetWords || targetWords <= 0) return text;
  const words = text.trim().split(/\s+/);
  if (words.length <= targetWords * 1.3) return text;
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let result = "";
  let count = 0;
  for (const s of sentences) {
    const sw = s.trim().split(/\s+/).length;
    if (count > 0 && count + sw > targetWords * 1.35) break;
    result += (result ? " " : "") + s.trim();
    count += sw;
    if (count >= targetWords * 0.85) break;
  }
  return result || text;
}
function flattenToMustacheData(strategy, resumeJson, colorSpec, resumeStrategy = null, aboutWordCount = 0, heroCardMap = null) {
  const personal = resumeJson?.personal || {};
  const _coreStory = strategy?.editorial_direction?.core_story || "";
  const _firstSentence = _coreStory.match(/^[^.!?]*[.!?]/)?.[0]?.trim() || _coreStory;
  const pos = strategy?.positioning || {
    headline: strategy?.website_copy_seed?.hero_headline_options?.[0] || "",
    subheadline: strategy?.website_copy_seed?.hero_subheadline_options?.[0] || "",
    value_proposition: strategy?.website_copy_seed?.value_propositions?.[0] || strategy?.website_copy_seed?.about_angle || _firstSentence || ""
  };
  const edu0 = (resumeJson?.education || [])[0] || {};
  const copySeed = strategy?.website_copy_seed || resumeStrategy?.website_copy_seed || {};
  const openToRaw = String(copySeed.open_to || "").trim();
  const buildOpenToItems = (value, fallbackRoles = []) => {
    if (!value) return [];
    const cleaned = value.replace(/^[A-Za-z ]{0,24}:\s*/, "").replace(/\s+[—-]\s+(based in|located in|near|open to relocation|remote|hybrid)\b.*$/i, "").trim();
    const isShortChip = (label) => {
      const words = label.trim().split(/\s+/).filter(Boolean);
      return label.length <= 32 && words.length >= 1 && words.length <= 4;
    };
    const normalizeChip = (label) => label.replace(/\b(roles?|positions?|opportunities|companies|company)\b/gi, "").replace(/\s{2,}/g, " ").trim().replace(/^[,;:./\s-]+|[,;:./\s-]+$/g, "");
    const explicitParts = cleaned.split(/\s*[•|;]\s*|\s+[·•]\s+/).map((part) => normalizeChip(part)).filter(Boolean);
    if (explicitParts.length > 1 && explicitParts.every(isShortChip)) {
      return explicitParts.slice(0, 4).map((label) => ({ label }));
    }
    const roleIndustryMatch = cleaned.match(/^(.*?)\s+\bat\b\s+(.*)$/i);
    if (roleIndustryMatch) {
      const roleParts2 = roleIndustryMatch[1].split(/\s+\bor\b\s+|\s+\band\b\s+/i).map((part) => normalizeChip(part)).filter(Boolean);
      const industryParts = roleIndustryMatch[2].split(/\s+\bor\b\s+|\s+\band\b\s+/i).map((part) => normalizeChip(part)).filter(Boolean);
      const combined = [...roleParts2, ...industryParts].filter(isShortChip).slice(0, 4);
      if (combined.length >= 2) return combined.map((label) => ({ label }));
    }
    const roleParts = cleaned.split(/\s+\bor\b\s+|\s+\band\b\s+/i).map((part) => normalizeChip(part)).filter(Boolean);
    if (roleParts.length > 1 && roleParts.every(isShortChip)) {
      return roleParts.slice(0, 4).map((label) => ({ label }));
    }
    const roleFallback = fallbackRoles.map((role) => String(role || "").trim()).map(normalizeChip).filter(Boolean).filter(isShortChip).slice(0, 4);
    return roleFallback.map((label) => ({ label }));
  };
  const skills = resumeJson?.skills || {};
  const labelMap = Object.fromEntries(
    (copySeed.skills_subcategory_labels || []).map(({ group, label }) => [group, label])
  );
  const skillGroupDefs = [
    { group_name: labelMap.programming_languages || "Programming Languages", arr: skills.programming_languages },
    { group_name: labelMap.technical || "Technical Skills", arr: skills.technical },
    { group_name: labelMap.tools || "Tools", arr: skills.tools },
    { group_name: labelMap.soft_skills || "Soft Skills", arr: skills.soft_skills },
    { group_name: labelMap.other || "Other", arr: skills.other }
  ];
  const skill_groups = skillGroupDefs.filter((g) => Array.isArray(g.arr) && g.arr.length).map((g) => ({ group_name: g.group_name, skills: g.arr }));
  const charCount = (arr) => arr.reduce((n, s) => n + String(s).length, 0);
  const highlightBullets = copySeed.highlights?.length ? copySeed.highlights.slice(0, 4) : (resumeJson?.experience || []).map((e) => (e.bullets || [])[0]).filter(Boolean).slice(0, 3);
  const HERO_CARD_MAX = 4;
  const strengths = (copySeed.strengths_snapshot?.length ? copySeed.strengths_snapshot : strategy?.editorial_direction?.strengths_to_emphasize || []).slice(0, 4);
  const desiredRoles = (resumeJson?.desired_roles?.length ? resumeJson.desired_roles : strategy?.desired_roles?.length ? strategy.desired_roles : resumeStrategy?.desired_roles || []).slice(0, 3);
  const open_to_items = buildOpenToItems(openToRaw, desiredRoles);
  const open_to_display = open_to_items.map((item) => item.label).join(" \u2022 ");
  const openToResolved = open_to_items.length ? open_to_display : "";
  const normalizedOpenToText = `${openToRaw} ${open_to_items.map((item) => item.label).join(" ")}`.toLowerCase();
  const status_badges = (copySeed.status_badges || []).map((label) => String(label || "").trim()).filter(Boolean).filter((label, idx, arr) => arr.findIndex((v) => v.toLowerCase() === label.toLowerCase()) === idx).filter((label) => !/^(seeking|open to|available|based in|located in)\b/i.test(label)).filter((label) => {
    const lc = label.toLowerCase();
    return !normalizedOpenToText || !normalizedOpenToText.includes(lc);
  }).map((label) => ({ label }));
  const status_badges_inline = status_badges.map((item) => item.label).join(" \u2022 ");
  let hero_cards;
  if (heroCardMap && heroCardMap.length) {
    let skillGroupIdx = 0;
    hero_cards = heroCardMap.map((entry) => {
      const label = entry.display_label || entry.original_label || "";
      switch (entry.type) {
        case "highlights":
          return {
            group_name: label,
            card_label: label,
            skills: [],
            highlights: highlightBullets,
            is_highlights: true,
            _size: charCount(highlightBullets)
          };
        case "snapshot":
          return {
            group_name: label,
            card_label: label,
            skills: [],
            snapshot: strengths,
            is_snapshot: true,
            _size: charCount(strengths)
          };
        case "links":
          return { group_name: label, card_label: label, skills: [], is_links: true, _size: 30 };
        case "skill_group": {
          const g = skill_groups[skillGroupIdx++];
          if (!g) return null;
          const skills2 = g.skills.slice(0, HERO_CARD_MAX);
          return { ...g, card_label: label || g.group_name, skills: skills2, _size: charCount(skills2) };
        }
        default:
          return null;
      }
    }).filter(Boolean);
  } else {
    hero_cards = [
      {
        group_name: "Highlights",
        card_label: "Highlights",
        skills: [],
        highlights: highlightBullets,
        is_highlights: true,
        _size: charCount(highlightBullets)
      },
      ...strengths.length ? [{
        group_name: "Strengths Snapshot",
        card_label: "Strengths Snapshot",
        skills: [],
        snapshot: strengths,
        is_snapshot: true,
        _size: charCount(strengths)
      }] : [],
      { group_name: "Links", card_label: "Links", skills: [], is_links: true, _size: 30 }
    ];
  }
  const leadership = [
    ...(resumeJson?.volunteer || []).map((v) => ({ role: v.role, organization: v.organization, dates: v.dates, description: v.description })),
    ...(resumeJson?.extracurricular || []).map((e) => ({ role: e.role, organization: e.organization, dates: e.dates, description: e.description }))
  ].filter((l) => l.role && l.organization || l.description);
  const tp = colorSpec?.primary || "#2563eb";
  const ts = colorSpec?.secondary || "#22c55e";
  const td = colorSpec?.dark || "#0f172a";
  return {
    // ── Theme colors ──
    theme_primary: tp,
    theme_secondary: ts,
    theme_dark: td,
    name: personal.name || "",
    first_name: (personal.name || "").split(" ")[0] || "",
    last_name: (personal.name || "").split(" ").slice(1).join(" ") || "",
    headline: pos.headline || "",
    subheadline: pos.subheadline || "",
    value_proposition: pos.value_proposition || "",
    about: trimAboutToLength(resumeJson?.summary || _coreStory || "", aboutWordCount),
    email: personal.email || "",
    phone: personal.phone || "",
    linkedin: personal.linkedin || "",
    github: personal.github || "",
    website: personal.website || "",
    location: personal.location || "",
    major: edu0.major || "",
    graduation_date: edu0.graduation_date || "",
    specialization: edu0.minor || edu0.major || "",
    current_year: (/* @__PURE__ */ new Date()).getFullYear(),
    desired_roles: desiredRoles,
    desired_role: desiredRoles[0] || "",
    open_to: openToResolved,
    open_to_display,
    open_to_items,
    has_open_to: open_to_items.length > 0,
    has_open_to_items: open_to_items.length > 0,
    status_badges,
    status_badges_inline,
    has_status_badges: status_badges.length > 0,
    has_status_badges_inline: status_badges.length > 0,
    has_github: !!personal.github,
    has_linkedin: !!personal.linkedin,
    has_website: !!personal.website,
    has_phone: !!personal.phone,
    experience: (resumeJson?.experience || []).map((e) => ({
      title: e.title || "",
      company: e.company || "",
      start_date: e.start_date || "",
      end_date: e.end_date || "Present",
      location: e.location || "",
      description: (e.bullets || [])[0] || "",
      bullets: e.bullets || [],
      technologies: e.technologies || []
    })),
    projects: assignProjectIcons(resumeJson?.projects || [], resumeJson).map((p) => ({
      name: p.name || "",
      description: p.description || "",
      role: p.role || "",
      dates: p.dates || "",
      bullets: p.bullets || [],
      technologies: p.technologies || [],
      github_link: p.links?.github || "",
      demo_link: p.links?.demo || "",
      project_icon: p.project_icon || "\u{1F52D}"
    })),
    education: (resumeJson?.education || []).map((e) => ({
      institution: e.institution || "",
      degree: e.degree || "",
      major: e.major || "",
      graduation_date: e.graduation_date || "",
      gpa: e.gpa || "",
      honors: e.honors || "",
      activities: e.activities || []
    })),
    skill_groups,
    hero_cards,
    has_certifications: (resumeJson?.certifications || []).length > 0,
    has_publications: (resumeJson?.publications || []).length > 0,
    has_leadership: leadership.length > 0,
    // Fall back to motifs.resume_keywords (already sorted by pertinence) when no explicit interests listed.
    professional_interests: resumeJson?.professional_interests?.length ? resumeJson.professional_interests : (resumeStrategy?.motifs?.resume_keywords || []).slice(0, 6),
    has_professional_interests: !!(resumeJson?.professional_interests?.length || (resumeStrategy?.motifs?.resume_keywords || []).length),
    certifications: (resumeJson?.certifications || []).map((c) => ({
      name: c.name || "",
      issuer: c.issuer || "",
      date: c.date || ""
    })),
    publications: (resumeJson?.publications || []).map((p) => ({
      title: p.title || "",
      venue: p.venue || "",
      date: p.date || "",
      link: p.link || ""
    })),
    leadership
  };
}
async function callAI(provider, creds, { system, userText, pdfBuffer, maxTokens = 8e3 }) {
  if (provider === "openai") {
    const { openaiClient } = creds;
    if (pdfBuffer) {
      const uploadedFile = await openaiClient.files.create({
        file: await (0, import_openai.toFile)(pdfBuffer, "resume.pdf", { type: "application/pdf" }),
        purpose: "user_data"
      });
      try {
        const r2 = await openaiClient.responses.create({
          model: "gpt-4o",
          ...system ? { instructions: system } : {},
          input: [{ role: "user", content: [
            { type: "input_file", file_id: uploadedFile.id },
            { type: "input_text", text: userText }
          ] }],
          max_output_tokens: maxTokens
        });
        const usage2 = { input: r2.usage?.input_tokens ?? null, output: r2.usage?.output_tokens ?? null };
        return { text: r2.output_text, model: r2.model || "gpt-4o", truncated: r2.incomplete_details?.reason === "max_output_tokens", usage: usage2 };
      } finally {
        openaiClient.files.del(uploadedFile.id).catch(() => {
        });
      }
    }
    const r = await openaiClient.responses.create({
      model: "gpt-4o",
      ...system ? { instructions: system } : {},
      input: [{ role: "user", content: [{ type: "input_text", text: userText }] }],
      max_output_tokens: maxTokens
    });
    const usage = { input: r.usage?.input_tokens ?? null, output: r.usage?.output_tokens ?? null };
    return { text: r.output_text, model: r.model || "gpt-4o", truncated: r.incomplete_details?.reason === "max_output_tokens", usage };
  } else {
    const claudeModel = "claude-sonnet-4-6";
    const userContent = pdfBuffer ? [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBuffer.toString("base64") } },
      { type: "text", text: userText }
    ] : [{ type: "text", text: userText }];
    const reqBody = { model: claudeModel, max_tokens: maxTokens, messages: [{ role: "user", content: userContent }] };
    if (system) reqBody.system = system;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": creds.claudeKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(6e5)
      // 10 minutes max per AI call
    });
    const json = await res.json();
    if (!res.ok) throw new Error("Claude API error: " + (json.error?.message || JSON.stringify(json).slice(0, 200)));
    const text = (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const usage = { input: json.usage?.input_tokens ?? null, output: json.usage?.output_tokens ?? null };
    return { text, model: json.model || claudeModel, truncated: json.stop_reason === "max_tokens", usage };
  }
}
async function unifyResumeAndJobAnalyses(provider, creds, store, jobId, {
  pdfBuffer,
  resumeAnalysisJson,
  jobAdJson = null
}) {
  const tokenReport = [];
  let resumeJson = resumeAnalysisJson;
  if (!resumeJson) {
    await store.set(jobId, JSON.stringify({
      status: "pending",
      stage: "Extracting resume content (1/2)\u2026"
    }), { ttl: 3600 });
    const r1 = await callAI(provider, creds, { userText: STAGE1_PROMPT, pdfBuffer, maxTokens: 8e3 });
    tokenReport.push({ stage: "1a \xB7 Resume extract", model: r1.model, ...r1.usage });
    const stage1Json = parseJsonResponse(r1.text);
    const r2 = await callAI(provider, creds, {
      userText: `${STAGE2_PROMPT}

JSON to validate:
${JSON.stringify(stage1Json, null, 2)}`,
      maxTokens: 8e3
    });
    tokenReport.push({ stage: "1b \xB7 Resume validate", model: r2.model, ...r2.usage });
    resumeJson = parseJsonResponse(r2.text);
  }
  const jobResolved = jobAdJson?.job_resolved ?? null;
  await store.set(jobId, JSON.stringify({
    status: "done",
    strategy_json: jobResolved,
    // job_resolved IS the resolved strategy
    resume_json: resumeJson,
    // full object with resume_facts + resume_strategy + resume_resolved
    token_report: tokenReport
  }), { ttl: 3600 });
}
async function runPortfolioWebsitePipeline(provider, creds, store, jobId, opts) {
  const {
    page1,
    page2,
    pdfBuffer,
    sampleHtml,
    theme,
    headshotName,
    resumeAnalysisJson,
    templateAnalysisJson,
    templateHtml,
    artifactsData = [],
    strategyJson = null,
    // pre-computed by unifyResumeAndJobAnalyses — skips Stage 2
    bridgeJson = null
    // pre-computed by bridgeContentAndDesign mode — skips Stage 3
  } = opts;
  const tokenReport = [];
  const isDesignOptionsMode = (page1?.template_source || "").toLowerCase() === "none";
  const totalStages = isDesignOptionsMode ? 3 : 4;
  let resumeJson = resumeAnalysisJson;
  if (!resumeJson) {
    await store.set(jobId, JSON.stringify({
      status: "pending",
      stage: `Extracting resume content (1/${totalStages})\u2026`
    }), { ttl: 3600 });
    const r1 = await callAI(provider, creds, { userText: STAGE1_PROMPT, pdfBuffer, maxTokens: 8e3 });
    tokenReport.push({ stage: "1a \xB7 Resume extract", model: r1.model, ...r1.usage });
    const stage1Json = parseJsonResponse(r1.text);
    const r2 = await callAI(provider, creds, {
      userText: `${STAGE2_PROMPT}

JSON to validate:
${JSON.stringify(stage1Json, null, 2)}`,
      maxTokens: 8e3
    });
    tokenReport.push({ stage: "1b \xB7 Resume validate", model: r2.model, ...r2.usage });
    resumeJson = parseJsonResponse(r2.text);
  }
  const resumeFacts = resumeJson?.resume_facts ?? resumeJson;
  const resumeStrategy = resumeJson?.resume_strategy ?? null;
  let aiStrategy;
  if (strategyJson) {
    aiStrategy = strategyJson;
  } else if (resumeJson?.resume_resolved) {
    aiStrategy = resumeJson.resume_resolved;
  } else {
    await store.set(jobId, JSON.stringify({
      status: "pending",
      stage: `Content strategy (2/${totalStages})\u2026`
    }), { ttl: 3600 });
    const contentPrompt = loadPromptFile("buildContentStrategy.md").replace("{{RESUME_STRATEGY_JSON}}", JSON.stringify(resumeStrategy, null, 2)).replace("{{JOB_STRATEGY_JSON}}", JSON.stringify(null, null, 2)).replace("{{RESUME_FACTS_JSON}}", JSON.stringify(resumeFacts, null, 2));
    const contentResponse = await callAI(provider, creds, { userText: contentPrompt, maxTokens: 8e3 });
    tokenReport.push({ stage: "2 \xB7 Content strategy (legacy)", model: contentResponse.model, ...contentResponse.usage });
    const legacyResult = parseJsonResponse(contentResponse.text);
    aiStrategy = legacyResult.unified_strategy ?? legacyResult.strategy ?? legacyResult;
  }
  const coreContent = {
    strategy: aiStrategy,
    source_facts: {
      identity: resumeFacts.identity ?? {},
      ...resumeFacts.factual_profile ?? {}
    }
  };
  if (isDesignOptionsMode) {
    await store.set(jobId, JSON.stringify({
      status: "pending",
      stage: `Generating portfolio website (3/${totalStages})\u2026`
    }), { ttl: 3600 });
    const candidateName2 = coreContent.source_facts?.identity?.name || "";
    const headshotHint2 = headshotName ? `provided \u2014 use <img src='${headshotName}' alt='${candidateName2}'>` : `not provided \u2014 render a CSS monogram using the initials of "${candidateName2}"`;
    const directDesignSpec = {
      composition: page1?.design_composition || "",
      style: page1?.design_style || "",
      render_mode: page1?.design_render_mode || "",
      density: page1?.design_density || "medium",
      use_emoji_icons: page1?.use_emoji_icons ?? true,
      alternate_sections: page1?.alternate_sections ?? true
    };
    const directColorSpec = { ...theme, use_sample_colors: false };
    const directPrompt = loadPromptFile("renderFromDesignSpec.md").replace(/\{\{MAJOR\}\}/g, page1?.major || "").replace(/\{\{SPECIALIZATION\}\}/g, page1?.specialization || "").replace(/\{\{RESUME_FACTS_JSON\}\}/g, JSON.stringify(resumeFacts, null, 2)).replace(/\{\{RESOLVED_STRATEGY_JSON\}\}/g, JSON.stringify(aiStrategy, null, 2)).replace(/\{\{DESIGN_SPEC_JSON\}\}/g, JSON.stringify(directDesignSpec, null, 2)).replace(/\{\{COLOR_SPEC_JSON\}\}/g, JSON.stringify(directColorSpec, null, 2)).replace(/\{\{HEADSHOT\}\}/g, headshotHint2).replace(/\{\{YEAR\}\}/g, (/* @__PURE__ */ new Date()).getFullYear().toString());
    const directSystem = "You are an HTML code generator for a legitimate professional portfolio website builder service. Output exactly one complete HTML file starting with <!DOCTYPE html>. Do not output markdown, explanations, or commentary.";
    const directResponse = await callAI(provider, creds, {
      system: directSystem,
      userText: directPrompt,
      maxTokens: 32e3
    });
    tokenReport.push({ stage: "3 \xB7 Direct renderer", model: directResponse.model, ...directResponse.usage });
    const siteHtml2 = cleanHtml(directResponse.text);
    if (!/<[a-z]/i.test(siteHtml2)) {
      let reason;
      if (!directResponse.text?.trim()) {
        reason = "The AI returned an empty response. This is usually a transient error \u2014 please resubmit.";
      } else if (directResponse.truncated) {
        reason = "The AI's output was cut off before any HTML was produced (token limit reached). Try a shorter job description or fewer visuals, then resubmit.";
      } else {
        reason = `The AI did not return valid HTML. Raw output started with: "${directResponse.text?.slice(0, 120)}"`;
      }
      await store.set(jobId, JSON.stringify({ status: "error", error: reason }), { ttl: 3600 });
      return;
    }
    await store.set(jobId, JSON.stringify({
      status: "done",
      model: directResponse.model,
      site_html: siteHtml2,
      resume_json: resumeJson,
      strategy_json: coreContent.strategy,
      visual_direction_json: directDesignSpec,
      truncated: directResponse.truncated,
      token_report: tokenReport
    }), { ttl: 3600 });
    await logUsageEvent(opts.userId, {
      event_type: "generation",
      provider: opts.provider || "claude",
      model: directResponse.model,
      success: true
    });
    return;
  }
  await store.set(jobId, JSON.stringify({
    status: "pending",
    stage: "Assembling visual direction (3/4)\u2026"
  }), { ttl: 3600 });
  const colorSpec = page2?.use_sample_colors ? { use_sample_colors: true, note: "Preserve the template's exact color scheme." } : { ...theme, use_sample_colors: false };
  const COLORIZABLE_TYPES = /* @__PURE__ */ new Set(["image", "html", "text"]);
  const userArtifacts = (artifactsData || []).map((a) => ({
    ...a,
    source: "user",
    colorized: COLORIZABLE_TYPES.has((a.type || "").toLowerCase())
  }));
  const designSpec = {
    ...templateAnalysisJson || {},
    ...page1.design_density !== void 0 && { density: page1.design_density },
    ...page1.use_emoji_icons !== void 0 && { use_emoji_icons: page1.use_emoji_icons },
    ...page1.alternate_sections !== void 0 && { alternate_sections: page1.alternate_sections }
  };
  const blendResult = bridgeJson?.visual_direction ? { visual_direction: bridgeJson.visual_direction } : buildVisualDirection(resumeStrategy?.motifs ?? {}, designSpec, colorSpec, userArtifacts);
  await store.set(jobId, JSON.stringify({
    status: "pending",
    stage: "Merging artifacts (3/4)\u2026"
  }), { ttl: 3600 });
  const templateVisuals = templateAnalysisJson?.visual_elements;
  const templateImageArtifacts = (templateVisuals?.images || []).map((img) => ({
    type: "image",
    label: img.src_file_name || img.role || "template image",
    content: img.src_file_name || "",
    tagline: img.role || "",
    selector: img.selector || "",
    source: "example website",
    colorized: false
  }));
  const templateAnimationArtifacts = (templateVisuals?.animations || []).map((anim) => ({
    type: "animation",
    label: anim.src_file_name || anim.name || "template animation",
    content: anim.src_file_name || "",
    tagline: anim.name || "",
    selector: anim.selector || "",
    source: "example website",
    colorized: false
  }));
  const artifactsJson = [...userArtifacts, ...templateImageArtifacts, ...templateAnimationArtifacts];
  const candidateName = coreContent.source_facts?.identity?.name || "";
  const headshotHint = headshotName ? `provided \u2014 use <img src='${headshotName}' alt='${candidateName}'>` : `not provided \u2014 render a CSS monogram using the initials of "${candidateName}"`;
  const contentJson = {
    strategy: coreContent.strategy,
    source_facts: coreContent.source_facts,
    value_propositions: resumeStrategy?.website_copy_seed?.value_propositions || [],
    candidate_name: candidateName || "UNKNOWN \u2014 check source_facts.identity.name"
  };
  await store.set(jobId, JSON.stringify({
    status: "pending",
    stage: "Generating portfolio website (4/4)\u2026"
  }), { ttl: 3600 });
  const rendererSampleHtml = stripGrapesJsCss(templateHtml || sampleHtml || "(No sample website provided)");
  let siteHtml, usedModel, truncated;
  if (isMustacheTemplate(rendererSampleHtml)) {
    const templateMeta = parseTemplateMetadata(rendererSampleHtml);
    const aboutWordCount = templateMeta.about_word_count || 0;
    let heroCardMap = templateMeta.hero_card_map || null;
    if (!heroCardMap && Array.isArray(templateMeta.hero_card_types)) {
      const DEFAULT_LABELS = { highlights: "Highlights", snapshot: "Strengths Snapshot", links: "Links" };
      const skillGroupCount = Math.max(0, Number(templateMeta.hero_card_skill_groups) || 0);
      const legacyTypes = [
        ...Array.from({ length: skillGroupCount }, () => "skill_group"),
        ...templateMeta.hero_card_types
      ];
      heroCardMap = legacyTypes.map((type) => ({
        original_label: type,
        type,
        display_label: DEFAULT_LABELS[type] || ""
      }));
    }
    const mustacheData = flattenToMustacheData(
      coreContent.strategy,
      toFlatResumeSchema(resumeFacts),
      colorSpec,
      resumeStrategy,
      aboutWordCount,
      heroCardMap
    );
    siteHtml = cleanHtml(renderMustache(rendererSampleHtml, fixMojibakeDeep(mustacheData)));
    siteHtml = injectCssColors(siteHtml, colorSpec, rendererSampleHtml);
    usedModel = "mustache";
    truncated = false;
    tokenReport.push({ stage: "5 \xB7 Renderer", model: "mustache (no AI call)", input: 0, output: 0 });
  } else {
    const rendererPrompt = loadPromptFile("rendererPrompt.md").replace("{{CONTENT_JSON}}", JSON.stringify(contentJson, null, 2)).replace("{{VISUAL_DIRECTION}}", JSON.stringify(blendResult.visual_direction, null, 2)).replace("{{VISUALS_JSON}}", JSON.stringify(artifactsJson, null, 2)).replace("{{SAMPLE_HTML}}", rendererSampleHtml).replace("{{HEADSHOT}}", headshotHint).replace("{{TEMPLATE_USAGE}}", templateUsageInstruction(page1.template_copyright_mode)).replace("{{YEAR}}", (/* @__PURE__ */ new Date()).getFullYear().toString());
    const rendererSystem = "You are an HTML code generator for a legitimate professional portfolio website builder service. Your sole task is to output a single complete HTML file as requested. This is a standard web development task. Output only raw HTML starting with <!DOCTYPE html> \u2014 no explanations, no refusals, no markdown, no commentary of any kind.";
    const rendererResponse = await callAI(provider, creds, {
      system: rendererSystem,
      userText: "Generate the portfolio HTML file per the spec below.\n\n" + rendererPrompt,
      maxTokens: 32e3
    });
    tokenReport.push({ stage: "5 \xB7 Renderer", model: rendererResponse.model, ...rendererResponse.usage });
    siteHtml = cleanHtml(rendererResponse.text);
    usedModel = rendererResponse.model;
    truncated = rendererResponse.truncated;
    if (!/<[a-z]/i.test(siteHtml)) {
      let reason;
      if (!rendererResponse.text?.trim()) {
        reason = "The AI returned an empty response. This is usually a transient error \u2014 please resubmit.";
      } else if (rendererResponse.truncated) {
        reason = "The AI's output was cut off before any HTML was produced (token limit reached). Try a shorter job description or fewer visuals, then resubmit.";
      } else {
        reason = `The AI did not return valid HTML. Raw output started with: "${rendererResponse.text?.slice(0, 120)}"`;
      }
      await store.set(jobId, JSON.stringify({ status: "error", error: reason }), { ttl: 3600 });
      return;
    }
  }
  await store.set(jobId, JSON.stringify({
    status: "done",
    model: usedModel,
    site_html: siteHtml,
    resume_json: resumeJson,
    strategy_json: coreContent.strategy,
    visual_direction_json: blendResult.visual_direction,
    truncated,
    token_report: tokenReport
  }), { ttl: 3600 });
  await logUsageEvent(opts.userId, {
    event_type: "generation",
    provider: opts.provider || "claude",
    model: usedModel,
    success: true
  });
}
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
      page1 = {},
      page2 = {},
      page3 = {},
      artifactsData = [],
      resumePdfBase64 = "",
      headshotName = "",
      resumeAnalysisJson = null,
      templateAnalysisJson = null,
      templateHtml = null,
      mode = "full",
      // "full" | "analyzeJob" | "extractJobAd" | "bridgeContentAndDesign"
      strategyJson = null,
      // pre-computed strategy from analyzeJob mode
      bridgeJson = null,
      // pre-computed visual_direction from bridgeContentAndDesign mode
      provider = "claude",
      // "claude" (default) | "openai"
      userId = null
      // Supabase user UUID — sent by client when logged in
    } = body;
    if (mode === "full") {
      if (!userId) {
        await logAnonUsage();
      } else {
        const quota = await checkAndIncrementCredits(userId);
        if (!quota.allowed) {
          await store.set(jobId, JSON.stringify({ status: "error", error: quota.reason, quota: true, tier: quota.tier, used: quota.used, limit: quota.limit }), { ttl: 3600 });
          return { statusCode: 202 };
        }
      }
    }
    if (mode === "analyzeJob") {
      if (!resumePdfBase64 && !resumeAnalysisJson) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "Resume PDF or pre-computed analysis required." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
    } else if (mode !== "bridgeContentAndDesign" && mode !== "extractJobAd") {
      if (!resumePdfBase64) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "Resume PDF is required." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
    }
    let creds;
    if (provider === "openai") {
      const openaiKey = process.env.OPENAI_API_KEY_LOCAL || process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "OPENAI_API_KEY is not set." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      creds = { openaiClient: new import_openai.default({ apiKey: openaiKey, baseURL: "https://api.openai.com/v1" }) };
    } else {
      const claudeKey = process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY;
      if (!claudeKey) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "ANTHROPIC_API_KEY is not set." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      creds = { claudeKey };
    }
    if (mode === "extractJobAd") {
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
      const rawJobAd = body.jobAdText || "";
      if (!rawJobAd.trim()) {
        await store.set(jobId, JSON.stringify({ status: "done", job_ad: null }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      const resumeStrategy = body.resumeStrategy || null;
      const resumeFacts = body.resumeFacts || null;
      const prompt = loadPromptFile("extractJobAdInfo.md").replace("{{RESUME_STRATEGY_JSON}}", JSON.stringify(resumeStrategy, null, 2)).replace("{{RESUME_FACTS_JSON}}", JSON.stringify(resumeFacts, null, 2)).replace("{{JOB_AD}}", rawJobAd);
      let r;
      try {
        r = await callAI(provider, creds, { userText: prompt, maxTokens: 8e3 });
      } catch (aiErr) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "Job extraction AI error: " + (aiErr?.message || String(aiErr)) }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      let parsed = null;
      try {
        parsed = parseJsonResponse(r.text);
      } catch {
      }
      const jobResolved = parsed?.job_resolved ?? parsed ?? null;
      await store.set(jobId, JSON.stringify({
        status: jobResolved ? "done" : "error",
        job_resolved: jobResolved,
        error: jobResolved ? void 0 : "Job extraction returned no valid JSON. Raw: " + (r.text || "").slice(0, 300),
        model: r.model,
        token_report: [{ stage: "2a \xB7 Job ad extract", model: r.model, ...r.usage }]
      }), { ttl: 3600 });
      await logUsageEvent(userId, {
        event_type: "job_analysis",
        provider,
        model: r.model,
        success: !!jobResolved
      });
      return { statusCode: 202 };
    }
    if (mode === "bridgeContentAndDesign") {
      const templateHtmlInput = body.templateHtml || "";
      const contentJson = body.contentJson || body.strategyJson || null;
      const colorSpec = body.colorSpec || {};
      const templateMode = body.templateMode || "none";
      const bridgePrompt = loadPromptFile("bridgeContentAndDesign.md").replace("{{CONTENT_JSON}}", JSON.stringify(contentJson, null, 2)).replace("{{COLOR_SPEC_JSON}}", JSON.stringify(colorSpec, null, 2)).replace("{{TEMPLATE_MODE}}", templateMode).replace("{{EXAMPLE_WEBSITE}}", templateHtmlInput);
      const r = await callAI(provider, creds, { userText: bridgePrompt, maxTokens: 2e4 });
      let bridge_json = null;
      let bridge_parse_error = null;
      try {
        bridge_json = parseJsonResponse(r.text);
      } catch (e) {
        bridge_parse_error = e?.message || "parse failed";
      }
      await store.set(jobId, JSON.stringify({
        status: "done",
        bridge_json,
        model: r.model,
        token_report: [{ stage: "4 \xB7 Bridge", model: r.model, ...r.usage }],
        ...bridge_json ? {} : { bridge_raw: r.text?.slice(0, 2e3), bridge_parse_error }
      }), { ttl: 3600 });
      return { statusCode: 202 };
    }
    if (mode === "analyzeJob") {
      const pdfBuf = resumePdfBase64 ? Buffer.from(resumePdfBase64, "base64") : null;
      await unifyResumeAndJobAnalyses(provider, creds, store, jobId, {
        pdfBuffer: pdfBuf,
        resumeAnalysisJson,
        jobAdJson: body.jobAdJson || null
      });
      return { statusCode: 202 };
    }
    const theme = {
      primary: page2?.theme?.primary || "#4E70F1",
      secondary: page2?.theme?.secondary || "#FBAB9C",
      accent: page2?.theme?.accent || "#8DE0FF",
      dark: page2?.theme?.dark || "#0b1220",
      light: page2?.theme?.light || "#eaf0ff"
    };
    const sampleHtml = await fetchSampleHtml(page1.model_template);
    const pdfBuffer = Buffer.from(resumePdfBase64, "base64");
    await runPortfolioWebsitePipeline(provider, creds, store, jobId, {
      page1,
      page2,
      page3,
      pdfBuffer,
      sampleHtml,
      theme,
      headshotName,
      resumeAnalysisJson,
      templateAnalysisJson,
      templateHtml,
      artifactsData,
      strategyJson,
      bridgeJson,
      userId,
      provider
    });
  } catch (err) {
    const msg = explainBlobStoreError(err);
    console.error("buildWebsite-background error:", msg, err?.stack);
    if (store) {
      try {
        await store.set(jobId, JSON.stringify({ status: "error", error: msg }), { ttl: 3600 });
      } catch (blobErr) {
        console.error("Failed to write error to blob:", blobErr?.message);
      }
    }
    return { statusCode: 202, body: JSON.stringify({ error: msg }) };
  }
  return { statusCode: 202 };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=buildWebsite-background.js.map
