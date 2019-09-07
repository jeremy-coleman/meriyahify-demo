import fs from 'fs';
import path from 'path';
const builtin = require('module').builtinModules;
var core = new Set(builtin)


function normalizeOptions(x, opts) {
  /**
   * This file is purposefully a passthrough. It's expected that third-party
   * environments will override it at runtime in order to inject special logic
   * into `resolve` (by manipulating the options). One such example is the PnP
   * code path in Yarn.
   */
  return opts || {};
};

var getNodeModulesDirs = function getNodeModulesDirs(absoluteStart, modules) {
  var prefix = '/';
  if ((/^([A-Za-z]:)/).test(absoluteStart)) {
      prefix = '';
  } else if ((/^\\\\/).test(absoluteStart)) {
      prefix = '\\\\';
  }

  var paths = [absoluteStart];
  var parsed = path.parse(absoluteStart);
  while (parsed.dir !== paths[paths.length - 1]) {
      paths.push(parsed.dir);
      parsed = path.parse(parsed.dir);
  }

  return paths.reduce(function (dirs, aPath) {
      return dirs.concat(modules.map(function (moduleDir) {
          return path.resolve(prefix, aPath, moduleDir);
      }));
  }, []);
};

function nodeModulesPaths(start, opts, request) {
  var modules = opts && opts.moduleDirectory
      ? [].concat(opts.moduleDirectory)
      : ['node_modules'];

  if (opts && typeof opts.paths === 'function') {
      return opts.paths(
          request,
          start,
          function () { return getNodeModulesDirs(start, modules); },
          opts
      );
  }

  var dirs = getNodeModulesDirs(start, modules);
  return opts && opts.paths ? dirs.concat(opts.paths) : dirs;
};



function caller() {
  // see https://code.google.com/p/v8/wiki/JavaScriptStackTraceApi
  var origPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = function (_, stack) { return stack; };
  var stack = (new Error()).stack;
  Error.prepareStackTrace = origPrepareStackTrace;
  //@ts-ignore
  return stack[2].getFileName();
};

var defaultIsFile = function isFile(file, cb) {
    fs.stat(file, function (err, stat) {
        if (!err) {
            return cb(null, stat.isFile() || stat.isFIFO());
        }
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return cb(null, false);
        return cb(err);
    });
};

var defaultIsDir = function isDirectory(dir, cb) {
    fs.stat(dir, function (err, stat) {
        if (!err) {
            return cb(null, stat.isDirectory());
        }
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return cb(null, false);
        return cb(err);
    });
};


