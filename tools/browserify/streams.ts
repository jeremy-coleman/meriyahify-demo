import { Duplex, PassThrough, Readable, Transform, Writable , Stream} from "stream";
import { inherits } from "util";

import assert from "assert";

var nextTick =
  typeof setImmediate !== "undefined" ? setImmediate : process.nextTick;
/* -------------------------------------------------------------------------- */
/*                            LabeledStreamSplicer                            */
/* -------------------------------------------------------------------------- */
inherits(Splicer, Duplex);
function Splicer(streams, opts) {
  //@ts-ignore
  if (!(this instanceof Splicer)) return new Splicer(streams, opts);
  if (!opts && !Array.isArray(streams)) {
    opts = streams;
    streams = [];
  }
  if (!streams) streams = [];
  if (!opts) opts = {};
  Duplex.call(this, opts);
  var self = this;
  this._options = opts;
  this._wrapOptions = { objectMode: opts.objectMode !== false };
  this._streams = [];
  this.splice.apply(this, [0, 0].concat(streams));
  this.once("finish", function () {
    self._notEmpty();
    self._streams[0].end();
  });
}

Splicer.prototype._read = function () {
  var self = this;
  this._notEmpty();

  var r = this._streams[this._streams.length - 1];
  var buf,
    reads = 0;
  while ((buf = r.read()) !== null) {
    Duplex.prototype.push.call(this, buf);
    reads++;
  }
  if (reads === 0) {
    var onreadable = function () {
      r.removeListener("readable", onreadable);
      self.removeListener("_mutate", onreadable);
      self._read();
    };
    r.once("readable", onreadable);
    self.once("_mutate", onreadable);
  }
};

Splicer.prototype._write = function (buf, enc, next) {
  this._notEmpty();
  this._streams[0]._write(buf, enc, next);
};

Splicer.prototype._notEmpty = function () {
  var self = this;
  if (this._streams.length > 0) return;
  var stream = new PassThrough(this._options);
  stream.once("end", function () {
    var ix = self._streams.indexOf(stream);
    if (ix >= 0 && ix === self._streams.length - 1) {
      Duplex.prototype.push.call(self, null);
    }
  });
  this._streams.push(stream);
  this.length = this._streams.length;
};

Splicer.prototype.push = function (stream) {
  var args = [this._streams.length, 0].concat([].slice.call(arguments));
  this.splice.apply(this, args);
  return this._streams.length;
};

Splicer.prototype.pop = function () {
  return this.splice(this._streams.length - 1, 1)[0];
};

Splicer.prototype.shift = function () {
  return this.splice(0, 1)[0];
};

Splicer.prototype.unshift = function () {
  this.splice.apply(this, [0, 0].concat([].slice.call(arguments)));
  return this._streams.length;
};

Splicer.prototype.splice = function (start, removeLen) {
  var self = this;
  var len = this._streams.length;
  start = start < 0 ? len - start : start;
  if (removeLen === undefined) removeLen = len - start;
  removeLen = Math.max(0, Math.min(len - start, removeLen));

  for (var i = start; i < start + removeLen; i++) {
    if (self._streams[i - 1]) {
      self._streams[i - 1].unpipe(self._streams[i]);
    }
  }
  if (self._streams[i - 1] && self._streams[i]) {
    self._streams[i - 1].unpipe(self._streams[i]);
  }
  var end = i;

  var reps = [],
    args = arguments;
  for (var j = 2; j < args.length; j++)
    (function (stream) {
      if (Array.isArray(stream)) {
        //@ts-ignore
        stream = new Splicer(stream, self._options);
      }
      stream.on("error", function (err) {
        err.stream = this;
        self.emit("error", err);
      });
      stream = self._wrapStream(stream);
      stream.once("end", function () {
        var ix = self._streams.indexOf(stream);
        if (ix >= 0 && ix === self._streams.length - 1) {
          Duplex.prototype.push.call(self, null);
        }
      });
      reps.push(stream);
    })(arguments[j]);

  //@ts-ignore
  for (var i = 0; i < reps.length - 1; i++) {
    reps[i].pipe(reps[i + 1]);
  }

  if (reps.length && self._streams[end]) {
    reps[reps.length - 1].pipe(self._streams[end]);
  }
  if (reps[0] && self._streams[start - 1]) {
    self._streams[start - 1].pipe(reps[0]);
  }

  var sargs = [start, removeLen].concat(reps);
  var removed = self._streams.splice.apply(self._streams, sargs);

  //@ts-ignore
  for (var i = 0; i < reps.length; i++) {
    reps[i].read(0);
  }

  this.emit("_mutate");
  this.length = this._streams.length;
  return removed;
};

