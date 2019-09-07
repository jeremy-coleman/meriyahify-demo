
'use strict';
import fs from 'fs';
import { createServer } from 'http';
import net from 'net';
import { networkInterfaces } from 'os';
import { join, resolve } from 'path';
import { format } from 'url';
import mime from './mimes/mime';

const { HOST, PORT } = process.env;
const hostname = 'localhost';
const port = process.env.PORT || 8080;



const { FORCE_COLOR, NODE_DISABLE_COLORS, TERM } = process.env;

interface Color {
	(x: string | number): string;
	(): Kleur;
}
interface Kleur {
	// Colors
	black: Color;
	red: Color;
	green: Color;
	yellow: Color;
	blue: Color;
	magenta: Color;
	cyan: Color;
	white: Color;
	gray: Color;
	grey: Color;

	// Backgrounds
	bgBlack: Color;
	bgRed: Color;
	bgGreen: Color;
	bgYellow: Color;
	bgBlue: Color;
	bgMagenta: Color;
	bgCyan: Color;
	bgWhite: Color;

	// Modifiers
	reset: Color;
	bold: Color;
	dim: Color;
	italic: Color;
	underline: Color;
	inverse: Color;
	hidden: Color;
	strikethrough: Color;
}


const kluer = {
	enabled: !NODE_DISABLE_COLORS && TERM !== 'dumb' && FORCE_COLOR !== '0',

	// modifiers
	reset: init(0, 0),
	bold: init(1, 22),
	dim: init(2, 22),
	italic: init(3, 23),
	underline: init(4, 24),
	inverse: init(7, 27),
	hidden: init(8, 28),
	strikethrough: init(9, 29),

	// colors
	black: init(30, 39),
	red: init(31, 39),
	green: init(32, 39),
	yellow: init(33, 39),
	blue: init(34, 39),
	magenta: init(35, 39),
	cyan: init(36, 39),
	white: init(37, 39),
	gray: init(90, 39),
	grey: init(90, 39),

	// background colors
	bgBlack: init(40, 49),
	bgRed: init(41, 49),
	bgGreen: init(42, 49),
	bgYellow: init(43, 49),
	bgBlue: init(44, 49),
	bgMagenta: init(45, 49),
	bgCyan: init(46, 49),
	bgWhite: init(47, 49)
};

function run(arr, str) {
	let i=0, tmp, beg='', end='';
	for (; i < arr.length; i++) {
		tmp = arr[i];
		beg += tmp.open;
		end += tmp.close;
		if (str.includes(tmp.close)) {
			str = str.replace(tmp.rgx, tmp.close + tmp.open);
		}
	}
	return beg + str + end;
}

function chain(has, keys) {
	//@ts-ignore
	let ctx: Kleur = { has, keys };

	ctx.reset = kluer.reset.bind(ctx);
	ctx.bold = kluer.bold.bind(ctx);
	ctx.dim = kluer.dim.bind(ctx);
	ctx.italic = kluer.italic.bind(ctx);
	ctx.underline = kluer.underline.bind(ctx);
	ctx.inverse = kluer.inverse.bind(ctx);
	ctx.hidden = kluer.hidden.bind(ctx);
	ctx.strikethrough = kluer.strikethrough.bind(ctx);

	ctx.black = kluer.black.bind(ctx);
	ctx.red = kluer.red.bind(ctx);
	ctx.green = kluer.green.bind(ctx);
	ctx.yellow = kluer.yellow.bind(ctx);
	ctx.blue = kluer.blue.bind(ctx);
	ctx.magenta = kluer.magenta.bind(ctx);
	ctx.cyan = kluer.cyan.bind(ctx);
	ctx.white = kluer.white.bind(ctx);
	ctx.gray = kluer.gray.bind(ctx);
	ctx.grey = kluer.grey.bind(ctx);

	ctx.bgBlack = kluer.bgBlack.bind(ctx);
	ctx.bgRed = kluer.bgRed.bind(ctx);
	ctx.bgGreen = kluer.bgGreen.bind(ctx);
	ctx.bgYellow = kluer.bgYellow.bind(ctx);
	ctx.bgBlue = kluer.bgBlue.bind(ctx);
	ctx.bgMagenta = kluer.bgMagenta.bind(ctx);
	ctx.bgCyan = kluer.bgCyan.bind(ctx);
	ctx.bgWhite = kluer.bgWhite.bind(ctx);

	return ctx;
}

function init(open, close) {
	let blk = {
		open: `\x1b[${open}m`,
		close: `\x1b[${close}m`,
		rgx: new RegExp(`\\x1b\\[${close}m`, 'g')
	};
	return function (txt?) {
		if (this !== void 0 && this.has !== void 0) {
			this.has.includes(open) || (this.has.push(open),this.keys.push(blk));
			return txt === void 0 ? this : kluer.enabled ? run(this.keys, txt+'') : txt+'';
		}
		return txt === void 0 ? chain([open], [blk]) : kluer.enabled ? run([blk], txt+'') : txt+'';
	};
}

var colors = kluer;

