
import fs from 'fs'
import { parse } from 'meriyah'
import path from 'path'
import { Transform } from 'stream'
import { inherits } from 'util'
import { combine, concat, duplexer, through } from '../streamz'
import browserResolve from './browser-resolve'
import relativePath from './cached-path-relative'
import nodeResolve from './resolve'
import * as walk from './walk'


var requireRe = /\brequire\b/;

function defined(...args) {
    for (var i = 0; i < arguments.length; i++) {
        if (arguments[i] !== undefined) return arguments[i];
    }
};


/* -------------------------------------------------------------------------- */
/*                                  detective                                 */
/* -------------------------------------------------------------------------- */

function detective(src, opts) {
    return detective.find(src, opts).strings;
};

// function parse (src, opts) {
//     if (!opts) opts = {};
//     var acornOpts: any = {
//         ranges: defined(opts.ranges, opts.range),
//         locations: defined(opts.locations, opts.loc),
//         allowReserved: defined(opts.allowReserved, true),
//         allowImportExportEverywhere: defined(opts.allowImportExportEverywhere, false)
//     };

//     // Use acorn-node's defaults for the rest.
//     if (opts.ecmaVersion != null) acornOpts.ecmaVersion = opts.ecmaVersion;
//     if (opts.sourceType != null) acornOpts.sourceType = opts.sourceType;
//     if (opts.allowHashBang != null) acornOpts.allowHashBang = opts.allowHashBang;
//     if (opts.allowReturnOutsideFunction != null) acornOpts.allowReturnOutsideFunction = opts.allowReturnOutsideFunction;

//     return acorn.parse(src, acornOpts);
// }


detective.find = function (src, opts) {
    if (!opts) opts = {};
    
    var word = opts.word === undefined ? 'require' : opts.word;
    if (typeof src !== 'string') src = String(src);
    
    var isRequire = opts.isRequire || function (node) {
        return node.callee.type === 'Identifier'
            && node.callee.name === word
        ;
    };
    
    var modules: any = { strings : [], expressions : [] };
    if (opts.nodes) modules.nodes = [];
    
    var wordRe = word === 'require' ? requireRe : RegExp('\\b' + word + '\\b');
    if (!wordRe.test(src)) return modules;
    
    var ast = parse(src, opts.parse);
    
    function visit(node, st, c) {
        var hasRequire = wordRe.test(src.slice(node.start, node.end));
        if (!hasRequire) return;
        walk.base[node.type](node, st, c);
        if (node.type !== 'CallExpression') return;
        if (isRequire(node)) {
            if (node.arguments.length) {
                var arg = node.arguments[0];
                if (arg.type === 'Literal') {
                    modules.strings.push(arg.value);
                }
                else if (arg.type === 'TemplateLiteral'
                        && arg.quasis.length === 1
                        && arg.expressions.length === 0) {

                    modules.strings.push(arg.quasis[0].value.raw);
                }
                else {
                    modules.expressions.push(src.slice(arg.start, arg.end));
                }
            }
            if (opts.nodes) modules.nodes.push(node);
        }
    }
    
    walk.recursive(ast, null, {
        Statement: visit,
        Expression: visit
    });
    
    return modules;
};



/* -------------------------------------------------------------------------- */
/*                                   parents                                  */
/* -------------------------------------------------------------------------- */

function parents(cwd, opts?) {
    if (cwd === undefined) cwd = process.cwd();
    if (!opts) opts = {};
    var platform = opts.platform || process.platform;
    var isWindows = /^win/.test(platform);
    var init = isWindows ? '' : '/';

    //var res = path.normalize(cwd).split(path.sep)
    var res = path.normalize(cwd).split("/")
        .reduce(function (acc,dir,ix) {
            return acc.concat(path.join(acc[ix], dir))
        }, [init]).slice(1).reverse()
    ;
    if (res[0] === res[1]) return [ res[0] ];
    return res;

}
/* -------------------------------------------------------------------------- */
/*                                 ModuleDeps                                 */
/* -------------------------------------------------------------------------- */


inherits(ModuleDeps, Transform);