Splicer.prototype.get = function () {
  if (arguments.length === 0) return undefined;

  var base = this;
  for (var i = 0; i < arguments.length; i++) {
    var index = arguments[i];
    if (index < 0) {
      base = base._streams[base._streams.length + index];
    } else {
      base = base._streams[index];
    }
    if (!base) return undefined;
  }
  return base;
};

Splicer.prototype.indexOf = function (stream) {
  return this._streams.indexOf(stream);
};

Splicer.prototype._wrapStream = function (stream) {
  if (typeof stream.read === "function") return stream;
  var w = new Readable(this._wrapOptions).wrap(stream);
  //@ts-ignore
  w._write = function (buf, enc, next) {
    if (stream.write(buf) === false) {
      stream.once("drain", next);
    } else nextTick(next);
  };
  return w;
};

Splicer.obj = function (streams, opts) {
  if (!opts && !Array.isArray(streams)) {
    opts = streams;
    streams = [];
  }
  if (!streams) streams = [];
  if (!opts) opts = {};
  opts.objectMode = true;
  //@ts-ignore
  return new Splicer(streams, opts);
};

inherits(Labeled, Splicer);
function Labeled(streams, opts) {
  //@ts-ignore
  if (!(this instanceof Labeled)) return new Labeled(streams, opts);

  Splicer.call(this, [], opts);

  var reps = [];
  for (var i = 0; i < streams.length; i++) {
    var s = streams[i];
    if (typeof s === "string") continue;
    if (Array.isArray(s)) {
      //@ts-ignore
      s = new Labeled(s, opts);
    }
    if (i >= 0 && typeof streams[i - 1] === "string") {
      s.label = streams[i - 1];
    }
    reps.push(s);
  }
  if (typeof streams[i - 1] === "string") {
    //@ts-ignore
    reps.push(new Labeled([], opts));
  }
  this.splice.apply(this, [0, 0].concat(reps));
}

Labeled.prototype.indexOf = function (stream) {
  if (typeof stream === "string") {
    for (var i = 0; i < this._streams.length; i++) {
      if (this._streams[i].label === stream) return i;
    }
    return -1;
  } else {
    return Splicer.prototype.indexOf.call(this, stream);
  }
};

Labeled.prototype.get = function (key) {
  if (typeof key === "string") {
    var ix = this.indexOf(key);
    if (ix < 0) return undefined;
    return this._streams[ix];
  } else return Splicer.prototype.get.call(this, key);
};

Labeled.prototype.splice = function (key) {
  var ix;
  if (typeof key === "string") {
    ix = this.indexOf(key);
  } else ix = key;
  var args = [ix].concat([].slice.call(arguments, 1));

  return Splicer.prototype.splice.apply(this, args);
};

Labeled.obj = function (streams, opts?) {
  if (!opts) opts = {};
  opts.objectMode = true;
  //@ts-ignore
  return new Labeled(streams, opts);
};

class DestroyableTransform extends Transform {
  _destroyed: boolean;

  constructor(opts) {
    super(opts);
    this._destroyed = false;
  }

  destroy = function (err) {
    if (this._destroyed) return;
    this._destroyed = true;
    var self = this;
    process.nextTick(function () {
      if (err) self.emit("error", err);
      self.emit("close");
    });
  };
}

// a noop _transform function
function noop(chunk, enc, callback) {
  callback(null, chunk);
}

function create(construct) {
  return function (options?, transform?, flush?) {
    if (typeof options == "function") {
      flush = transform;
      transform = options;
      options = {};
    }

    if (typeof transform != "function") transform = noop;

    if (typeof flush != "function") flush = null;

    return construct(options, transform, flush);
  };
}

// main export, just make me a transform stream!
var _throughText = create(function (options, transform, flush) {
  var t2 = new DestroyableTransform(options);

  t2._transform = transform;

  if (flush) t2._flush = flush;

  return t2;
});

// make me a reusable prototype that I can `new`, or implicitly `new`
// with a constructor call