function resolve(x, options, callback) {
    var cb = callback;
    var opts = options;
    if (typeof options === 'function') {
        cb = opts;
        opts = {};
    }
    if (typeof x !== 'string') {
        var err = new TypeError('Path must be a string.');
        return process.nextTick(function () {
            cb(err);
        });
    }

    opts = normalizeOptions(x, opts);

    var isFile = opts.isFile || defaultIsFile;
    var isDirectory = opts.isDirectory || defaultIsDir;
    var readFile = opts.readFile || fs.readFile;

    var extensions = opts.extensions || ['.js'];
    var basedir = opts.basedir || path.dirname(caller());
    var parent = opts.filename || basedir;

    opts.paths = opts.paths || [];

    // ensure that `basedir` is an absolute path at this point, resolving against the process' current working directory
    var absoluteStart = path.resolve(basedir);

    if (opts.preserveSymlinks === false) {
        fs.realpath(absoluteStart, function (realPathErr, realStart) {
            if (realPathErr && realPathErr.code !== 'ENOENT') cb(err);
            else init(realPathErr ? absoluteStart : realStart);
        });
    } else {
        init(absoluteStart);
    }

    var res;
    function init(basedir) {
        if ((/^(?:\.\.?(?:\/|$)|\/|([A-Za-z]:)?[/\\])/).test(x)) {
            res = path.resolve(basedir, x);
            if (x === '..' || x.slice(-1) === '/') res += '/';
            if ((/\/$/).test(x) && res === basedir) {
                loadAsDirectory(res, opts.package, onfile);
            } else loadAsFile(res, opts.package, onfile);
        } else loadNodeModules(x, basedir, function (err, n, pkg) {
            if (err) cb(err);
            else if (core.has(x)) return cb(null, x);
            else if (n) cb(null, n, pkg);
            else {
                var moduleError = new Error("Cannot find module '" + x + "' from '" + parent + "'");
                //@ts-ignore
                moduleError.code = 'MODULE_NOT_FOUND';
                cb(moduleError);
            }
        });
    }

    function onfile(err, m, pkg) {
        if (err) cb(err);
        else if (m) cb(null, m, pkg);
        else loadAsDirectory(res, function (err, d, pkg) {
            if (err) cb(err);
            else if (d) cb(null, d, pkg);
            else {
                var moduleError = new Error("Cannot find module '" + x + "' from '" + parent + "'");
                //@ts-ignore
                moduleError.code = 'MODULE_NOT_FOUND';
                cb(moduleError);
            }
        });
    }

    function loadAsFile(x, thePackage, callback) {
        var loadAsFilePackage = thePackage;
        var cb = callback;
        if (typeof loadAsFilePackage === 'function') {
            cb = loadAsFilePackage;
            loadAsFilePackage = undefined;
        }

        var exts = [''].concat(extensions);
        load(exts, x, loadAsFilePackage);

        function load(exts, x, loadPackage) {
            if (exts.length === 0) return cb(null, undefined, loadPackage);
            var file = x + exts[0];

            var pkg = loadPackage;
            if (pkg) onpkg(null, pkg);
            else loadpkg(path.dirname(file), onpkg);

            function onpkg(err, pkg_, dir?) {
                pkg = pkg_;
                if (err) return cb(err);
                if (dir && pkg && opts.pathFilter) {
                    var rfile = path.relative(dir, file);
                    var rel = rfile.slice(0, rfile.length - exts[0].length);
                    var r = opts.pathFilter(pkg, x, rel);
                    if (r) return load(
                        [''].concat(extensions.slice()),
                        path.resolve(dir, r),
                        pkg
                    );
                }
                isFile(file, onex);
            }
            function onex(err, ex) {
                if (err) return cb(err);
                if (ex) return cb(null, file, pkg);
                load(exts.slice(1), x, pkg);
            }
        }
    }

    function loadpkg(dir, cb) {
        if (dir === '' || dir === '/') return cb(null);
        if (process.platform === 'win32' && (/^\w:[/\\]*$/).test(dir)) {
            return cb(null);
        }
        if ((/[/\\]node_modules[/\\]*$/).test(dir)) return cb(null);

        var pkgfile = path.join(dir, 'package.json');
        isFile(pkgfile, function (err, ex) {
            // on err, ex is false
            if (!ex) return loadpkg(path.dirname(dir), cb);

            readFile(pkgfile, function (err, body) {
                if (err) cb(err);
                try { var pkg = JSON.parse(body); } catch (jsonErr) {}

                if (pkg && opts.packageFilter) {
                    pkg = opts.packageFilter(pkg, pkgfile);
                }
                cb(null, pkg, dir);
            });
        });
    }

    function loadAsDirectory(x, loadAsDirectoryPackage, callback?) {
        var cb = callback;
        var fpkg = loadAsDirectoryPackage;
        if (typeof fpkg === 'function') {
            cb = fpkg;
            fpkg = opts.package;
        }

        var pkgfile = path.join(x, 'package.json');
        isFile(pkgfile, function (err, ex) {
            if (err) return cb(err);
            if (!ex) return loadAsFile(path.join(x, 'index'), fpkg, cb);

            readFile(pkgfile, function (err, body) {
                if (err) return cb(err);
                try {
                    var pkg = JSON.parse(body);
                } catch (jsonErr) {}

                if (opts.packageFilter) {
                    pkg = opts.packageFilter(pkg, pkgfile);
                }

                if (pkg.main) {
                    if (typeof pkg.main !== 'string') {
                        var mainError = new TypeError('package “' + pkg.name + '” `main` must be a string');
                        //@ts-ignore
                        mainError.code = 'INVALID_PACKAGE_MAIN';
                        return cb(mainError);
                    }
                    if (pkg.main === '.' || pkg.main === './') {
                        pkg.main = 'index';
                    }
                    loadAsFile(path.resolve(x, pkg.main), pkg, function (err, m, pkg) {
                        if (err) return cb(err);
                        if (m) return cb(null, m, pkg);
                        if (!pkg) return loadAsFile(path.join(x, 'index'), pkg, cb);

                        var dir = path.resolve(x, pkg.main);
                        loadAsDirectory(dir, pkg, function (err, n, pkg) {
                            if (err) return cb(err);
                            if (n) return cb(null, n, pkg);
                            loadAsFile(path.join(x, 'index'), pkg, cb);
                        });
                    });
                    return;
                }

                loadAsFile(path.join(x, '/index'), pkg, cb);
            });
        });
    }

    function processDirs(cb, dirs) {
        if (dirs.length === 0) return cb(null, undefined);
        var dir = dirs[0];

        isDirectory(dir, isdir);

        function isdir(err, isdir) {
            if (err) return cb(err);
            if (!isdir) return processDirs(cb, dirs.slice(1));
            var file = path.join(dir, x);
            loadAsFile(file, opts.package, onfile);
        }

        function onfile(err, m, pkg) {
            if (err) return cb(err);
            if (m) return cb(null, m, pkg);
            loadAsDirectory(path.join(dir, x), opts.package, ondir);
        }

        function ondir(err, n, pkg) {
            if (err) return cb(err);
            if (n) return cb(null, n, pkg);
            processDirs(cb, dirs.slice(1));
        }
    }
    function loadNodeModules(x, start, cb) {
        processDirs(cb, nodeModulesPaths(start, opts, x));
    }
};

function isFile(file) {
    try {
        var stat = fs.statSync(file);
    } catch (e) {
        if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return false;
        throw e;
    }
    return stat.isFile() || stat.isFIFO();
};

var defaultIsDirSync = function isDirectory(dir) {
    try {
        var stat = fs.statSync(dir);
    } catch (e) {
        if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return false;
        throw e;
    }
    return stat.isDirectory();
};