function ModuleDeps (opts) {
    var self = this;
    //@ts-ignore
    if (!(this instanceof ModuleDeps)) return new ModuleDeps(opts);
    Transform.call(this, { objectMode: true });
    
    if (!opts) opts = {};
    
    this.basedir = opts.basedir || process.cwd();
    this.persistentCache = opts.persistentCache || function (file, id, pkg, fallback, cb) {
        process.nextTick(function () {
            fallback(null, cb);
        });
    };
    this.cache = opts.cache;
    this.fileCache = opts.fileCache;
    this.pkgCache = opts.packageCache || {};
    this.pkgFileCache = {};
    this.pkgFileCachePending = {};
    this._emittedPkg = {};
    this._transformDeps = {};
    this.visited = {};
    this.walking = {};
    this.entries = [];
    this._input = [];
    
    this.paths = opts.paths || process.env.NODE_PATH || '';
    if (typeof this.paths === 'string') {
        var delimiter = path.delimiter || (process.platform === 'win32' ? ';' : ':');
        this.paths = this.paths.split(delimiter);
    }
    this.paths = this.paths
        .filter(Boolean)
        .map(function (p) {
            return path.resolve(self.basedir, p);
        });
    
    this.transforms = [].concat(opts.transform).filter(Boolean);
    this.globalTransforms = [].concat(opts.globalTransform).filter(Boolean);
    this.resolver = opts.resolve || browserResolve;
    this.detective = opts.detect || detective;
    this.options = Object.assign({}, opts);
    if (!this.options.modules) this.options.modules = {};

    // If the caller passes options.expose, store resolved pathnames for exposed
    // modules in it. If not, set it anyway so it's defined later.
    if (!this.options.expose) this.options.expose = {};
    this.pending = 0;
    this.inputPending = 0;
    
    var topfile = path.join(this.basedir, '__fake.js');
    this.top = {
        id: topfile,
        filename: topfile,
        paths: this.paths,
        basedir: this.basedir
    };
}

ModuleDeps.prototype._isTopLevel = function (file) {
    var isTopLevel = this.entries.some(function (main) {
        var m = relativePath(path.dirname(main), file);
        return m.split(/[\\\/]/).indexOf('node_modules') < 0;
    });
    if (!isTopLevel) {
        var m = relativePath(this.basedir, file);
        isTopLevel = m.split(/[\\\/]/).indexOf('node_modules') < 0;
    }
    return isTopLevel;
};

ModuleDeps.prototype._transform = function (row, enc, next) {
    var self = this;
    if (typeof row === 'string') {
        row = { file: row };
    }
    if (row.transform && row.global) {
        this.globalTransforms.push([ row.transform, row.options ]);
        return next();
    }
    else if (row.transform) {
        this.transforms.push([ row.transform, row.options ]);
        return next();
    }
    
    self.pending ++;
    var basedir = defined(row.basedir, self.basedir);
    
    if (row.entry !== false) {
        self.entries.push(path.resolve(basedir, row.file || row.id));
    }
    
    self.lookupPackage(row.file, function (err, pkg) {
        if (err && self.options.ignoreMissing) {
            self.emit('missing', row.file, self.top);
            self.pending --;
            return next();
        }
        if (err) return self.emit('error', err)
        self.pending --;
        self._input.push({ row: row, pkg: pkg });
        next();
    });
};

ModuleDeps.prototype._flush = function () {
    var self = this;
    var files = {};
    self._input.forEach(function (r) {
        var w = r.row, f = files[w.file || w.id];
        if (f) {
            f.row.entry = f.row.entry || w.entry;
            var ex = f.row.expose || w.expose;
            f.row.expose = ex;
            if (ex && f.row.file === f.row.id && w.file !== w.id) {
                f.row.id = w.id;
            }
        }
        else files[w.file || w.id] = r;
    });
    
    Object.keys(files).forEach(function (key) {
        var r = files[key];
        var pkg = r.pkg || {};
        var dir = r.row.file ? path.dirname(r.row.file) : self.basedir;
        if (!pkg.__dirname) pkg.__dirname = dir;
        self.walk(r.row, Object.assign({}, self.top, {
            filename: path.join(dir, '_fake.js')
        }));
    });
    if (this.pending === 0) this.push(null);
    this._ended = true;
};

