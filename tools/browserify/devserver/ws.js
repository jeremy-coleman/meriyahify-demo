'use strict';
import { createHash, randomBytes, randomFillSync } from 'crypto';
import { EventEmitter } from 'events';
import http, { createServer, STATUS_CODES } from 'http';
import https from 'https';
import net from 'net';
import { Writable } from 'stream';
import tls from 'tls';
import url from 'url';
import zlib from 'zlib';
var URL = url.URL;
var constants = {
    BINARY_TYPES: ['nodebuffer', 'arraybuffer', 'fragments'],
    GUID: '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
    kStatusCode: Symbol('status-code'),
    kWebSocket: Symbol('websocket'),
    EMPTY_BUFFER: Buffer.alloc(0),
    NOOP: () => { }
};
const { BINARY_TYPES, EMPTY_BUFFER, GUID, kStatusCode, kWebSocket, NOOP } = constants;
const keyRegex = /^[+/0-9A-Za-z]{22}==$/;
const kUsedByWebSocketServer = Symbol('kUsedByWebSocketServer');
const readyStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
const protocolVersions = [8, 13];
const closeTimeout = 30 * 1000;
const TRAILER = Buffer.from([0x00, 0x00, 0xff, 0xff]);
const EMPTY_BLOCK = Buffer.from([0x00]);
const kPerMessageDeflate = Symbol('permessage-deflate');
const kTotalLength = Symbol('total-length');
const kCallback = Symbol('callback');
const kBuffers = Symbol('buffers');
const kError = Symbol('error');
let zlibLimiter;
const GET_INFO = 0;
const GET_PAYLOAD_LENGTH_16 = 1;
const GET_PAYLOAD_LENGTH_64 = 2;
const GET_MASK = 3;
const GET_DATA = 4;
const INFLATING = 5;
/* -------------------------------------------------------------------------- */
/*                                async limiter                               */
/* -------------------------------------------------------------------------- */
function Limiter(options) {
    //@ts-ignore
    if (!(this instanceof Limiter)) {
        return new Limiter(options);
    }
    options = options || {};
    this.concurrency = options.concurrency || Infinity;
    this.pending = 0;
    this.jobs = [];
    this.cbs = [];
    this._done = done.bind(this);
}
var arrayAddMethods = [
    'push',
    'unshift',
    'splice'
];
arrayAddMethods.forEach(function (method) {
    Limiter.prototype[method] = function () {
        var methodResult = Array.prototype[method].apply(this.jobs, arguments);
        this._run();
        return methodResult;
    };
});
Object.defineProperty(Limiter.prototype, 'length', {
    get: function () {
        return this.pending + this.jobs.length;
    }
});
Limiter.prototype._run = function () {
    if (this.pending === this.concurrency) {
        return;
    }
    if (this.jobs.length) {
        var job = this.jobs.shift();
        this.pending++;
        job(this._done);
        this._run();
    }
    if (this.pending === 0) {
        while (this.cbs.length !== 0) {
            var cb = this.cbs.pop();
            process.nextTick(cb);
        }
    }
};
Limiter.prototype.onDone = function (cb) {
    if (typeof cb === 'function') {
        this.cbs.push(cb);
        this._run();
    }
};
function done() {
    this.pending--;
    this._run();
}
/* -------------------------------------------------------------------------- */
/*                                 validation                                 */
/* -------------------------------------------------------------------------- */
var isValidUTF8 = (...args) => true;
// const isValidUTF8 = require('utf-8-validate');
// isValidUTF8 =
//     typeof isValidUTF8 === 'object'
//         ? isValidUTF8.Validation.isValidUTF8
//         : isValidUTF8;
var isValidStatusCode = (code) => {
    return ((code >= 1000 &&
        code <= 1013 &&
        code !== 1004 &&
        code !== 1005 &&
        code !== 1006) ||
        (code >= 3000 && code <= 4999));
};
/* -------------------------------------------------------------------------- */
/*                                   sender                                   */
/* -------------------------------------------------------------------------- */
const _fallbackMask = Buffer.alloc(4);
class Sender {
    constructor(socket, extensions) {
        this._extensions = extensions || {};
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._deflating = false;
        this._queue = [];
    }
    static frame(data, options) {
        const merge = options.mask && options.readOnly;
        let offset = options.mask ? 6 : 2;
        let payloadLength = data.length;
        if (data.length >= 65536) {
            offset += 8;
            payloadLength = 127;
        }
        else if (data.length > 125) {
            offset += 2;
            payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? data.length + offset : offset);
        target[0] = options.fin ? options.opcode | 0x80 : options.opcode;
        if (options.rsv1)
            target[0] |= 0x40;
        target[1] = payloadLength;
        if (payloadLength === 126) {
            target.writeUInt16BE(data.length, 2);
        }
        else if (payloadLength === 127) {
            target.writeUInt32BE(0, 2);
            target.writeUInt32BE(data.length, 6);
        }
        if (!options.mask)
            return [target, data];
        randomFillSync(_fallbackMask, 0, 4);
        target[1] |= 0x80;
        target[offset - 4] = _fallbackMask[0];
        target[offset - 3] = _fallbackMask[1];
        target[offset - 2] = _fallbackMask[2];
        target[offset - 1] = _fallbackMask[3];
        if (merge) {
            mask(data, _fallbackMask, target, offset, data.length);
            return [target];
        }
        mask(data, _fallbackMask, data, 0, data.length);
        return [target, data];
    }
    close(code, data, mask, cb) {
        let buf;
        if (code === undefined) {
            buf = EMPTY_BUFFER;
        }
        else if (typeof code !== 'number' || !isValidStatusCode(code)) {
            throw new TypeError('First argument must be a valid error code number');
        }
        else if (data === undefined || data === '') {
            buf = Buffer.allocUnsafe(2);
            buf.writeUInt16BE(code, 0);
        }
        else {
            buf = Buffer.allocUnsafe(2 + Buffer.byteLength(data));
            buf.writeUInt16BE(code, 0);
            buf.write(data, 2);
        }
        if (this._deflating) {
            this.enqueue([this.doClose, buf, mask, cb]);
        }
        else {
            this.doClose(buf, mask, cb);
        }
    }
    doClose(data, mask, cb) {
        this.sendFrame(Sender.frame(data, {
            fin: true,
            rsv1: false,
            opcode: 0x08,
            mask,
            readOnly: false
        }), cb);
    }
    ping(data, mask, cb) {
        const buf = toBuffer(data);
        if (this._deflating) {
            this.enqueue([this.doPing, buf, mask, toBuffer.readOnly, cb]);
        }
        else {
            this.doPing(buf, mask, toBuffer.readOnly, cb);
        }
    }
    doPing(data, mask, readOnly, cb) {
        this.sendFrame(Sender.frame(data, {
            fin: true,
            rsv1: false,
            opcode: 0x09,
            mask,
            readOnly
        }), cb);
    }
    pong(data, mask, cb) {
        const buf = toBuffer(data);
        if (this._deflating) {
            this.enqueue([this.doPong, buf, mask, toBuffer.readOnly, cb]);
        }
        else {
            this.doPong(buf, mask, toBuffer.readOnly, cb);
        }
    }
    doPong(data, mask, readOnly, cb) {
        this.sendFrame(Sender.frame(data, {
            fin: true,
            rsv1: false,
            opcode: 0x0a,
            mask,
            readOnly
        }), cb);
    }
    send(data, options, cb) {
        const buf = toBuffer(data);
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        if (this._firstFragment) {
            this._firstFragment = false;
            if (rsv1 && perMessageDeflate) {
                rsv1 = buf.length >= perMessageDeflate._threshold;
            }
            this._compress = rsv1;
        }
        else {
            rsv1 = false;
            opcode = 0;
        }
        if (options.fin)
            this._firstFragment = true;
        if (perMessageDeflate) {
            const opts = {
                fin: options.fin,
                rsv1,
                opcode,
                mask: options.mask,
                readOnly: toBuffer.readOnly
            };
            if (this._deflating) {
                this.enqueue([this.dispatch, buf, this._compress, opts, cb]);
            }
            else {
                this.dispatch(buf, this._compress, opts, cb);
            }
        }
        else {
            this.sendFrame(Sender.frame(buf, {
                fin: options.fin,
                rsv1: false,
                opcode,
                mask: options.mask,
                readOnly: toBuffer.readOnly
            }), cb);
        }
    }
    dispatch(data, compress, options, cb) {
        if (!compress) {
            this.sendFrame(Sender.frame(data, options), cb);
            return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        this._deflating = true;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
            this._deflating = false;
            options.readOnly = false;
            this.sendFrame(Sender.frame(buf, options), cb);
            this.dequeue();
        });
    }
    dequeue() {
        while (!this._deflating && this._queue.length) {
            const params = this._queue.shift();
            this._bufferedBytes -= params[1].length;
            Reflect.apply(params[0], this, params.slice(1));
        }
    }
    enqueue(params) {
        this._bufferedBytes += params[1].length;
        this._queue.push(params);
    }
    sendFrame(list, cb) {
        if (list.length === 2) {
            this._socket.cork();
            this._socket.write(list[0]);
            this._socket.write(list[1], cb);
            this._socket.uncork();
        }
        else {
            this._socket.write(list[0], cb);
        }
    }
}
/* -------------------------------------------------------------------------- */
/*                                  reciever                                  */
/* -------------------------------------------------------------------------- */
class Receiver extends Writable {
    constructor(binaryType, extensions, maxPayload) {
        super();
        this._binaryType = binaryType || BINARY_TYPES[0];
        //@ts-ignore
        this[kWebSocket] = undefined;
        this._extensions = extensions || {};
        this._maxPayload = maxPayload | 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = undefined;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragments = [];
        this._state = GET_INFO;
        this._loop = false;
    }
    _write(chunk, encoding, cb) {
        if (this._opcode === 0x08 && this._state == GET_INFO)
            return cb();
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
    }
    consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length)
            return this._buffers.shift();
        if (n < this._buffers[0].length) {
            const buf = this._buffers[0];
            this._buffers[0] = buf.slice(n);
            return buf.slice(0, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
            const buf = this._buffers[0];
            const offset = dst.length - n;
            if (n >= buf.length) {
                dst.set(this._buffers.shift(), offset);
            }
            else {
                dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
                this._buffers[0] = buf.slice(n);
            }
            n -= buf.length;
        } while (n > 0);
        return dst;
    }
    startLoop(cb) {
        let err;
        this._loop = true;
        do {
            switch (this._state) {
                case GET_INFO:
                    err = this.getInfo();
                    break;
                case GET_PAYLOAD_LENGTH_16:
                    err = this.getPayloadLength16();
                    break;
                case GET_PAYLOAD_LENGTH_64:
                    err = this.getPayloadLength64();
                    break;
                case GET_MASK:
                    this.getMask();
                    break;
                case GET_DATA:
                    err = this.getData(cb);
                    break;
                default:
                    this._loop = false;
                    return;
            }
        } while (this._loop);
        cb(err);
    }
    getInfo() {
        if (this._bufferedBytes < 2) {
            this._loop = false;
            return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 0x30) !== 0x00) {
            this._loop = false;
            return error(RangeError, 'RSV2 and RSV3 must be clear', true, 1002);
        }
        const compressed = (buf[0] & 0x40) === 0x40;
        if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
            this._loop = false;
            return error(RangeError, 'RSV1 must be clear', true, 1002);
        }
        this._fin = (buf[0] & 0x80) === 0x80;
        this._opcode = buf[0] & 0x0f;
        this._payloadLength = buf[1] & 0x7f;
        if (this._opcode === 0x00) {
            if (compressed) {
                this._loop = false;
                return error(RangeError, 'RSV1 must be clear', true, 1002);
            }
            if (!this._fragmented) {
                this._loop = false;
                return error(RangeError, 'invalid opcode 0', true, 1002);
            }
            this._opcode = this._fragmented;
        }
        else if (this._opcode === 0x01 || this._opcode === 0x02) {
            if (this._fragmented) {
                this._loop = false;
                return error(RangeError, `invalid opcode ${this._opcode}`, true, 1002);
            }
            this._compressed = compressed;
        }
        else if (this._opcode > 0x07 && this._opcode < 0x0b) {
            if (!this._fin) {
                this._loop = false;
                return error(RangeError, 'FIN must be set', true, 1002);
            }
            if (compressed) {
                this._loop = false;
                return error(RangeError, 'RSV1 must be clear', true, 1002);
            }
            if (this._payloadLength > 0x7d) {
                this._loop = false;
                return error(RangeError, `invalid payload length ${this._payloadLength}`, true, 1002);
            }
        }
        else {
            this._loop = false;
            return error(RangeError, `invalid opcode ${this._opcode}`, true, 1002);
        }
        if (!this._fin && !this._fragmented)
            this._fragmented = this._opcode;
        this._masked = (buf[1] & 0x80) === 0x80;
        if (this._payloadLength === 126)
            this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127)
            this._state = GET_PAYLOAD_LENGTH_64;
        else
            return this.haveLength();
    }
    getPayloadLength16() {
        if (this._bufferedBytes < 2) {
            this._loop = false;
            return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        return this.haveLength();
    }
    getPayloadLength64() {
        if (this._bufferedBytes < 8) {
            this._loop = false;
            return;
        }
        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
            this._loop = false;
            return error(RangeError, 'Unsupported WebSocket frame: payload length > 2^53 - 1', false, 1009);
        }
        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        return this.haveLength();
    }
    haveLength() {
        if (this._payloadLength && this._opcode < 0x08) {
            this._totalPayloadLength += this._payloadLength;
            if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
                this._loop = false;
                return error(RangeError, 'Max payload size exceeded', false, 1009);
            }
        }
        if (this._masked)
            this._state = GET_MASK;
        else
            this._state = GET_DATA;
    }
    getMask() {
        if (this._bufferedBytes < 4) {
            this._loop = false;
            return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
    }
    getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
            if (this._bufferedBytes < this._payloadLength) {
                this._loop = false;
                return;
            }
            data = this.consume(this._payloadLength);
            if (this._masked)
                unmask(data, this._mask);
        }
        if (this._opcode > 0x07)
            return this.controlMessage(data);
        if (this._compressed) {
            this._state = INFLATING;
            this.decompress(data, cb);
            return;
        }
        if (data.length) {
            this._messageLength = this._totalPayloadLength;
            this._fragments.push(data);
        }
        return this.dataMessage();
    }
    decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
            if (err)
                return cb(err);
            if (buf.length) {
                this._messageLength += buf.length;
                if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
                    return cb(error(RangeError, 'Max payload size exceeded', false, 1009));
                }
                this._fragments.push(buf);
            }
            const er = this.dataMessage();
            if (er)
                return cb(er);
            this.startLoop(cb);
        });
    }
    dataMessage() {
        if (this._fin) {
            const messageLength = this._messageLength;
            const fragments = this._fragments;
            this._totalPayloadLength = 0;
            this._messageLength = 0;
            this._fragmented = 0;
            this._fragments = [];
            if (this._opcode === 2) {
                let data;
                if (this._binaryType === 'nodebuffer') {
                    data = concat(fragments, messageLength);
                }
                else if (this._binaryType === 'arraybuffer') {
                    data = toArrayBuffer(concat(fragments, messageLength));
                }
                else {
                    data = fragments;
                }
                this.emit('message', data);
            }
            else {
                const buf = concat(fragments, messageLength);
                if (!isValidUTF8(buf)) {
                    this._loop = false;
                    return error(Error, 'invalid UTF-8 sequence', true, 1007);
                }
                this.emit('message', buf.toString());
            }
        }
        this._state = GET_INFO;
    }
    controlMessage(data) {
        if (this._opcode === 0x08) {
            this._loop = false;
            if (data.length === 0) {
                this.emit('conclude', 1005, '');
                this.end();
            }
            else if (data.length === 1) {
                return error(RangeError, 'invalid payload length 1', true, 1002);
            }
            else {
                const code = data.readUInt16BE(0);
                if (!isValidStatusCode(code)) {
                    return error(RangeError, `invalid status code ${code}`, true, 1002);
                }
                const buf = data.slice(2);
                if (!isValidUTF8(buf)) {
                    return error(Error, 'invalid UTF-8 sequence', true, 1007);
                }
                this.emit('conclude', code, buf.toString());
                this.end();
            }
        }
        else if (this._opcode === 0x09) {
            this.emit('ping', data);
        }
        else {
            this.emit('pong', data);
        }
        this._state = GET_INFO;
    }
}
function error(ErrorCtor, message, prefix, statusCode) {
    const err = new ErrorCtor(prefix ? `Invalid WebSocket frame: ${message}` : message);
    Error.captureStackTrace(err, error);
    err[kStatusCode] = statusCode;
    return err;
}
/* -------------------------------------------------------------------------- */
/*                              perMessageDeflate                             */
/* -------------------------------------------------------------------------- */
class PerMessageDeflate {
    constructor(options, isServer, maxPayload) {
        this._maxPayload = maxPayload | 0;
        this._options = options || {};
        this._threshold =
            this._options.threshold !== undefined ? this._options.threshold : 1024;
        this._isServer = !!isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
            const concurrency = this._options.concurrencyLimit !== undefined
                ? this._options.concurrencyLimit
                : 10;
            //@ts-ignore
            zlibLimiter = new Limiter({ concurrency });
        }
    }
    static get extensionName() {
        return 'permessage-deflate';
    }
    offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
            params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
            params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
            params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
        }
        else if (this._options.clientMaxWindowBits == null) {
            params.client_max_window_bits = true;
        }
        return params;
    }
    accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer
            ? this.acceptAsServer(configurations)
            : this.acceptAsClient(configurations);
        return this.params;
    }
    cleanup() {
        if (this._inflate) {
            this._inflate.close();
            this._inflate = null;
        }
        if (this._deflate) {
            if (this._deflate[kCallback]) {
                this._deflate[kCallback]();
            }
            this._deflate.close();
            this._deflate = null;
        }
    }
    acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
            if ((opts.serverNoContextTakeover === false &&
                params.server_no_context_takeover) ||
                (params.server_max_window_bits &&
                    (opts.serverMaxWindowBits === false ||
                        (typeof opts.serverMaxWindowBits === 'number' &&
                            opts.serverMaxWindowBits > params.server_max_window_bits))) ||
                (typeof opts.clientMaxWindowBits === 'number' &&
                    !params.client_max_window_bits)) {
                return false;
            }
            return true;
        });
        if (!accepted) {
            throw new Error('None of the extension offers can be accepted');
        }
        if (opts.serverNoContextTakeover) {
            accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
            accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === 'number') {
            accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === 'number') {
            accepted.client_max_window_bits = opts.clientMaxWindowBits;
        }
        else if (accepted.client_max_window_bits === true ||
            opts.clientMaxWindowBits === false) {
            delete accepted.client_max_window_bits;
        }
        return accepted;
    }
    acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false &&
            params.client_no_context_takeover) {
            throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
            if (typeof this._options.clientMaxWindowBits === 'number') {
                params.client_max_window_bits = this._options.clientMaxWindowBits;
            }
        }
        else if (this._options.clientMaxWindowBits === false ||
            (typeof this._options.clientMaxWindowBits === 'number' &&
                params.client_max_window_bits > this._options.clientMaxWindowBits)) {
            throw new Error('Unexpected or invalid parameter "client_max_window_bits"');
        }
        return params;
    }
    normalizeParams(configurations) {
        configurations.forEach((params) => {
            Object.keys(params).forEach((key) => {
                let value = params[key];
                if (value.length > 1) {
                    throw new Error(`Parameter "${key}" must have only a single value`);
                }
                value = value[0];
                if (key === 'client_max_window_bits') {
                    if (value !== true) {
                        const num = +value;
                        if (!Number.isInteger(num) || num < 8 || num > 15) {
                            throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
                        }
                        value = num;
                    }
                    else if (!this._isServer) {
                        throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
                    }
                }
                else if (key === 'server_max_window_bits') {
                    const num = +value;
                    if (!Number.isInteger(num) || num < 8 || num > 15) {
                        throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
                    }
                    value = num;
                }
                else if (key === 'client_no_context_takeover' ||
                    key === 'server_no_context_takeover') {
                    if (value !== true) {
                        throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
                    }
                }
                else {
                    throw new Error(`Unknown parameter "${key}"`);
                }
                params[key] = value;
            });
        });
        return configurations;
    }
    decompress(data, fin, callback) {
        zlibLimiter.push((done) => {
            this._decompress(data, fin, (err, result) => {
                done();
                callback(err, result);
            });
        });
    }
    compress(data, fin, callback) {
        zlibLimiter.push((done) => {
            this._compress(data, fin, (err, result) => {
                done();
                if (err || result) {
                    callback(err, result);
                }
            });
        });
    }
    _decompress(data, fin, callback) {
        const endpoint = this._isServer ? 'client' : 'server';
        if (!this._inflate) {
            const key = `${endpoint}_max_window_bits`;
            const windowBits = typeof this.params[key] !== 'number'
                //@ts-ignore
                ? zlib.Z_DEFAULT_WINDOWBITS
                : this.params[key];
            this._inflate = zlib.createInflateRaw({
                ...this._options.zlibInflateOptions,
                windowBits
            });
            this._inflate[kPerMessageDeflate] = this;
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            this._inflate.on('error', inflateOnError);
            this._inflate.on('data', inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin)
            this._inflate.write(TRAILER);
        this._inflate.flush(() => {
            const err = this._inflate[kError];
            if (err) {
                this._inflate.close();
                this._inflate = null;
                callback(err);
                return;
            }
            const data = bufferUtil.concat(this._inflate[kBuffers], this._inflate[kTotalLength]);
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
                this._inflate.close();
                this._inflate = null;
            }
            else {
                this._inflate[kTotalLength] = 0;
                this._inflate[kBuffers] = [];
            }
            callback(null, data);
        });
    }
    _compress(data, fin, callback) {
        if (!data || data.length === 0) {
            process.nextTick(callback, null, EMPTY_BLOCK);
            return;
        }
        const endpoint = this._isServer ? 'server' : 'client';
        if (!this._deflate) {
            const key = `${endpoint}_max_window_bits`;
            const windowBits = typeof this.params[key] !== 'number'
                //@ts-ignore
                ? zlib.Z_DEFAULT_WINDOWBITS
                : this.params[key];
            this._deflate = zlib.createDeflateRaw({
                ...this._options.zlibDeflateOptions,
                windowBits
            });
            this._deflate[kTotalLength] = 0;
            this._deflate[kBuffers] = [];
            this._deflate.on('error', NOOP);
            this._deflate.on('data', deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
            if (!this._deflate) {
                return;
            }
            let data = bufferUtil.concat(this._deflate[kBuffers], this._deflate[kTotalLength]);
            if (fin)
                data = data.slice(0, data.length - 4);
            this._deflate[kCallback] = null;
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
                this._deflate.close();
                this._deflate = null;
            }
            else {
                this._deflate[kTotalLength] = 0;
                this._deflate[kBuffers] = [];
            }
            callback(null, data);
        });
    }
}
function deflateOnData(chunk) {
    this[kBuffers].push(chunk);
    this[kTotalLength] += chunk.length;
}
function inflateOnData(chunk) {
    this[kTotalLength] += chunk.length;
    if (this[kPerMessageDeflate]._maxPayload < 1 ||
        this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
    }
    this[kError] = new RangeError('Max payload size exceeded');
    this[kError][kStatusCode] = 1009;
    this.removeListener('data', inflateOnData);
    this.reset();
}
function inflateOnError(err) {
    this[kPerMessageDeflate]._inflate = null;
    err[kStatusCode] = 1007;
    this[kCallback](err);
}
/* -------------------------------------------------------------------------- */
/*                                 buffer util                                */
/* -------------------------------------------------------------------------- */
function concat(list, totalLength) {
    if (list.length === 0)
        return EMPTY_BUFFER;
    if (list.length === 1)
        return list[0];
    const target = Buffer.allocUnsafe(totalLength);
    let offset = 0;
    for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
    }
    return target;
}
function _mask(source, mask, output, offset, length) {
    for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
    }
}
function _unmask(buffer, mask) {
    const length = buffer.length;
    for (let i = 0; i < length; i++) {
        buffer[i] ^= mask[i & 3];
    }
}
function toArrayBuffer(buf) {
    if (buf.byteLength === buf.buffer.byteLength) {
        return buf.buffer;
    }
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
let toBuffer = function toBuffer(data) {
    //@ts-ignore
    toBuffer.readOnly = true;
    if (Buffer.isBuffer(data))
        return data;
    let buf;
    if (data instanceof ArrayBuffer) {
        buf = Buffer.from(data);
    }
    else if (ArrayBuffer.isView(data)) {
        buf = viewToBuffer(data);
    }
    else {
        buf = Buffer.from(data);
        //@ts-ignore
        toBuffer.readOnly = false;
    }
    return buf;
};
function viewToBuffer(view) {
    const buf = Buffer.from(view.buffer);
    if (view.byteLength !== view.buffer.byteLength) {
        return buf.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
    return buf;
}
let bufferUtil = {
    concat,
    mask,
    unmask
};
// const bufferUtil = require('bufferutil');
// const bu = bufferUtil.BufferUtil || bufferUtil
const bu = bufferUtil;
function mask(source, mask, output, offset, length) {
    if (length < 48)
        _mask(source, mask, output, offset, length);
    else
        bu.mask(source, mask, output, offset, length);
}
function unmask(buffer, mask) {
    if (buffer.length < 32)
        _unmask(buffer, mask);
    else
        bu.unmask(buffer, mask);
}
/* -------------------------------------------------------------------------- */
/*                                   events                                   */
/* -------------------------------------------------------------------------- */
class Event {
    constructor(type, target) {
        this.target = target;
        this.type = type;
    }
}
class MessageEvent extends Event {
    constructor(data, target) {
        super('message', target);
        this.data = data;
    }
}
class CloseEvent extends Event {
    constructor(code, reason, target) {
        super('close', target);
        this.wasClean = target._closeFrameReceived && target._closeFrameSent;
        this.reason = reason;
        this.code = code;
    }
}
class OpenEvent extends Event {
    constructor(target) {
        super('open', target);
    }
}
class ErrorEvent extends Event {
    constructor(error, target) {
        super('error', target);
        this.message = error.message;
        this.error = error;
    }
}
const EventTarget = {
    addEventListener(method, listener) {
        if (typeof listener !== 'function')
            return;
        function onMessage(data) {
            listener.call(this, new MessageEvent(data, this));
        }
        function onClose(code, message) {
            listener.call(this, new CloseEvent(code, message, this));
        }
        function onError(error) {
            listener.call(this, new ErrorEvent(error, this));
        }
        function onOpen() {
            listener.call(this, new OpenEvent(this));
        }
        if (method === 'message') {
            onMessage._listener = listener;
            this.on(method, onMessage);
        }
        else if (method === 'close') {
            onClose._listener = listener;
            this.on(method, onClose);
        }
        else if (method === 'error') {
            onError._listener = listener;
            this.on(method, onError);
        }
        else if (method === 'open') {
            onOpen._listener = listener;
            this.on(method, onOpen);
        }
        else {
            this.on(method, listener);
        }
    },
    removeEventListener(method, listener) {
        const listeners = this.listeners(method);
        for (let i = 0; i < listeners.length; i++) {
            if (listeners[i] === listener || listeners[i]._listener === listener) {
                this.removeListener(method, listeners[i]);
            }
        }
    }
};
/* -------------------------------------------------------------------------- */
/*                                  websocket                                 */
/* -------------------------------------------------------------------------- */
class WebSocket extends EventEmitter {
    constructor(address, protocols, options) {
        super();
        this.readyState = WebSocket.CONNECTING;
        this.protocol = '';
        this._binaryType = BINARY_TYPES[0];
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = '';
        this._closeTimer = null;
        this._closeCode = 1006;
        this._extensions = {};
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
            this._bufferedAmount = 0;
            this._isServer = false;
            this._redirects = 0;
            if (Array.isArray(protocols)) {
                protocols = protocols.join(', ');
            }
            else if (typeof protocols === 'object' && protocols !== null) {
                options = protocols;
                protocols = undefined;
            }
            initAsClient(this, address, protocols, options);
        }
        else {
            this._isServer = true;
        }
    }
    get CONNECTING() {
        return WebSocket.CONNECTING;
    }
    get CLOSING() {
        return WebSocket.CLOSING;
    }
    get CLOSED() {
        return WebSocket.CLOSED;
    }
    get OPEN() {
        return WebSocket.OPEN;
    }
    get binaryType() {
        return this._binaryType;
    }
    set binaryType(type) {
        if (!BINARY_TYPES.includes(type))
            return;
        this._binaryType = type;
        if (this._receiver)
            this._receiver._binaryType = type;
    }
    get bufferedAmount() {
        if (!this._socket)
            return this._bufferedAmount;
        return (this._socket.bufferSize || 0) + this._sender._bufferedBytes;
    }
    get extensions() {
        return Object.keys(this._extensions).join();
    }
    setSocket(socket, head, maxPayload) {
        const receiver = new Receiver(this._binaryType, this._extensions, maxPayload);
        this._sender = new Sender(socket, this._extensions);
        this._receiver = receiver;
        this._socket = socket;
        receiver[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on('conclude', receiverOnConclude);
        receiver.on('drain', receiverOnDrain);
        receiver.on('error', receiverOnError);
        receiver.on('message', receiverOnMessage);
        receiver.on('ping', receiverOnPing);
        receiver.on('pong', receiverOnPong);
        socket.setTimeout(0);
        socket.setNoDelay();
        if (head.length > 0)
            socket.unshift(head);
        socket.on('close', socketOnClose);
        socket.on('data', socketOnData);
        socket.on('end', socketOnEnd);
        socket.on('error', _ws_socketOnError);
        this.readyState = WebSocket.OPEN;
        this.emit('open');
    }
    emitClose() {
        this.readyState = WebSocket.CLOSED;
        if (!this._socket) {
            this.emit('close', this._closeCode, this._closeMessage);
            return;
        }
        if (this._extensions[PerMessageDeflate.extensionName]) {
            this._extensions[PerMessageDeflate.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this.emit('close', this._closeCode, this._closeMessage);
    }
    close(code, data) {
        if (this.readyState === WebSocket.CLOSED)
            return;
        if (this.readyState === WebSocket.CONNECTING) {
            const msg = 'WebSocket was closed before the connection was established';
            return _ws_abortHandshake(this, this._req, msg);
        }
        if (this.readyState === WebSocket.CLOSING) {
            if (this._closeFrameSent && this._closeFrameReceived)
                this._socket.end();
            return;
        }
        this.readyState = WebSocket.CLOSING;
        this._sender.close(code, data, !this._isServer, (err) => {
            if (err)
                return;
            this._closeFrameSent = true;
            if (this._closeFrameReceived)
                this._socket.end();
        });
        this._closeTimer = setTimeout(this._socket.destroy.bind(this._socket), closeTimeout);
    }
    ping(data, mask, cb) {
        if (this.readyState === WebSocket.CONNECTING) {
            throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
        }
        if (typeof data === 'function') {
            cb = data;
            data = mask = undefined;
        }
        else if (typeof mask === 'function') {
            cb = mask;
            mask = undefined;
        }
        if (typeof data === 'number')
            data = data.toString();
        if (this.readyState !== WebSocket.OPEN) {
            sendAfterClose(this, data, cb);
            return;
        }
        if (mask === undefined)
            mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
    }
    pong(data, mask, cb) {
        if (this.readyState === WebSocket.CONNECTING) {
            throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
        }
        if (typeof data === 'function') {
            cb = data;
            data = mask = undefined;
        }
        else if (typeof mask === 'function') {
            cb = mask;
            mask = undefined;
        }
        if (typeof data === 'number')
            data = data.toString();
        if (this.readyState !== WebSocket.OPEN) {
            sendAfterClose(this, data, cb);
            return;
        }
        if (mask === undefined)
            mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
    }
    send(data, options, cb) {
        if (this.readyState === WebSocket.CONNECTING) {
            throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
        }
        if (typeof options === 'function') {
            cb = options;
            options = {};
        }
        if (typeof data === 'number')
            data = data.toString();
        if (this.readyState !== WebSocket.OPEN) {
            sendAfterClose(this, data, cb);
            return;
        }
        const opts = {
            binary: typeof data !== 'string',
            mask: !this._isServer,
            compress: true,
            fin: true,
            ...options
        };
        if (!this._extensions[PerMessageDeflate.extensionName]) {
            opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
    }
    terminate() {
        if (this.readyState === WebSocket.CLOSED)
            return;
        if (this.readyState === WebSocket.CONNECTING) {
            const msg = 'WebSocket was closed before the connection was established';
            return _ws_abortHandshake(this, this._req, msg);
        }
        if (this._socket) {
            this.readyState = WebSocket.CLOSING;
            this._socket.destroy();
        }
    }
}
readyStates.forEach((readyState, i) => {
    WebSocket[readyState] = i;
});
['open', 'error', 'close', 'message'].forEach((method) => {
    Object.defineProperty(WebSocket.prototype, `on${method}`, {
        get() {
            const listeners = this.listeners(method);
            for (let i = 0; i < listeners.length; i++) {
                if (listeners[i]._listener)
                    return listeners[i]._listener;
            }
            return undefined;
        },
        set(listener) {
            const listeners = this.listeners(method);
            for (let i = 0; i < listeners.length; i++) {
                if (listeners[i]._listener)
                    this.removeListener(method, listeners[i]);
            }
            this.addEventListener(method, listener);
        }
    });
});
//@ts-ignore
WebSocket.prototype.addEventListener = EventEmitter.prototype.addEventListener;
//@ts-ignore
WebSocket.prototype.removeEventListener = EventEmitter.prototype.removeEventListener;
function initAsClient(websocket, address, protocols, options) {
    const opts = {
        protocolVersion: protocolVersions[1],
        maxPayload: 100 * 1024 * 1024,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        createConnection: undefined,
        socketPath: undefined,
        hostname: undefined,
        protocol: undefined,
        timeout: undefined,
        method: undefined,
        auth: undefined,
        host: undefined,
        path: undefined,
        port: undefined
    };
    if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(`Unsupported protocol version: ${opts.protocolVersion} ` +
            `(supported versions: ${protocolVersions.join(', ')})`);
    }
    let parsedUrl;
    if (address instanceof URL) {
        parsedUrl = address;
        websocket.url = address.href;
    }
    else {
        parsedUrl = new URL(address);
        websocket.url = address;
    }
    const isUnixSocket = parsedUrl.protocol === 'ws+unix:';
    if (!parsedUrl.host && (!isUnixSocket || !parsedUrl.pathname)) {
        throw new Error(`Invalid URL: ${websocket.url}`);
    }
    const isSecure = parsedUrl.protocol === 'wss:' || parsedUrl.protocol === 'https:';
    const defaultPort = isSecure ? 443 : 80;
    const key = randomBytes(16).toString('base64');
    const get = isSecure ? https.get : http.get;
    let perMessageDeflate;
    opts.createConnection = isSecure ? tlsConnect : netConnect;
    opts.defaultPort = opts.defaultPort || defaultPort;
    opts.port = parsedUrl.port || defaultPort;
    opts.host = parsedUrl.hostname.startsWith('[')
        ? parsedUrl.hostname.slice(1, -1)
        : parsedUrl.hostname;
    opts.headers = {
        'Sec-WebSocket-Version': opts.protocolVersion,
        'Sec-WebSocket-Key': key,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        ...opts.headers
    };
    opts.path = parsedUrl.pathname + parsedUrl.search;
    opts.timeout = opts.handshakeTimeout;
    if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate(opts.perMessageDeflate !== true ? opts.perMessageDeflate : {}, false, opts.maxPayload);
        opts.headers['Sec-WebSocket-Extensions'] = format({
            [PerMessageDeflate.extensionName]: perMessageDeflate.offer()
        });
    }
    if (protocols) {
        opts.headers['Sec-WebSocket-Protocol'] = protocols;
    }
    if (opts.origin) {
        if (opts.protocolVersion < 13) {
            opts.headers['Sec-WebSocket-Origin'] = opts.origin;
        }
        else {
            opts.headers.Origin = opts.origin;
        }
    }
    if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
    }
    if (isUnixSocket) {
        const parts = opts.path.split(':');
        opts.socketPath = parts[0];
        opts.path = parts[1];
    }
    let req = (websocket._req = get(opts));
    if (opts.timeout) {
        req.on('timeout', () => {
            _ws_abortHandshake(websocket, req, 'Opening handshake has timed out');
        });
    }
    req.on('error', (err) => {
        if (websocket._req.aborted)
            return;
        req = websocket._req = null;
        websocket.readyState = WebSocket.CLOSING;
        websocket.emit('error', err);
        websocket.emitClose();
    });
    req.on('response', (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location &&
            opts.followRedirects &&
            statusCode >= 300 &&
            statusCode < 400) {
            if (++websocket._redirects > opts.maxRedirects) {
                _ws_abortHandshake(websocket, req, 'Maximum redirects exceeded');
                return;
            }
            req.abort();
            const addr = new URL(location, address);
            initAsClient(websocket, addr, protocols, options);
        }
        else if (!websocket.emit('unexpected-response', req, res)) {
            _ws_abortHandshake(websocket, req, `Unexpected server response: ${res.statusCode}`);
        }
    });
    req.on('upgrade', (res, socket, head) => {
        websocket.emit('upgrade', res);
        if (websocket.readyState !== WebSocket.CONNECTING)
            return;
        req = websocket._req = null;
        const digest = createHash('sha1')
            .update(key + GUID)
            .digest('base64');
        if (res.headers['sec-websocket-accept'] !== digest) {
            _ws_abortHandshake(websocket, socket, 'Invalid Sec-WebSocket-Accept header');
            return;
        }
        const serverProt = res.headers['sec-websocket-protocol'];
        const protList = (protocols || '').split(/, */);
        let protError;
        if (!protocols && serverProt) {
            protError = 'Server sent a subprotocol but none was requested';
        }
        else if (protocols && !serverProt) {
            protError = 'Server sent no subprotocol';
        }
        else if (serverProt && !protList.includes(serverProt)) {
            protError = 'Server sent an invalid subprotocol';
        }
        if (protError) {
            _ws_abortHandshake(websocket, socket, protError);
            return;
        }
        if (serverProt)
            websocket.protocol = serverProt;
        if (perMessageDeflate) {
            try {
                const extensions = parse(res.headers['sec-websocket-extensions']);
                if (extensions[PerMessageDeflate.extensionName]) {
                    perMessageDeflate.accept(extensions[PerMessageDeflate.extensionName]);
                    websocket._extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
                }
            }
            catch (err) {
                _ws_abortHandshake(websocket, socket, 'Invalid Sec-WebSocket-Extensions header');
                return;
            }
        }
        websocket.setSocket(socket, head, opts.maxPayload);
    });
}
function netConnect(options) {
    options.path = options.socketPath;
    return net.connect(options);
}
function tlsConnect(options) {
    options.path = undefined;
    if (!options.servername && options.servername !== '') {
        options.servername = options.host;
    }
    return tls.connect(options);
}
function _ws_abortHandshake(websocket, stream, message) {
    websocket.readyState = WebSocket.CLOSING;
    const err = new Error(message);
    Error.captureStackTrace(err, _ws_abortHandshake);
    if (stream.setHeader) {
        stream.abort();
        stream.once('abort', websocket.emitClose.bind(websocket));
        websocket.emit('error', err);
    }
    else {
        stream.destroy(err);
        stream.once('error', websocket.emit.bind(websocket, 'error'));
        stream.once('close', websocket.emitClose.bind(websocket));
    }
}
function sendAfterClose(websocket, data, cb) {
    if (data) {
        const length = toBuffer(data).length;
        if (websocket._socket)
            websocket._sender._bufferedBytes += length;
        else
            websocket._bufferedAmount += length;
    }
    if (cb) {
        const err = new Error(`WebSocket is not open: readyState ${websocket.readyState} ` +
            `(${readyStates[websocket.readyState]})`);
        cb(err);
    }
}
function receiverOnConclude(code, reason) {
    const websocket = this[kWebSocket];
    websocket._socket.removeListener('data', socketOnData);
    websocket._socket.resume();
    websocket._closeFrameReceived = true;
    websocket._closeMessage = reason;
    websocket._closeCode = code;
    if (code === 1005)
        websocket.close();
    else
        websocket.close(code, reason);
}
function receiverOnDrain() {
    this[kWebSocket]._socket.resume();
}
function receiverOnError(err) {
    const websocket = this[kWebSocket];
    websocket._socket.removeListener('data', socketOnData);
    websocket.readyState = WebSocket.CLOSING;
    websocket._closeCode = err[kStatusCode];
    websocket.emit('error', err);
    websocket._socket.destroy();
}
function receiverOnFinish() {
    this[kWebSocket].emitClose();
}
function receiverOnMessage(data) {
    this[kWebSocket].emit('message', data);
}
function receiverOnPing(data) {
    const websocket = this[kWebSocket];
    websocket.pong(data, !websocket._isServer, NOOP);
    websocket.emit('ping', data);
}
function receiverOnPong(data) {
    this[kWebSocket].emit('pong', data);
}
function socketOnClose() {
    const websocket = this[kWebSocket];
    this.removeListener('close', socketOnClose);
    this.removeListener('end', socketOnEnd);
    websocket.readyState = WebSocket.CLOSING;
    websocket._socket.read();
    websocket._receiver.end();
    this.removeListener('data', socketOnData);
    this[kWebSocket] = undefined;
    clearTimeout(websocket._closeTimer);
    if (websocket._receiver._writableState.finished ||
        websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
    }
    else {
        websocket._receiver.on('error', receiverOnFinish);
        websocket._receiver.on('finish', receiverOnFinish);
    }
}
function socketOnData(chunk) {
    if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
    }
}
function socketOnEnd() {
    const websocket = this[kWebSocket];
    websocket.readyState = WebSocket.CLOSING;
    websocket._receiver.end();
    this.end();
}
function _ws_socketOnError() {
    const websocket = this[kWebSocket];
    this.removeListener('error', _ws_socketOnError);
    this.on('error', NOOP);
    if (websocket) {
        websocket.readyState = WebSocket.CLOSING;
        this.destroy();
    }
}
/* -------------------------------------------------------------------------- */
/*                                 //extension                                */
/* -------------------------------------------------------------------------- */
const tokenChars = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
    0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0
];
function push(dest, name, elem) {
    if (dest[name] === undefined)
        dest[name] = [elem];
    else
        dest[name].push(elem);
}
function parse(header) {
    const offers = Object.create(null);
    if (header === undefined || header === '')
        return offers;
    let params = Object.create(null);
    let mustUnescape = false;
    let isEscaping = false;
    let inQuotes = false;
    let extensionName;
    let paramName;
    let start = -1;
    let end = -1;
    let i = 0;
    for (; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (extensionName === undefined) {
            if (end === -1 && tokenChars[code] === 1) {
                if (start === -1)
                    start = i;
            }
            else if (code === 0x20 || code === 0x09) {
                if (end === -1 && start !== -1)
                    end = i;
            }
            else if (code === 0x3b || code === 0x2c) {
                if (start === -1) {
                    throw new SyntaxError(`Unexpected character at index ${i}`);
                }
                if (end === -1)
                    end = i;
                const name = header.slice(start, end);
                if (code === 0x2c) {
                    push(offers, name, params);
                    params = Object.create(null);
                }
                else {
                    extensionName = name;
                }
                start = end = -1;
            }
            else {
                throw new SyntaxError(`Unexpected character at index ${i}`);
            }
        }
        else if (paramName === undefined) {
            if (end === -1 && tokenChars[code] === 1) {
                if (start === -1)
                    start = i;
            }
            else if (code === 0x20 || code === 0x09) {
                if (end === -1 && start !== -1)
                    end = i;
            }
            else if (code === 0x3b || code === 0x2c) {
                if (start === -1) {
                    throw new SyntaxError(`Unexpected character at index ${i}`);
                }
                if (end === -1)
                    end = i;
                push(params, header.slice(start, end), true);
                if (code === 0x2c) {
                    push(offers, extensionName, params);
                    params = Object.create(null);
                    extensionName = undefined;
                }
                start = end = -1;
            }
            else if (code === 0x3d && start !== -1 && end === -1) {
                paramName = header.slice(start, i);
                start = end = -1;
            }
            else {
                throw new SyntaxError(`Unexpected character at index ${i}`);
            }
        }
        else {
            if (isEscaping) {
                if (tokenChars[code] !== 1) {
                    throw new SyntaxError(`Unexpected character at index ${i}`);
                }
                if (start === -1)
                    start = i;
                else if (!mustUnescape)
                    mustUnescape = true;
                isEscaping = false;
            }
            else if (inQuotes) {
                if (tokenChars[code] === 1) {
                    if (start === -1)
                        start = i;
                }
                else if (code === 0x22 && start !== -1) {
                    inQuotes = false;
                    end = i;
                }
                else if (code === 0x5c) {
                    isEscaping = true;
                }
                else {
                    throw new SyntaxError(`Unexpected character at index ${i}`);
                }
            }
            else if (code === 0x22 && header.charCodeAt(i - 1) === 0x3d) {
                inQuotes = true;
            }
            else if (end === -1 && tokenChars[code] === 1) {
                if (start === -1)
                    start = i;
            }
            else if (start !== -1 && (code === 0x20 || code === 0x09)) {
                if (end === -1)
                    end = i;
            }
            else if (code === 0x3b || code === 0x2c) {
                if (start === -1) {
                    throw new SyntaxError(`Unexpected character at index ${i}`);
                }
                if (end === -1)
                    end = i;
                let value = header.slice(start, end);
                if (mustUnescape) {
                    value = value.replace(/\\/g, '');
                    mustUnescape = false;
                }
                push(params, paramName, value);
                if (code === 0x2c) {
                    push(offers, extensionName, params);
                    params = Object.create(null);
                    extensionName = undefined;
                }
                paramName = undefined;
                start = end = -1;
            }
            else {
                throw new SyntaxError(`Unexpected character at index ${i}`);
            }
        }
    }
    if (start === -1 || inQuotes) {
        throw new SyntaxError('Unexpected end of input');
    }
    if (end === -1)
        end = i;
    const token = header.slice(start, end);
    if (extensionName === undefined) {
        push(offers, token, params);
    }
    else {
        if (paramName === undefined) {
            push(params, token, true);
        }
        else if (mustUnescape) {
            push(params, paramName, token.replace(/\\/g, ''));
        }
        else {
            push(params, paramName, token);
        }
        push(offers, extensionName, params);
    }
    return offers;
}
function format(extensions) {
    return Object.keys(extensions)
        .map((extension) => {
        let configurations = extensions[extension];
        if (!Array.isArray(configurations))
            configurations = [configurations];
        return configurations
            .map((params) => {
            return [extension]
                .concat(Object.keys(params).map((k) => {
                let values = params[k];
                if (!Array.isArray(values))
                    values = [values];
                return values
                    .map((v) => (v === true ? k : `${k}=${v}`))
                    .join('; ');
            }))
                .join('; ');
        })
            .join(', ');
    })
        .join(', ');
}
/* -------------------------------------------------------------------------- */
/*                                  ws server                                 */
/* -------------------------------------------------------------------------- */
class WebSocketServer extends EventEmitter {
    constructor(options, callback) {
        super();
        options = {
            maxPayload: 100 * 1024 * 1024,
            perMessageDeflate: false,
            handleProtocols: null,
            clientTracking: true,
            verifyClient: null,
            noServer: false,
            backlog: null,
            server: null,
            host: null,
            path: null,
            port: null,
            ...options
        };
        if (options.port == null && !options.server && !options.noServer) {
            throw new TypeError('One of the "port", "server", or "noServer" options must be specified');
        }
        if (options.port != null) {
            this._server = createServer((req, res) => {
                const body = STATUS_CODES[426];
                res.writeHead(426, {
                    'Content-Length': body.length,
                    'Content-Type': 'text/plain'
                });
                res.end(body);
            });
            this._server.listen(options.port, options.host, options.backlog, callback);
        }
        else if (options.server) {
            if (options.server[kUsedByWebSocketServer]) {
                throw new Error('The HTTP/S server is already being used by another WebSocket server');
            }
            options.server[kUsedByWebSocketServer] = true;
            this._server = options.server;
        }
        if (this._server) {
            this._removeListeners = addListeners(this._server, {
                listening: this.emit.bind(this, 'listening'),
                error: this.emit.bind(this, 'error'),
                upgrade: (req, socket, head) => {
                    this.handleUpgrade(req, socket, head, (ws) => {
                        this.emit('connection', ws, req);
                    });
                }
            });
        }
        if (options.perMessageDeflate === true)
            options.perMessageDeflate = {};
        if (options.clientTracking)
            this.clients = new Set();
        this.options = options;
    }
    address() {
        if (this.options.noServer) {
            throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server)
            return null;
        return this._server.address();
    }
    close(cb) {
        if (cb)
            this.once('close', cb);
        if (this.clients) {
            for (const client of this.clients)
                client.terminate();
        }
        const server = this._server;
        if (server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
            if (this.options.port != null) {
                server.close(() => this.emit('close'));
                return;
            }
            delete server[kUsedByWebSocketServer];
        }
        process.nextTick(emitClose, this);
    }
    shouldHandle(req) {
        if (this.options.path) {
            const index = req.url.indexOf('?');
            const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
            if (pathname !== this.options.path)
                return false;
        }
        return true;
    }
    handleUpgrade(req, socket, head, cb) {
        socket.on('error', socketOnError);
        const key = req.headers['sec-websocket-key'] !== undefined
            ? req.headers['sec-websocket-key'].trim()
            : false;
        const version = +req.headers['sec-websocket-version'];
        const extensions = {};
        if (req.method !== 'GET' ||
            req.headers.upgrade.toLowerCase() !== 'websocket' ||
            !key ||
            !keyRegex.test(key) ||
            (version !== 8 && version !== 13) ||
            !this.shouldHandle(req)) {
            return abortHandshake(socket, 400);
        }
        if (this.options.perMessageDeflate) {
            const perMessageDeflate = new PerMessageDeflate(this.options.perMessageDeflate, true, this.options.maxPayload);
            try {
                const offers = parse(req.headers['sec-websocket-extensions']);
                if (offers[PerMessageDeflate.extensionName]) {
                    perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
                    extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
                }
            }
            catch (err) {
                return abortHandshake(socket, 400);
            }
        }
        if (this.options.verifyClient) {
            const info = {
                origin: req.headers[`${version === 8 ? 'sec-websocket-origin' : 'origin'}`],
                secure: !!(req.connection.authorized || req.connection.encrypted),
                req
            };
            if (this.options.verifyClient.length === 2) {
                this.options.verifyClient(info, (verified, code, message, headers) => {
                    if (!verified) {
                        return abortHandshake(socket, code || 401, message, headers);
                    }
                    this.completeUpgrade(key, extensions, req, socket, head, cb);
                });
                return;
            }
            if (!this.options.verifyClient(info))
                return abortHandshake(socket, 401);
        }
        this.completeUpgrade(key, extensions, req, socket, head, cb);
    }
    completeUpgrade(key, extensions, req, socket, head, cb) {
        if (!socket.readable || !socket.writable)
            return socket.destroy();
        const digest = createHash('sha1')
            .update(key + GUID)
            .digest('base64');
        const headers = [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new WebSocket(null);
        let protocol = req.headers['sec-websocket-protocol'];
        if (protocol) {
            protocol = protocol.trim().split(/ *, */);
            if (this.options.handleProtocols) {
                protocol = this.options.handleProtocols(protocol, req);
            }
            else {
                protocol = protocol[0];
            }
            if (protocol) {
                headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
                ws.protocol = protocol;
            }
        }
        if (extensions[PerMessageDeflate.extensionName]) {
            const params = extensions[PerMessageDeflate.extensionName].params;
            const value = format({
                [PerMessageDeflate.extensionName]: [params]
            });
            headers.push(`Sec-WebSocket-Extensions: ${value}`);
            ws._extensions = extensions;
        }
        this.emit('headers', headers, req);
        socket.write(headers.concat('\r\n').join('\r\n'));
        socket.removeListener('error', socketOnError);
        ws.setSocket(socket, head, this.options.maxPayload);
        if (this.clients) {
            this.clients.add(ws);
            ws.on('close', () => this.clients.delete(ws));
        }
        cb(ws);
    }
}
function addListeners(server, map) {
    for (const event of Object.keys(map))
        server.on(event, map[event]);
    return function removeListeners() {
        for (const event of Object.keys(map)) {
            server.removeListener(event, map[event]);
        }
    };
}
function emitClose(server) {
    server.emit('close');
}
function socketOnError() {
    this.destroy();
}
function abortHandshake(socket, code, message, headers) {
    if (socket.writable) {
        message = message || STATUS_CODES[code];
        headers = {
            Connection: 'close',
            'Content-type': 'text/html',
            'Content-Length': Buffer.byteLength(message),
            ...headers
        };
        socket.write(`HTTP/1.1 ${code} ${STATUS_CODES[code]}\r\n` +
            Object.keys(headers)
                .map((h) => `${h}: ${headers[h]}`)
                .join('\r\n') +
            '\r\n\r\n' +
            message);
    }
    socket.removeListener('error', socketOnError);
    socket.destroy();
}
export { WebSocketServer as Server };