var maybeUnwrapSymlink = function maybeUnwrapSymlink(x, opts) {
    if (!opts || !opts.preserveSymlinks) {
        try {
            return fs.realpathSync(x);
        } catch (realPathErr) {
            if (realPathErr.code !== 'ENOENT') {
                throw realPathErr;
            }
        }
    }
    return x;
};

function sync(x, options) {
    if (typeof x !== 'string') {
        throw new TypeError('Path must be a string.');
    }
    var opts = normalizeOptions(x, options);

    var isFile = opts.isFile || defaultIsFile;
    var isDirectory = opts.isDirectory || defaultIsDirSync;
    var readFileSync = opts.readFileSync || fs.readFileSync;

    var extensions = opts.extensions || ['.js'];
    var basedir = opts.basedir || path.dirname(caller());
    var parent = opts.filename || basedir;

    opts.paths = opts.paths || [];

    // ensure that `basedir` is an absolute path at this point, resolving against the process' current working directory
    var absoluteStart = maybeUnwrapSymlink(path.resolve(basedir), opts);

    if (opts.basedir && !isDirectory(absoluteStart)) {
        var dirError = new TypeError('Provided basedir "' + opts.basedir + '" is not a directory' + (opts.preserveSymlinks ? '' : ', or a symlink to a directory'));
        //@ts-ignore
        dirError.code = 'INVALID_BASEDIR';
        throw dirError;
    }

    if ((/^(?:\.\.?(?:\/|$)|\/|([A-Za-z]:)?[/\\])/).test(x)) {
        var res = path.resolve(absoluteStart, x);
        if (x === '..' || x.slice(-1) === '/') res += '/';
        var m = loadAsFileSync(res) || loadAsDirectorySync(res);
        if (m) return maybeUnwrapSymlink(m, opts);
    } else if (core[x]) {
        return x;
    } else {
        var n = loadNodeModulesSync(x, absoluteStart);
        if (n) return maybeUnwrapSymlink(n, opts);
    }

    if (core[x]) return x;

    var err = new Error("Cannot find module '" + x + "' from '" + parent + "'");
    //@ts-ignore
    err.code = 'MODULE_NOT_FOUND';
    throw err;

    function loadAsFileSync(x) {
        var pkg = loadpkg(path.dirname(x));

        if (pkg && pkg.dir && pkg.pkg && opts.pathFilter) {
            var rfile = path.relative(pkg.dir, x);
            var r = opts.pathFilter(pkg.pkg, x, rfile);
            if (r) {
                x = path.resolve(pkg.dir, r); // eslint-disable-line no-param-reassign
            }
        }

        if (isFile(x)) {
            return x;
        }

        for (var i = 0; i < extensions.length; i++) {
            var file = x + extensions[i];
            if (isFile(file)) {
                return file;
            }
        }
    }

    function loadpkg(dir) {
        if (dir === '' || dir === '/') return;
        if (process.platform === 'win32' && (/^\w:[/\\]*$/).test(dir)) {
            return;
        }
        if ((/[/\\]node_modules[/\\]*$/).test(dir)) return;

        var pkgfile = path.join(dir, 'package.json');

        if (!isFile(pkgfile)) {
            return loadpkg(path.dirname(dir));
        }

        var body = readFileSync(pkgfile);

        try {
            var pkg = JSON.parse(body);
        } catch (jsonErr) {}

        if (pkg && opts.packageFilter) {
            pkg = opts.packageFilter(pkg, pkgfile, dir);
        }

        return { pkg: pkg, dir: dir };
    }

    function loadAsDirectorySync(x) {
        var pkgfile = path.join(x, '/package.json');
        if (isFile(pkgfile)) {
            try {
                var body = readFileSync(pkgfile, 'UTF8');
                var pkg = JSON.parse(body);
            } catch (e) {}

            if (opts.packageFilter) {
                pkg = opts.packageFilter(pkg, x);
            }

            if (pkg.main) {
                if (typeof pkg.main !== 'string') {
                    var mainError = new TypeError('package “' + pkg.name + '” `main` must be a string');
                    //@ts-ignore
                    mainError.code = 'INVALID_PACKAGE_MAIN';
                    throw mainError;
                }
                if (pkg.main === '.' || pkg.main === './') {
                    pkg.main = 'index';
                }
                try {
                    var m = loadAsFileSync(path.resolve(x, pkg.main));
                    if (m) return m;
                    var n = loadAsDirectorySync(path.resolve(x, pkg.main));
                    if (n) return n;
                } catch (e) {}
            }
        }

        return loadAsFileSync(path.join(x, '/index'));
    }

    function loadNodeModulesSync(x, start) {
        var dirs = nodeModulesPaths(start, opts, x);
        for (var i = 0; i < dirs.length; i++) {
            var dir = dirs[i];
            if (isDirectory(dir)) {
                var m = loadAsFileSync(path.join(dir, '/', x));
                if (m) return m;
                var n = loadAsDirectorySync(path.join(dir, '/', x));
                if (n) return n;
            }
        }
    }
};

resolve.sync = sync
export default resolve