ModuleDeps.prototype.resolve = function (id, parent, cb) {
    var self = this;
    var opts = self.options;
    
    if (xhas(self.cache, parent.id, 'deps', id)
    && self.cache[parent.id].deps[id]) {
        var file = self.cache[parent.id].deps[id];
        var pkg = self.pkgCache[file];
        if (pkg) return cb(null, file, pkg);
        return self.lookupPackage(file, function (err, pkg) {
            cb(null, file, pkg);
        });
    }
    
    parent.packageFilter = function (p, x) {
        var pkgdir = path.dirname(x);
        if (opts.packageFilter) p = opts.packageFilter(p, x);
        p.__dirname = pkgdir;

        return p;
    };
    
    if (opts.extensions) parent.extensions = opts.extensions;
    if (opts.modules) parent.modules = opts.modules;
    
    self.resolver(id, parent, function onresolve (err, file, pkg, fakePath) {
        if (err) return cb(err);
        if (!file) return cb(new Error(
            'module not found: "' + id + '" from file '
            + parent.filename
        ));
        
        if (!pkg || !pkg.__dirname) {
            self.lookupPackage(file, function (err, p) {
                if (err) return cb(err);
                if (!p) p = {};
                if (!p.__dirname) p.__dirname = path.dirname(file);
                self.pkgCache[file] = p;
                onresolve(err, file, opts.packageFilter
                    ? opts.packageFilter(p, p.__dirname) : p,
                    fakePath
                );
            });
        }
        else cb(err, file, pkg, fakePath);
    });
};

ModuleDeps.prototype.readFile = function (file, id, pkg) {
    var self = this;
    if (xhas(this.fileCache, file)) {
        return toStream(this.fileCache[file]);
    }
    var rs = fs.createReadStream(file, {
        encoding: 'utf8'
    });
    return rs;
};

ModuleDeps.prototype.getTransforms = function (file, pkg, opts) {
    if (!opts) opts = {};
    var self = this;
    
    var isTopLevel;
    if (opts.builtin || opts.inNodeModules) isTopLevel = false;
    else isTopLevel = this._isTopLevel(file);
    
    var transforms = [].concat(isTopLevel ? this.transforms : [])
        .concat(getTransforms(pkg, {
            globalTransform: this.globalTransforms,
            transformKey: this.options.transformKey
        }))
    ;
    if (transforms.length === 0) return through();
    
    var pending = transforms.length;
    var streams = [];
    var input = through();
    var output = through();
    var dup = duplexer(input, output);
    
    for (var i = 0; i < transforms.length; i++) (function (i) {
        makeTransform(transforms[i], function (err, trs) {
            if (err) {
                return dup.emit('error', err);
            }
            streams[i] = trs;
            if (-- pending === 0) done();
        });
    })(i);
    return dup;
    
    function done () {
        var middle = combine.apply(null, streams);
        middle.on('error', function (err) {
            err.message += ' while parsing file: ' + file;
            if (!err.filename) err.filename = file;
            dup.emit('error', err);
        });
        input.pipe(middle).pipe(output);
    }
    
    function makeTransform (tr, cb) {
        var trOpts:any = {};
        if (Array.isArray(tr)) {
            trOpts = tr[1] || {};
            tr = tr[0];
        }
        trOpts._flags = trOpts.hasOwnProperty('_flags') ? trOpts._flags : self.options;
        if (typeof tr === 'function') {
            var t = tr(file, trOpts);
            // allow transforms to `stream.emit('dep', path)` to add dependencies for this file
            t.on('dep', function (dep) {
                if (!self._transformDeps[file]) self._transformDeps[file] = [];
                self._transformDeps[file].push(dep);
            });
            self.emit('transform', t, file);
            nextTick(cb, null, wrapTransform(t));
        }
        else {
            loadTransform(tr, trOpts, function (err, trs) {
                if (err) return cb(err);
                cb(null, wrapTransform(trs));
            });
        }
    }
    
    function loadTransform (id, trOpts, cb) {
        var params = {
            basedir: path.dirname(file),
            preserveSymlinks: false
        };
        nodeResolve(id, params, function nr (err, res, again) {
            if (err && again) return cb && cb(err);
            
            if (err) {
                params.basedir = pkg.__dirname;
                return nodeResolve(id, params, function (e, r) {
                    nr(e, r, true);
                });
            }
            
            if (!res) return cb(new Error(
                'cannot find transform module ' + id //tr
                + ' while transforming ' + file
            ));
            
            var r = require(res);
            if (typeof r !== 'function') {
                return cb(new Error(
                    'Unexpected ' + typeof r + ' exported by the '
                    + JSON.stringify(res) + ' package. '
                    + 'Expected a transform function.'
                ));
            }
            
            //@ts-ignore
            var trs = r(file, trOpts);
            // allow transforms to `stream.emit('dep', path)` to add dependencies for this file
            trs.on('dep', function (dep) {
                if (!self._transformDeps[file]) self._transformDeps[file] = [];
                self._transformDeps[file].push(dep);
            });
            self.emit('transform', trs, file);
            cb(null, trs);
        });
    }
};