function parser(req) {
	let url = req.url;
	if (url === void 0) return url;

	let obj = req._parsedUrl;
	if (obj && obj._raw === url) return obj;

	obj = {};
	obj.query = obj.search = null;
	obj.href = obj.path = obj.pathname = url;

	let idx = url.indexOf('?', 1);
	if (idx !== -1) {
		obj.search = url.substring(idx);
		obj.query = obj.search.substring(1);
		obj.pathname = url.substring(0, idx);
	}

	obj._raw = url;

	return (req._parsedUrl = obj);
}

const FILES = {};
const noop = () => {};

function toAssume(uri, extns) {
	let i=0, x, len=uri.length - 1;
	if (uri.charCodeAt(len) === 47) {
		uri = uri.substring(0, len);
	}

	let arr=[], tmp=`${uri}/index`;
	for (; i < extns.length; i++) {
		x = '.' + extns[i];
		if (uri) arr.push(uri + x);
		arr.push(tmp + x);
	}

	return arr;
}

function find(uri, extns) {
	let i=0, data, arr=toAssume(uri, extns);
	for (; i < arr.length; i++) {
		if (data = FILES[arr[i]]) return data;
	}
}

function is404(req, res) {
	return (res.statusCode=404,res.end());
}

function list(dir, fn, pre='') {
	let i=0, abs, stats;
	let arr = fs.readdirSync(dir);
	for (; i < arr.length; i++) {
		abs = join(dir, arr[i]);
		stats = fs.statSync(abs);
		stats.isDirectory()
			? list(abs, fn, join(pre, arr[i]))
			: fn(join(pre, arr[i]), abs, stats);
	}
}

function send(req, res, file, stats, headers={}) {
	let code=200, opts: any={};

	if (req.headers.range) {
		code = 206;
		let [x, y] = req.headers.range.replace('bytes=', '').split('-');
		let end = opts.end = parseInt(y, 10) || stats.size - 1;
		let start = opts.start = parseInt(x, 10) || 0;

		if (start >= stats.size || end >= stats.size) {
			res.setHeader('Content-Range', `bytes */${stats.size}`);
			res.statusCode = 416;
			return res.end();
		}

		headers['Content-Range'] = `bytes ${start}-${end}/${stats.size}`;
		headers['Content-Length'] = (end - start + 1);
		headers['Accept-Ranges'] = 'bytes';
	}

	res.writeHead(code, headers);
	fs.createReadStream(file, opts).pipe(res);
}

function sirv(dir, opts:any={}) {
	dir = resolve(dir || '.');

	let isNotFound = opts.onNoMatch || is404;
	let extensions = opts.extensions || ['html', 'htm'];
	let setHeaders = opts.setHeaders || noop;

	if (opts.dev) {
		return function (req, res, next) {
			let stats, file, uri=decodeURIComponent(req.path || req.pathname || parser(req).pathname);
			let arr = [uri].concat(toAssume(uri, extensions)).map(x => join(dir, x)).filter(fs.existsSync);
			while (file = arr.shift()) {
				stats = fs.statSync(file);
				if (stats.isDirectory()) continue;
				setHeaders(res, uri, stats);
				return send(req, res, file, stats, {
					'Content-Type': mime.getType(file),
					'Last-Modified': stats.mtime.toUTCString(),
					'Content-Length': stats.size,
				});
			}
			return next ? next() : isNotFound(req, res);
		}
	}

	let cc = opts.maxAge != null && `public,max-age=${opts.maxAge}`;
	if (cc && opts.immutable) cc += ',immutable';

	list(dir, (name, abs, stats) => {
		if (!opts.dotfiles && name.charAt(0) === '.') {
			return;
		}

		let headers = {
			'Content-Length': stats.size,
			'Content-Type': mime.getType(name),
			'Last-Modified': stats.mtime.toUTCString(),
		};

		if (cc) headers['Cache-Control'] = cc;
		if (opts.etag) headers['ETag'] = `W/"${stats.size}-${stats.mtime.getTime()}"`;

		FILES['/' + name.replace(/\\+/g, '/')] = { abs, stats, headers };
	});

	return function (req, res, next) {
		let pathname = decodeURIComponent(req.path || req.pathname || parser(req).pathname);
		let data = FILES[pathname] || find(pathname, extensions);
		if (!data) return next ? next() : isNotFound(req, res);

		setHeaders(res, pathname, data.stats);
		send(req, res, data.abs, data.stats, data.headers);
	};
}







const clearConsole = function (isSoft) {
	process.stdout.write(
		isSoft ? '\x1B[H\x1B[2J' : '\x1B[2J\x1B[3J\x1B[H\x1Bc'
	);
}


const getAvailablePort = options => new Promise((resolve, reject) => {
	const server = net.createServer();
	server.unref();
	server.on('error', reject);
	server.listen(options, () => {
		//@ts-ignore
		const {port} = server.address();
		server.close(() => {
			resolve(port);
		});
	});
});

const portCheckSequence = function * (ports) {
	if (ports) {
		yield * ports;
	}

	yield 0; // Fall back to 0 if anything else failed
};

