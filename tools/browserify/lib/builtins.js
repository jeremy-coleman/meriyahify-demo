exports._process = require.resolve('../compats/process.js');
exports.util = require.resolve('../compats/util.js');
exports.sys = require.resolve('../compats/util.js');
exports.events = require.resolve('../compats/events.js');
exports.assert = require.resolve('../compats/assert.js');

exports.child_process = require.resolve('./_empty.js');
exports.cluster = require.resolve('./_empty.js');
exports.dgram = require.resolve('./_empty.js');
exports.dns = require.resolve('./_empty.js');
exports.fs = require.resolve('./_empty.js');
exports.http2 = require.resolve('./_empty.js');
exports.inspector = require.resolve('./_empty.js');
exports.module = require.resolve('./_empty.js');
exports.net = require.resolve('./_empty.js');
exports.perf_hooks = require.resolve('./_empty.js')
exports.readline = require.resolve('./_empty.js');
exports.repl = require.resolve('./_empty.js');
exports.tls = require.resolve('./_empty.js');
exports.console = require.resolve('./_empty.js');
exports.http = require.resolve('./_empty.js');
exports.http2 = require.resolve('./_empty.js');
exports.string_decoder = require.resolve('./_empty.js');
exports.buffer = require.resolve('./_empty.js');


// exports.http = require.resolve('stream-http');
// exports.https = require.resolve('https-browserify');
// exports.string_decoder = require.resolve('string_decoder/');
// exports.buffer = require.resolve('buffer/');

//exports.console = require.resolve('console-browserify');

// exports.util = require.resolve('util/util.js');
// exports.sys = require.resolve('util/util.js');


// exports.constants = require.resolve('constants-browserify');
// exports.crypto = require.resolve('crypto-browserify');
// exports.domain = require.resolve('domain-browser');


// exports.os = require.resolve('os-browserify/browser.js');
// exports.path = require.resolve('path-browserify');
// exports.punycode = require.resolve('punycode/');
// exports.querystring = require.resolve('querystring-es3/');
// exports.stream = require.resolve('stream-browserify');
// exports._stream_duplex = require.resolve('readable-stream/duplex.js');
// exports._stream_passthrough = require.resolve('readable-stream/passthrough.js');
// exports._stream_readable = require.resolve('readable-stream/readable.js');
// exports._stream_transform = require.resolve('readable-stream/transform.js');
// exports._stream_writable = require.resolve('readable-stream/writable.js');

// exports.timers = require.resolve('timers-browserify');
// exports.tty = require.resolve('tty-browserify');
// exports.url = require.resolve('url/');
// exports.vm = require.resolve('vm-browserify');
// exports.zlib = require.resolve('browserify-zlib');