ModuleDeps.prototype.walk = function (id, parent, cb) {
    var self = this;
    var opts = self.options;
    this.pending ++;
    
    var rec: any = {};
    var input;
    if (typeof id === 'object') {
        rec = Object.assign({},id);
        if (rec.entry === false) delete rec.entry;
        id = rec.file || rec.id;
        input = true;
        this.inputPending ++;
    }
    
    self.resolve(id, parent, function (err, file, pkg, fakePath) {
        // this is checked early because parent.modules is also modified
        // by this function.
        var builtin = has(parent.modules, id);

        if (rec.expose) {
            // Set options.expose to make the resolved pathname available to the
            // caller. They may or may not have requested it, but it's harmless
            // to set this if they didn't.
            self.options.expose[rec.expose] =
                self.options.modules[rec.expose] = file;
        }
        if (pkg && !self._emittedPkg[pkg.__dirname]) {
            self._emittedPkg[pkg.__dirname] = true;
            self.emit('package', pkg);
        }
        
        if (opts.postFilter && !opts.postFilter(id, file, pkg)) {
            if (--self.pending === 0) self.push(null);
            if (input) --self.inputPending;
            return cb && cb(null, undefined);
        }
        if (err && rec.source) {
            file = rec.file;
            
            var ts = self.getTransforms(file, pkg);
            ts.on('error', function (err) {
                self.emit('error', err);
            });
            ts.pipe(concat(function (body) {
                rec.source = body.toString('utf8');
                fromSource(file, rec.source, pkg);
            }));
            return ts.end(rec.source);
        }
        if (err && self.options.ignoreMissing) {
            if (--self.pending === 0) self.push(null);
            if (input) --self.inputPending;
            self.emit('missing', id, parent);
            return cb && cb(null, undefined);
        }
        if (err) return self.emit('error', err);
        if (self.visited[file]) {
            if (-- self.pending === 0) self.push(null);
            if (input) --self.inputPending;
            return cb && cb(null, file);
        }
        self.visited[file] = true;
        
        if (rec.source) {
            var ts = self.getTransforms(file, pkg);
            ts.on('error', function (err) {
                self.emit('error', err);
            });
            ts.pipe(concat(function (body) {
                rec.source = body.toString('utf8');
                fromSource(file, rec.source, pkg);
            }));
            return ts.end(rec.source);
        }
        
        var c = self.cache && self.cache[file];
        if (c) return fromDeps(file, c.source, c.package, fakePath, Object.keys(c.deps));
        
        self.persistentCache(file, id, pkg, persistentCacheFallback, function (err, c) {
            self.emit('file', file, id);
            if (err) {
                self.emit('error', err);
                return;
            }
            fromDeps(file, c.source, c.package, fakePath, Object.keys(c.deps));
        });

        function persistentCacheFallback (dataAsString, cb) {
            var stream = dataAsString ? toStream(dataAsString) : self.readFile(file, id, pkg).on('error', cb);
            stream
                .pipe(self.getTransforms(fakePath || file, pkg, {
                    builtin: builtin,
                    inNodeModules: parent.inNodeModules
                }))
                .on('error', cb)
                .pipe(concat(function (body) {
                    var src = body.toString('utf8');
                    try { var deps = getDeps(file, src); }
                    catch (err) { cb(err); }
                    if (deps) {
                        cb(null, {
                            source: src,
                            package: pkg,
                            deps: deps.reduce(function (deps, dep) {
                                deps[dep] = true;
                                return deps;
                            }, {})
                        });
                    }
                }));
        }
    });

    function getDeps (file, src) {
        var deps = rec.noparse ? [] : self.parseDeps(file, src);
        // dependencies emitted by transforms
        if (self._transformDeps[file]) deps = deps.concat(self._transformDeps[file]);
        return deps;
    }

    function fromSource (file, src, pkg, fakePath?) {
        var deps = getDeps(file, src);
        if (deps) fromDeps(file, src, pkg, fakePath, deps);
    }
    
    function fromDeps (file, src, pkg, fakePath, deps) {
        var p = deps.length;
        var resolved = {};
        
        if (input) --self.inputPending;
        
        (function resolve () {
            if (self.inputPending > 0) return setTimeout(resolve);
            deps.forEach(function (id) {
                if (opts.filter && !opts.filter(id)) {
                    resolved[id] = false;
                    if (--p === 0) done();
                    return;
                }
                var isTopLevel = self._isTopLevel(fakePath || file);
                var current = {
                    id: file,
                    filename: file,
                    basedir: path.dirname(file),
                    paths: self.paths,
                    package: pkg,
                    inNodeModules: parent.inNodeModules || !isTopLevel
                };
                self.walk(id, current, function (err, r) {
                    resolved[id] = r;
                    if (--p === 0) done();
                });
            });
            if (deps.length === 0) done();
        })();
        
        function done () {
            if (!rec.id) rec.id = file;
            if (!rec.source) rec.source = src;
            if (!rec.deps) rec.deps = resolved;
            if (!rec.file) rec.file = file;
            
            if (self.entries.indexOf(file) >= 0) {
                rec.entry = true;
            }
            self.push(rec);
            
            if (cb) cb(null, file);
            if (-- self.pending === 0) self.push(null);
        }
    }
};