// through.ctor = create(function (options, transform, flush) {
//   function create (override) {
//     if (!(this instanceof Through2))
//       return new Through2(override)

//     this.options = Object.assign({}, options, override)

//     DestroyableTransform.call(this, this.options)
//   }

//   inherits(Through2, DestroyableTransform)

//   Through2.prototype._transform = transform

//   if (flush)
//     Through2.prototype._flush = flush

//   return Through2
// })

// //@ts-ignore
// through.obj = create(function (options, transform, flush) {
//   var t2 = new DestroyableTransform(Object.assign({ objectMode: true, highWaterMark: 16 }, options))

//   t2._transform = transform

//   if (flush)
//     t2._flush = flush

//   return t2
// })

let _throughObj = {
  obj: create(function (options, transform, flush) {
    var t2 = new DestroyableTransform(
      Object.assign({ objectMode: true, highWaterMark: 16 }, options)
    );

    t2._transform = transform;

    if (flush) t2._flush = flush;

    return t2;
  }),
};

let through = Object.assign(_throughText, _throughObj);
/* -------------------------------------------------------------------------- */
/*                                ConcatStream                                */
/* -------------------------------------------------------------------------- */

class ConcatStream extends Writable {
  encoding: any;
  shouldInferEncoding: boolean;
  body: any[];
  constructor(opts, cb) {
    super(opts);
    if (!(this instanceof ConcatStream)) return new ConcatStream(opts, cb);

    if (typeof opts === "function") {
      cb = opts;
      opts = {};
    }
    if (!opts) opts = {};

    var encoding = opts.encoding;
    var shouldInferEncoding = false;

    if (!encoding) {
      shouldInferEncoding = true;
    } else {
      encoding = String(encoding).toLowerCase();
      if (encoding === "u8" || encoding === "uint8") {
        encoding = "uint8array";
      }
    }

    Writable.call(this, { objectMode: true });

    this.encoding = encoding;
    this.shouldInferEncoding = shouldInferEncoding;

    if (cb)
      this.on("finish", function () {
        cb(this.getBody());
      });
    this.body = [];
  }

  _write = function (chunk, enc, next) {
    this.body.push(chunk);
    next();
  };

  inferEncoding = function (buff) {
    var firstBuffer = buff === undefined ? this.body[0] : buff;
    if (Buffer.isBuffer(firstBuffer)) return "buffer";
    if (typeof Uint8Array !== "undefined" && firstBuffer instanceof Uint8Array)
      return "uint8array";
    if (Array.isArray(firstBuffer)) return "array";
    if (typeof firstBuffer === "string") return "string";
    if (Object.prototype.toString.call(firstBuffer) === "[object Object]")
      return "object";
    return "buffer";
  };

  getBody = function () {
    if (!this.encoding && this.body.length === 0) return [];
    if (this.shouldInferEncoding) this.encoding = this.inferEncoding();
    if (this.encoding === "array") return arrayConcat(this.body);
    if (this.encoding === "string") return stringConcat(this.body);
    if (this.encoding === "buffer") return bufferConcat(this.body);
    if (this.encoding === "uint8array") return u8Concat(this.body);
    return this.body;
  };
}

const concat = (opts, cb?) => new ConcatStream(opts, cb);

var isArray =
  Array.isArray ||
  function (arr) {
    return Object.prototype.toString.call(arr) == "[object Array]";
  };

function isArrayish(arr) {
  return /Array\]$/.test(Object.prototype.toString.call(arr));
}

function isBufferish(p) {
  return (
    typeof p === "string" ||
    isArrayish(p) ||
    (p && typeof p.subarray === "function")
  );
}

function stringConcat(parts) {
  var strings = [];
  var needsToString = false;
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (typeof p === "string") {
      strings.push(p);
    } else if (Buffer.isBuffer(p)) {
      strings.push(p);
    } else if (isBufferish(p)) {
      strings.push(Buffer.from(p));
    } else {
      strings.push(Buffer.from(String(p)));
    }
  }
  if (Buffer.isBuffer(parts[0])) {
    //@ts-ignore
    strings = Buffer.concat(strings);
    //@ts-ignore
    strings = strings.toString("utf8");
  } else {
    //@ts-ignore
    strings = strings.join("");
  }
  return strings;
}

