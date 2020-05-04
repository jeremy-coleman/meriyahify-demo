import fs from 'fs';
import { resolve, join } from 'path';


// function Mime() {
//   this._types = Object.create(null);
//   this._extensions = Object.create(null);

//   for (var i = 0; i < arguments.length; i++) {
//     this.define(arguments[i]);
//   }

//   this.define = this.define.bind(this);
//   this.getType = this.getType.bind(this);
//   this.getExtension = this.getExtension.bind(this);
// }

function Mime(...mimeDefinitionArray) {
  this._types = Object.create(null);
  this._extensions = Object.create(null);

  for (var i = 0; i < mimeDefinitionArray.length; i++) {
    this.define(mimeDefinitionArray[i]);
  }

  this.define = this.define.bind(this);
  this.getType = this.getType.bind(this);
  this.getExtension = this.getExtension.bind(this);
}


Mime.prototype.define = function(typeMap, force) {
  for (var type in typeMap) {
    var extensions = typeMap[type].map(function(t) {return t.toLowerCase()});
    type = type.toLowerCase();

    for (var i = 0; i < extensions.length; i++) {
      var ext = extensions[i];

      // '*' prefix = not the preferred type for this extension.  So fixup the
      // extension, and skip it.
      if (ext[0] == '*') {
        continue;
      }

      if (!force && (ext in this._types)) {
        throw new Error(
          'Attempt to change mapping for "' + ext +
          '" extension from "' + this._types[ext] + '" to "' + type +
          '". Pass `force=true` to allow this, otherwise remove "' + ext +
          '" from the list of extensions for "' + type + '".'
        );
      }

      this._types[ext] = type;
    }

    // Use first extension as default
    if (force || !this._extensions[type]) {
      var ext = extensions[0];
      this._extensions[type] = (ext[0] != '*') ? ext : ext.substr(1);
    }
  }
};

/**
 * Lookup a mime type based on extension
 */
Mime.prototype.getType = function(path) {
  path = String(path);
  var last = path.replace(/^.*[/\\]/, '').toLowerCase();
  var ext = last.replace(/^.*\./, '').toLowerCase();

  var hasPath = last.length < path.length;
  var hasDot = ext.length < last.length - 1;

  return (hasDot || !hasPath) && this._types[ext] || null;
};

/**
 * Return file extension associated with a mime type
 */
Mime.prototype.getExtension = function(type) {
  type = /^\s*([^;\s]*)/.test(type) && RegExp.$1;
  return type && this._extensions[type.toLowerCase()] || null;
};

var mime = new Mime(require('./mime_standard.js'));

const FILES = {};
const noop = () => {};

/* -------------------------------------------------------------------------- */
/*                                 @polka/url                                 */
/* -------------------------------------------------------------------------- */

function parser(req) {
  let url = req.url;
  if (url === void 0) return url;

  let obj = req._parsedUrl;
  if (obj && obj._raw === url) return obj;

  obj = {};
  obj.query = obj.search = null;
  obj.href = obj.path = obj.pathname = url;

  let idx = url.indexOf("?", 1);
  if (idx !== -1) {
    obj.search = url.substring(idx);
    obj.query = obj.search.substring(1);
    obj.pathname = url.substring(0, idx);
  }

  obj._raw = url;

  return (req._parsedUrl = obj);
}

function toAssume(uri, extns) {
  let i = 0,
    x,
    len = uri.length - 1;
  if (uri.charCodeAt(len) === 47) {
    uri = uri.substring(0, len);
  }

  let arr = [],
    tmp = `${uri}/index`;
  for (; i < extns.length; i++) {
    x = "." + extns[i];
    if (uri) arr.push(uri + x);
    arr.push(tmp + x);
  }

  return arr;
}

function find(uri, extns) {
  let i = 0,
    data,
    arr = toAssume(uri, extns);
  for (; i < arr.length; i++) {
    if ((data = FILES[arr[i]])) return data;
  }
}