ModuleDeps.prototype.parseDeps = function (file, src, cb) {
    var self = this;
    if (this.options.noParse === true) return [];
    if (/\.json$/.test(file)) return [];
    
    if (Array.isArray(this.options.noParse)
    && this.options.noParse.indexOf(file) >= 0) {
        return [];
    }
    
    try { var deps = self.detective(src) }
    catch (ex) {
        var message = ex && ex.message ? ex.message : ex;
        throw new Error(
            'Parsing file ' + file + ': ' + message
        );
    }
    return deps;
};

ModuleDeps.prototype.lookupPackage = function (file, cb) {
    var self = this;
    
    var cached = this.pkgCache[file];
    if (cached) return nextTick(cb, null, cached);
    if (cached === false) return nextTick(cb, null, undefined);
    
    var dirs = parents(file ? path.dirname(file) : self.basedir);
    
    (function next () {
        if (dirs.length === 0) {
            self.pkgCache[file] = false;
            return cb(null, undefined);
        }
        var dir = dirs.shift();
        if (dir.split(/[\\\/]/).slice(-1)[0] === 'node_modules') {
            return cb(null, undefined);
        }
        
        var pkgfile = path.join(dir, 'package.json');
        
        var cached = self.pkgCache[pkgfile];
        if (cached) return nextTick(cb, null, cached);
        else if (cached === false) return next();
        
        var pcached = self.pkgFileCachePending[pkgfile];
        if (pcached) return pcached.push(onpkg);
        pcached = self.pkgFileCachePending[pkgfile] = [];
        
        fs.readFile(pkgfile, function (err, src) {
            if (err) return onpkg();
            //@ts-ignore tested & parses package.json correctly(although quotes are inconsistent - none or '')
            try { var pkg = JSON.parse(src) }
            catch (err) {
                return onpkg(new Error([
                    err + ' while parsing json file ' + pkgfile
                ].join('')));
            }
            pkg.__dirname = dir;
            
            self.pkgCache[pkgfile] = pkg;
            self.pkgCache[file] = pkg;
            onpkg(null, pkg);
        });
        
        function onpkg (err?, pkg?) {
            if (self.pkgFileCachePending[pkgfile]) {
                var fns = self.pkgFileCachePending[pkgfile];
                delete self.pkgFileCachePending[pkgfile];
                fns.forEach(function (f) { f(err, pkg) });
            }
            if (err) cb(err);
            else if (pkg && typeof pkg === 'object') cb(null, pkg);
            else {
                self.pkgCache[pkgfile] = false;
                next();
            }
        }
    })();
};
 
function getTransforms (pkg, opts) {
    var trx = [];
    if (opts.transformKey) {
        var n = pkg;
        var keys = opts.transformKey;
        for (var i = 0; i < keys.length; i++) {
            if (n && typeof n === 'object') n = n[keys[i]];
            else break;
        }
        if (i === keys.length) {
            trx = [].concat(n).filter(Boolean);
        }
    }
    return trx.concat(opts.globalTransform || []);
}

function nextTick (cb?, ...stuff) {
    var args = [].slice.call(arguments, 1);
    process.nextTick(function () { cb.apply(null, args) });
}

function xhas (obj, ...args) {
    if (!obj) return false;
    for (var i = 1; i < arguments.length; i++) {
        var key = arguments[i];
        if (!has(obj, key)) return false;
        obj = obj[key];
    }
    return true;
}

function toStream (dataAsString) {
    var tr = through();
    tr.push(dataAsString);
    tr.push(null);
    return tr;
}

function has (obj, key) {
    return obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function wrapTransform (tr) {
    if (typeof tr.read === 'function') return tr;
    var input = through(), output = through();
    input.pipe(tr).pipe(output);
    var wrapper = duplexer(input, output);
    tr.on('error', function (err) { wrapper.emit('error', err) });
    return wrapper;
}


export { detective }

export default ModuleDeps