function bufferConcat(parts) {
  var bufs = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (Buffer.isBuffer(p)) {
      bufs.push(p);
    } else if (isBufferish(p)) {
      bufs.push(Buffer.from(p));
    } else {
      bufs.push(Buffer.from(String(p)));
    }
  }
  return Buffer.concat(bufs);
}

function arrayConcat(parts) {
  var res = [];
  for (var i = 0; i < parts.length; i++) {
    res.push.apply(res, parts[i]);
  }
  return res;
}

function u8Concat(parts) {
  var len = 0;
  for (var i = 0; i < parts.length; i++) {
    if (typeof parts[i] === "string") {
      parts[i] = Buffer.from(parts[i]);
    }
    len += parts[i].length;
  }
  var u8 = new Uint8Array(len);
  for (var i = 0, offset = 0; i < parts.length; i++) {
    var part = parts[i];
    for (var j = 0; j < part.length; j++) {
      u8[offset++] = part[j];
    }
  }
  return u8;
}

/* -------------------------------------------------------------------------- */
/*                                  readonly                                  */
/* -------------------------------------------------------------------------- */

function ReadOnlyStream(stream) {
  var opts = stream._readableState;
  if (typeof stream.read !== "function") {
    stream = new Readable(opts).wrap(stream);
  }

  var ro = new Readable({ objectMode: opts && opts.objectMode });
  var waiting = false;

  stream.on("readable", function () {
    if (waiting) {
      waiting = false;
      //@ts-ignore
      ro._read();
    }
  });

  ro._read = function () {
    var buf,
      reads = 0;
    while ((buf = stream.read()) !== null) {
      ro.push(buf);
      reads++;
    }
    if (reads === 0) waiting = true;
  };
  stream.once("end", function () {
    ro.push(null);
  });
  stream.on("error", function (err) {
    ro.emit("error", err);
  });
  return ro;
}

function StreamCombiner() {
  var streams;
  if (arguments.length == 1 && Array.isArray(arguments[0])) {
    streams = arguments[0];
  } else {
    streams = [].slice.call(arguments);
  }
  return combine(streams);
}

StreamCombiner.obj = function () {
  var streams;
  if (arguments.length == 1 && Array.isArray(arguments[0])) {
    streams = arguments[0];
  } else {
    streams = [].slice.call(arguments);
  }
  return combine(streams, { objectMode: true });
};

function combine(streams, opts?) {
  for (var i = 0; i < streams.length; i++) streams[i] = wrap(streams[i], opts);

  if (streams.length == 0) return new PassThrough(opts);
  else if (streams.length == 1) return streams[0];

  var first = streams[0],
    last = streams[streams.length - 1],
    thepipe = duplexer(opts, first, last);

  //pipe all the streams together

  function recurse(streams) {
    if (streams.length < 2) return;
    streams[0].pipe(streams[1]);
    recurse(streams.slice(1));
  }

  recurse(streams);

  function onerror() {
    var args = [].slice.call(arguments);
    args.unshift("error");
    thepipe.emit.apply(thepipe, args);
  }

  //es.duplex already reemits the error from the first and last stream.
  //add a listener for the inner streams in the pipeline.
  for (var i = 1; i < streams.length - 1; i++) streams[i].on("error", onerror);

  return thepipe;
}

function wrap(tr, opts) {
  if (typeof tr.read === "function") return tr;
  return new Readable(opts).wrap(tr);
}

/* -------------------------------------------------------------------------- */
/*                                  duplexer2                                 */
/* -------------------------------------------------------------------------- */

function DuplexWrapper(options, writable, readable) {
  if (typeof readable === "undefined") {
    readable = writable;
    writable = options;
    options = null;
  }

  Duplex.call(this, options);

  if (typeof readable.read !== "function") {
    readable = new Readable(options).wrap(readable);
  }

  this._writable = writable;
  this._readable = readable;
  this._waiting = false;

  var self = this;

  writable.once("finish", function () {
    self.end();
  });

  this.once("finish", function () {
    writable.end();
  });

  readable.on("readable", function () {
    if (self._waiting) {
      self._waiting = false;
      self._read();
    }
  });

  readable.once("end", function () {
    self.push(null);
  });

  if (
    !options ||
    typeof options.bubbleErrors === "undefined" ||
    options.bubbleErrors
  ) {
    writable.on("error", function (err) {
      self.emit("error", err);
    });

    readable.on("error", function (err) {
      self.emit("error", err);
    });
  }
}