const getPort = async options => {
	let ports = null;

	if (options) {
		ports = typeof options.port === 'number' ? [options.port] : options.port;
	}

	for (const port of portCheckSequence(ports)) {
		try {
			return await getAvailablePort({...options, port}); // eslint-disable-line no-await-in-loop
		} catch (error) {
			if (error.code !== 'EADDRINUSE') {
				throw error;
			}
		}
	}

	throw new Error('No available ports found');
};

getPort.makeRange = (from, to) => {
	if (!Number.isInteger(from) || !Number.isInteger(to)) {
		throw new TypeError('`from` and `to` must be integer numbers');
	}

	if (from < 1024 || from > 65535) {
		throw new RangeError('`from` must be between 1024 and 65535');
	}

	if (to < 1024 || to > 65536) {
		throw new RangeError('`to` must be between 1024 and 65536');
	}

	if (to < from) {
		throw new RangeError('`to` must be greater than or equal to `from`');
	}

	const generator = function * (from, to) {
		for (let port = from; port <= to; port++) {
			yield port;
		}
	};

	return generator(from, to);
};



const PAD = '  ';
const stamp = tinydate('{HH}:{mm}:{ss}');
var RGX = /([^{]*?)\w(?=\})/g;

var MAP = {
	YYYY: 'getFullYear',
	YY: 'getYear',
	MM: function (d) {
		return d.getMonth() + 1;
	},
	DD: 'getDate',
	HH: 'getHours',
	mm: 'getMinutes',
	ss: 'getSeconds',
	fff: 'getMilliseconds'
};

export function tinydate(str, custom?) {
	var parts=[], offset=0;

	str.replace(RGX, function (key, _, idx) {
		// save preceding string
		parts.push(str.substring(offset, idx - 1));
		offset = idx += key.length + 1;
		// save function
		parts.push(custom && custom[key] || function (d) {
			return ('00' + (typeof MAP[key] === 'string' ? d[MAP[key]]() : MAP[key](d))).slice(-key.length);
		});
	});

	if (offset !== str.length) {
		parts.push(str.substring(offset));
	}

	return function (arg?) {
		var out='', i=0, d=arg||new Date();
		for (; i<parts.length; i++) {
			out += (typeof parts[i]==='string') ? parts[i] : parts[i](d);
		}
		return out;
	};
}

function isLAN(obj) {
	return obj.family === 'IPv4' && !obj.internal;
}

function access (opts) {
	opts = Object.assign({ hostname, port, https:false }, opts);
	opts.protocol = opts.https ? 'https' : 'http';
	let local = format(opts);

	let k, tmp;
	let nets = networkInterfaces();
	for (k in nets) {
		if (tmp=nets[k].find(isLAN)) {
			opts.hostname = tmp.address; // network IP
			break;
		}
	}

	let network = format(opts);
	return { local, network };
}

function toTime() {
	return '[' + colors.magenta(stamp()) + '] ';
}

function toMS(arr) {
	return colors.gray().bold(`${(arr[1] / 1e6).toFixed(2)}ms`);
}

function toCode(code) {
	let fn = code >= 400 ? 'red' : code > 300 ? 'yellow' : 'green';
	return colors[fn](code);
}

function createSirver(dir, opts:any = {}) {
	let fn;
	dir = resolve(dir || '.');
	//opts.maxAge = opts.m;

	if (opts.cors) {
		opts.setHeaders = res => {
			res.setHeader('Access-Control-Allow-Origin', '*');
			res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, Range');
		}
	}

	if (opts.single) {
		opts.onNoMatch = (req, res) => (req.path='/',fn(req, res, () => (res.statusCode=404,res.end())));
	}

	fn = sirv(dir, opts);
	let server = createServer(fn);
	let { hrtime, stdout } = process;

	if (!opts.quiet) {
		let uri, dur, start, dash=colors.white(' ─ ');
		server.on('request', (req, res) => {
			start = hrtime();
			req.once('end', _ => {
				dur = hrtime(start);
				uri = req.originalUrl || req.url;
				stdout.write(PAD + toTime() + toCode(res.statusCode) + dash + toMS(dur) + dash + uri + '\n');
			});
		});
	}

	opts.port = PORT || opts.port;
	getPort(opts.port).then(port => {
		let https = !!opts.ssl; // TODO
		let isOther = port != opts.port;
		let hostname = HOST || opts.host || 'localhost';

		// @ts-ignore
		server.listen(port, hostname, err => {
			if (err) throw err;
			if (opts.quiet) return;

			clearConsole(true); // wipe screen, but not history
			let { local, network } = access({ port, hostname, https });
			stdout.write('\n' + PAD + colors.green('Your application is ready~! 🚀\n\n'));
			isOther && stdout.write(PAD + colors.italic().dim(`➡ Port ${opts.port} is taken; using ${port} instead\n\n`));
			stdout.write(PAD + `${colors.bold('- Local:')}      ${local}\n`);
			/localhost/i.test(hostname) || stdout.write(PAD + `${colors.bold('- Network:')}    ${network}\n`);
			let border = '─'.repeat(Math.min(stdout.columns, 36) / 2);
			stdout.write('\n' + border + colors.inverse(' LOGS ') + border + '\n\n');
		});
	});
}

export { createSirver };

//module.exports = sirv