function is404(req, res) {
  return (res.statusCode = 404), res.end();
}

function list(dir, fn, pre = "") {
  let i = 0,
    abs,
    stats;
  let arr = fs.readdirSync(dir);
  for (; i < arr.length; i++) {
    abs = join(dir, arr[i]);
    stats = fs.statSync(abs);
    stats.isDirectory() ? list(abs, fn, join(pre, arr[i])) : fn(join(pre, arr[i]), abs, stats);
  }
}


type SendOptions = Partial<{
  start: any,
  end: any
}>

function send(req, res, file, stats, headers = {}) {
  let code = 200
  let opts: SendOptions = {};

  if (req.headers.range) {
    code = 206;
    let [x, y] = req.headers.range.replace("bytes=", "").split("-");
    let end = (opts.end = parseInt(y, 10) || stats.size - 1);
    let start = (opts.start = parseInt(x, 10) || 0);

    if (start >= stats.size || end >= stats.size) {
      res.setHeader("Content-Range", `bytes */${stats.size}`);
      res.statusCode = 416;
      return res.end();
    }

    headers["Content-Range"] = `bytes ${start}-${end}/${stats.size}`;
    headers["Content-Length"] = end - start + 1;
    headers["Accept-Ranges"] = "bytes";
  }

  res.writeHead(code, headers);
  fs.createReadStream(file, opts).pipe(res);
}

/* -------------------------------------------------------------------------- */
/*                                    sirv                                    */
/* -------------------------------------------------------------------------- */


type SirvOptions = Partial<{
  onNoMatch: typeof is404,
  extensions: string[]
  setHeaders: any,
  dev: boolean,
  maxAge: number,
  immutable:boolean,
  dotfiles: boolean,
  etag: any,
}>

function sirv(dir, opts: SirvOptions = {}) {
  dir = resolve(dir || ".");

  let isNotFound = opts.onNoMatch || is404;
  let extensions = opts.extensions || ["html", "htm"];
  let setHeaders = opts.setHeaders || noop;

  if (opts.dev) {
    return function(req, res, next) {
      let stats,
        file,
        uri = decodeURIComponent(req.path || req.pathname || parser(req).pathname);
      let arr = [uri]
        .concat(toAssume(uri, extensions))
        .map(x => join(dir, x))
        .filter(fs.existsSync);
      while ((file = arr.shift())) {
        stats = fs.statSync(file);
        if (stats.isDirectory()) continue;
        setHeaders(res, uri, stats);
        return send(req, res, file, stats, {
          "Content-Type": mime.getType(file),
          "Last-Modified": stats.mtime.toUTCString(),
          "Content-Length": stats.size
        });
      }
      return next ? next() : isNotFound(req, res);
    };
  }

  let cc = opts.maxAge != null && `public,max-age=${opts.maxAge}`;
  if (cc && opts.immutable) cc += ",immutable";

  list(dir, (name, abs, stats) => {
    if (!opts.dotfiles && name.charAt(0) === ".") {
      return;
    }

    let headers = {
      "Content-Length": stats.size,
      "Content-Type": mime.getType(name),
      "Last-Modified": stats.mtime.toUTCString()
    };

    if (cc) headers["Cache-Control"] = cc;
    if (opts.etag) headers["ETag"] = `W/"${stats.size}-${stats.mtime.getTime()}"`;

    FILES["/" + name.replace(/\\+/g, "/")] = { abs, stats, headers };
  });

  return function(req, res, next) {
    let pathname = decodeURIComponent(req.path || req.pathname || parser(req).pathname);
    let data = FILES[pathname] || find(pathname, extensions);
    if (!data) return next ? next() : isNotFound(req, res);

    setHeaders(res, pathname, data.stats);
    send(req, res, data.abs, data.stats, data.headers);
  };
}

export { sirv };