DuplexWrapper.prototype = Object.create(Duplex.prototype, {
  constructor: { value: DuplexWrapper },
});

DuplexWrapper.prototype._write = function _write(input, encoding, done) {
  this._writable.write(input, encoding, done);
};

DuplexWrapper.prototype._read = function _read() {
  var buf;
  var reads = 0;
  while ((buf = this._readable.read()) !== null) {
    this.push(buf);
    reads++;
  }
  if (reads === 0) {
    this._waiting = true;
  }
};

function duplex2(options?, writable?, readable?) {
  return new DuplexWrapper(options, writable, readable);
}

duplex2.DuplexWrapper = DuplexWrapper;

var duplexer = duplex2;

function SinkStream(opts, tr) {
  if (typeof opts === "function") {
    tr = opts;
    opts = {};
  }
  var sink;
  var done;
  if (typeof tr !== "function") {
    tr = function (bufs, next) {
      this.push(bufs);
      next();
    };
  }

  function write(buf, enc, next) {
    if (!sink) {
      sink = new ConcatStream(opts, function (data) {
        tr.call(stream, data, done);
      });
    }
    sink.write(buf);
    next();
  }
  function end(next) {
    if (!sink) {
      return next();
    }
    done = next;
    sink.end();
  }

  var stream = new Transform({ objectMode: true });
  stream._transform = write;
  stream._flush = end;
  return stream;
}

SinkStream.obj = function (tr) {
  return SinkStream({ encoding: "object" }, tr);
};
SinkStream.str = function (tr) {
  return SinkStream({ encoding: "string" }, tr);
};

/** dont confuse with stream combine */
function combiner(...args) {
  var streams;

  if (arguments.length == 1 && Array.isArray(arguments[0])) {
    streams = arguments[0];
  } else {
    streams = [].slice.call(arguments);
  }

  if (streams.length == 0) return through();
  else if (streams.length == 1) return streams[0];

  var first = streams[0],
    last = streams[streams.length - 1],
    thepipe = duplexer(first, last);

  //pipe all the streams together

  function recurse(streams) {
    if (streams.length < 2) return;
    streams[0].pipe(streams[1]);
    recurse(streams.slice(1));
  }

  recurse(streams);

  function onerror() {
    var args = [].slice.call(arguments);
    args.unshift("error");
    thepipe.emit.apply(thepipe, args);
  }
  for (var i = 1; i < streams.length - 1; i++) streams[i].on("error", onerror);

  return thepipe;
}

function mergeStreams(...streamz) {
  var sources = [];
  var output = new PassThrough({ objectMode: true });

  output.setMaxListeners(0);
  //@ts-ignore
  output.add = add;
  //@ts-ignore
  output.isEmpty = isEmpty;

  output.on("unpipe", remove);

  Array.prototype.slice.call(arguments).forEach(add);

  return output;

  function add(source) {
    if (Array.isArray(source)) {
      source.forEach(add);
      return this;
    }

    sources.push(source);
    source.once("end", remove.bind(null, source));
    source.once("error", output.emit.bind(output, "error"));
    source.pipe(output, { end: false });
    return this;
  }

  function isEmpty() {
    return sources.length == 0;
  }

  function remove(source) {
    sources = sources.filter(function (it) {
      return it !== source;
    });
    if (!sources.length && output.readable) {
      output.end();
    }
  }
}

function maybeEmptyObject(opts) {
  opts = opts || {};
  return opts;
}

function From2Ctor(opts?, read?) {
  if (typeof opts === "function") {
    read = opts;
    opts = {};
  }
  opts = maybeEmptyObject(opts);

  inherits(Class, Readable);
  function Class(override) {
    //@ts-ignore
    if (!(this instanceof Class)) return new Class(override);
    this._reading = false;
    this._callback = check;
    this.destroyed = false;
    Readable.call(this, override || opts);

    var self = this;
    var hwm = this._readableState.highWaterMark;

    function check(err, data) {
      if (self.destroyed) return;
      if (err) return self.destroy(err);
      if (data === null) return self.push(null);
      self._reading = false;
      if (self.push(data)) self._read(hwm);
    }
  }
  Class.prototype._from = read || function noop() {};
  Class.prototype._read = function (size) {
    if (this._reading || this.destroyed) return;
    this._reading = true;
    this._from(size, this._callback);
  };
  Class.prototype.destroy = function (err) {
    if (this.destroyed) return;
    this.destroyed = true;
    var self = this;
    process.nextTick(function () {
      if (err) self.emit("error", err);
      self.emit("close");
    });
  };
  return Class;
}

function from2(opts?, read?) {
  function toFunction(list) {
    list = list.slice();
    return function (_, cb) {
      var err = null;
      var item = list.length ? list.shift() : null;
      if (item instanceof Error) {
        err = item;
        item = null;
      }

      cb(err, item);
    };
  }

  if (typeof opts !== "object" || Array.isArray(opts)) {
    read = opts;
    opts = {};
  }
  //@ts-ignore
  var rs = new From2Ctor(opts);
  rs._from = Array.isArray(read) ? toFunction(read) : read || noop;
  return rs;
}

from2.ctor = From2Ctor;

from2.obj = function obj(opts, read) {
  if (typeof opts === "function" || Array.isArray(opts)) {
    read = opts;
    opts = {};
  }

  opts = maybeEmptyObject(opts);
  opts.objectMode = true;
  opts.highWaterMark = 16;

  return from2(opts, read);
};

function fromString(string) {
  assert.equal(typeof string, "string");
  return from2(function (size, next) {
    if (string.length <= 0) return this.push(null);

    const chunk = string.slice(0, size);
    string = string.slice(size);

    next(null, chunk);
  });
}








// through
//
// a stream that does nothing but re-emit the input.
// useful for aggregating a series of changing but not ending streams into one stream)
//create a readable writable stream.

type EasyStream = Stream & {
  [otherstuff:string]: any
}

function throughClassic(write, end, opts) {
  write = write || function (data) { this.queue(data) }
  end = end || function () { this.queue(null) }

  var ended = false, destroyed = false, buffer = [], _ended = false
  var stream: EasyStream = new Stream()
  stream.readable = stream.writable = true
  stream.paused = false

//  stream.autoPause   = !(opts && opts.autoPause   === false)
  stream.autoDestroy = !(opts && opts.autoDestroy === false)

  stream.write = function (data) {
    write.call(this, data)
    return !stream.paused
  }

  function drain() {
    while(buffer.length && !stream.paused) {
      var data = buffer.shift()
      if(null === data)
        return stream.emit('end')
      else
        stream.emit('data', data)
    }
  }

  stream.queue = stream.push = function (data) {
//    console.error(ended)
    if(_ended) return stream
    if(data === null) _ended = true
    buffer.push(data)
    drain()
    return stream
  }

  //this will be registered as the first 'end' listener
  //must call destroy next tick, to make sure we're after any
  //stream piped from here.
  //this is only a problem if end is not emitted synchronously.
  //a nicer way to do this is to make sure this is the last listener for 'end'

  stream.on('end', function () {
    stream.readable = false
    if(!stream.writable && stream.autoDestroy)
      process.nextTick(function () {
        stream.destroy()
      })
  })

  function _end () {
    stream.writable = false
    end.call(stream)
    if(!stream.readable && stream.autoDestroy)
      stream.destroy()
  }

  stream.end = function (data) {
    if(ended) return
    ended = true
    if(arguments.length) stream.write(data)
    _end() // will emit or queue
    return stream
  }

  stream.destroy = function () {
    if(destroyed) return
    destroyed = true
    ended = true
    buffer.length = 0
    stream.writable = stream.readable = false
    stream.emit('close')
    return stream
  }

  stream.pause = function () {
    if(stream.paused) return
    stream.paused = true
    return stream
  }

  stream.resume = function () {
    if(stream.paused) {
      stream.paused = false
      stream.emit('resume')
    }
    drain()
    //may have become paused again,
    //as drain emits 'data'.
    if(!stream.paused)
      stream.emit('drain')
    return stream
  }
  return stream
}


export {
  from2,
  fromString,
  mergeStreams,
  concat,
  combiner,
  SinkStream,
  Splicer as StreamSplicer,
  duplex2,
  StreamCombiner,
  ReadOnlyStream,
  ConcatStream,
  through,
  throughClassic,
  Labeled as LabeledStreamSplicer,
  //aliases
  Labeled as splicer,
  ReadOnlyStream as readonly,
  duplex2 as duplexer,
  StreamCombiner as combine,
};
