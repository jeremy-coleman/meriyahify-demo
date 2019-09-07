'use strict';
import fs from 'fs';
import path from 'path';
import { Transform } from 'stream';
import util from 'util';
import { detective } from './resolvers/module-deps';
import resolve from "./resolvers/resolve";
import { through } from './streamz';
var format = util.format
var inherits = util.inherits

var shimsCache =  {}
var shimsByPath     =  {};
var diagnostics = process.env.BROWSERIFYSHIM_DIAGNOSTICS;
var shimRequire = '__browserify_shim_require__';



/* -------------------------------------------------------------------------- */
/*                                   helpers                                  */
/* -------------------------------------------------------------------------- */

const isObject = value => typeof value === 'object' && value !== null;

function isDefined (identifier) {
  return 'typeof ' + identifier + ' !== "undefined"'
}

function ternary (condition, expr1, expr2) {
  return condition + ' ? ' + expr1 + ' : ' + expr2
}

function ap (args, fn) {
  return function () {
      var rest = [].slice.call(arguments)
          , first = args.slice()
      first.push.apply(first, rest)
      return fn.apply(this, first);
  };
}

ap.pa = pa;
function pa (args, fn) {
  return function () {
      var rest = [].slice.call(arguments)
      rest.push.apply(rest, args)
      return fn.apply(this, rest);
  };
}

ap.apa = apa;
function apa (left, right, fn) {
  return function () {
      return fn.apply(this,
          left.concat.apply(left, arguments).concat(right)
      );
  };
}

ap.partial = partial;
function partial (fn, ...other) {
  var args = [].slice.call(arguments, 1);
  return ap(args, fn) as (...args) => any
}

ap.partialRight = partialRight;
function partialRight (fn) {
  var args = [].slice.call(arguments, 1);
  return pa(args, fn);
}

ap.curry = curry;
function curry (fn) {
  return partial(partial, fn);
}

ap.curryRight = curryRight
function curryRight (fn) {
  return partial(partialRight, fn);
}

function hasRequire (code, id) {
  return new RequireChecker(code).has(id)
}

hasRequire.any = function anyRequire (code) {
  return new RequireChecker(code).any()
}

hasRequire.Checker = RequireChecker

function RequireChecker (code) {
  this.code = code
}

var anyRegExp = createRegExp('@?[A-Za-z0-9/_.-]+')
var matchOperatorsRegex = /[|\\{}()[\]^$+*?.-]/g;

function escapeStringRegexp(string) {
	if (typeof string !== 'string') {throw new TypeError('Expected a string');}
	return string.replace(matchOperatorsRegex, '\\$&');
};

RequireChecker.prototype.any = function anyRequire () {
  if (this._any != null) return this._any
  this._any = anyRegExp.test(this.code)
  return this._any
}

RequireChecker.prototype.has = function has (id) {
  if (!id) throw new Error('module id is required')
  return this.any() && createRegExp(escapeStringRegexp(id)).test(this.code)
}

function createRegExp (input) {
  return new RegExp([
    escapeStringRegexp('require('),
    '\\s*[\'"]',
    input,
    '[\'"]\\s*',
    escapeStringRegexp(')')
  ].join(''))
}

function replaceCodeText (text, replacements) {
  var offset = 0
  return replacements.reduce(function (text, update) {
    var start = update.start + offset
    var end = update.end + offset
    var replacement = update.replacement
    offset += (replacement.length - (end - start))
    return text.slice(0, start) + replacement + text.slice(end)
  }, text)
}

// Customized for this use-case
const isObjectCustom = value =>
	isObject(value) &&
	!(value instanceof RegExp) &&
	!(value instanceof Error) &&
	!(value instanceof Date);

const _mapObject = (object, mapper, options, isSeen = new WeakMap()) => {
	options = {
		deep: false,
		target: {},
		...options
	};

	if (isSeen.has(object)) {
		return isSeen.get(object);
	}

	isSeen.set(object, options.target);

	const {target} = options;
	delete options.target;

	const mapArray = array => array.map(element => isObjectCustom(element) ? _mapObject(element, mapper, options, isSeen) : element);
	if (Array.isArray(object)) {
		return mapArray(object);
	}

	for (const [key, value] of Object.entries(object)) {
		let [newKey, newValue] = mapper(key, value, object);

		if (options.deep && isObjectCustom(newValue)) {
			newValue = Array.isArray(newValue) ?
				mapArray(newValue) :
				_mapObject(newValue, mapper, options, isSeen);
		}

		target[newKey] = newValue;
	}

	return target;
};

var mapObject = (object, mapper, options?) => {
	if (!isObject(object)) {
		throw new TypeError(`Expected an object, got \`${object}\` (${typeof object})`);
	}

	return _mapObject(object, mapper, options);
};

function replaceRequires (code, replacements) {
  var checker = new hasRequire.Checker(code)
  var ids = Object.keys(replacements)
  if (!ids.some(checker.has, checker)) return code
  return replaceCodeText(code, detective
    .find(code, {nodes: true})
    .nodes
    .filter(requireLiteral)
    .map(function (node) {
      return Object.assign({},node, {replacement: replacements[node.arguments[0].value]})
    })
    .filter(function (node) {
      return node.replacement != null
    }))

}


//var split = require('dot-parts')
function dotParts (path) {
  var result = []
  var parts = path.split('.')
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i]
    while (part[part.length - 1] === '\\') {
      part = part.slice(0, -1) + '.'
      part += parts[++i]
    }
    result.push(part)
  }
  return result
}

//https://github.com/juliangruber/balanced-match/blob/master/index.js
function balanced(a, b, str) {
  if (a instanceof RegExp) a = maybeMatch(a, str);
  if (b instanceof RegExp) b = maybeMatch(b, str);

  var r = range(a, b, str);

  return r && {
    start: r[0],
    end: r[1],
    pre: str.slice(0, r[0]),
    body: str.slice(r[0] + a.length, r[1]),
    post: str.slice(r[1] + b.length)
  };
}

function maybeMatch(reg, str) {
  var m = str.match(reg);
  return m ? m[0] : null;
}

balanced.range = range;
function range(a, b, str) {
  var begs, beg, left, right, result;
  var ai = str.indexOf(a);
  var bi = str.indexOf(b, ai + 1);
  var i = ai;

  if (ai >= 0 && bi > 0) {
    begs = [];
    left = str.length;

    while (i >= 0 && !result) {
      if (i == ai) {
        begs.push(i);
        ai = str.indexOf(a, i + 1);
      } else if (begs.length == 1) {
        result = [ begs.pop(), bi ];
      } else {
        beg = begs.pop();
        if (beg < left) {
          left = beg;
          right = bi;
        }

        bi = str.indexOf(b, i + 1);
      }

      i = ai < bi && ai >= 0 ? ai : bi;
    }

    if (begs.length) {
      result = [ left, right ];
    }
  }

  return result;
}

  

function createAccessor (source, path) {

  var findCall = ap.partial(balanced, '(', ')')

  function accumulate (statement, property) {
    var callString = ''
    function append (body) {
      callString += '(' + body + ')'
    }
    var call = findCall(property)
    if (call) {
      property = call.pre
      append(call.body)
      var post = call.post
    }
    while (post) {
      call = findCall(post)
      append(call.body)
      post = call.post
    }
    return statement + "['" + property + "']" + callString
  }

  return dotParts(path).reduce(accumulate, source)
}



function globalize (property) {
  function parenthesize (string) {
    return '(' + string + ')'
  }

  return parenthesize(ternary(
    isDefined('window'),
    createAccessor('window', property),
    ternary(
      isDefined('global'),
      createAccessor('global', property),
      null
    )
  ))
}



function requireLiteral (node) {
  var arg = node.arguments[0]
  return arg && arg.type === 'Literal'
}






/* -------------------------------------------------------------------------- */
/*                                transformify                                */
/* -------------------------------------------------------------------------- */

inherits(StringTransform, Transform);
function StringTransform (fn, opts?) {
  // @ts-ignore
  if (!(this instanceof StringTransform)) return new StringTransform(fn, opts);
  opts = opts || {};
  
  Transform.call(this, opts);
  this.transformFn = fn;
  this.string = '';
}

StringTransform.prototype._transform = function (chunk, encoding, cb) {
  this.string += chunk.toString();  
  cb();
}

StringTransform.prototype._flush = function (cb) {
  try {
    var transformed = this.transformFn(this.string);
    this.push(transformed);
    cb();
  } catch (err) {
    cb(err);
  }
}

function transformify(fn) {
  return function (file) {
    //@ts-ignore
    return new StringTransform(fn);  
  }
};

/* -------------------------------------------------------------------------- */
/*                                  exposify                                  */
/* -------------------------------------------------------------------------- */




function expose (replacements, code) {
  replacements = mapObject(replacements, function (moduleId, globalId) {
    return [moduleId, globalize(globalId)]
  })
  return replaceRequires(code, replacements)
}


function exposify(file, opts) {
  opts = opts || {};
  opts.filePattern = opts.filePattern || filePattern;
  opts.expose = opts.expose || config;

  if (opts.filePattern && !opts.filePattern.test(file)) return through();

  if (typeof opts.expose !== 'object') {
   throw new Error('Please pass { expose: { ... } } to transform, set exposify.config or $EXPOSIFY_CONFIG so exposify knows what to expose');
  }
  // using transform options will pass non-option arguments as array on _
  if (Array.isArray(opts.expose._)) {
    delete opts.expose._
  }

  var tx = transformify(expose.bind(null, opts.expose));
  return tx(file);
};


var config = (function () {
  if (process.env.EXPOSIFY_CONFIG) {
    try {
      return JSON.parse(process.env.EXPOSIFY_CONFIG);
    } catch (err) {
      console.error('Invalid exposify config!');
      console.error(err.stack);
    }
  }
})();


var filePattern = /\.js$/;

export { expose, exposify };





/* -------------------------------------------------------------------------- */
/*                               browserify-shim                              */
/* -------------------------------------------------------------------------- */

function _inspectDebug(obj, depth) {
    return require('util').inspect(obj, false, depth || 5, true);
  }
function debug(...args) {
    if (diagnostics) console.error.apply(console, arguments);
}


debug.inspect = function inspect(obj, depth?) {
  if (diagnostics) console.error(_inspectDebug(obj, depth));
}

function inspect(obj, depth?) {
    return util.inspect(obj, false, depth || 5, true);
  }
  
function isPath(s) {
    return (/^[.]{0,2}[/\\]/).test(s);
  }
  



function splitPath(path) {
  var parts = path.split(/(\/|\\)/);
  if (!parts.length) return parts;
  // when path starts with a slash, the first part is empty string
  return !parts[0].length ? parts.slice(1) : parts;
}

function findParentDir(currentFullPath, clue, cb) {
  function testDir(parts) {
    if (parts.length === 0) return cb(null, null);

    var p = parts.join('');

    fs.exists(path.join(p, clue), function (itdoes) {
      if (itdoes) return cb(null, p);
      testDir(parts.slice(0, -1));
    });
  }

  testDir(splitPath(currentFullPath));
}

findParentDir.sync = function (currentFullPath, clue) {
  function testDir(parts) {
    if (parts.length === 0) return null;

    var p = parts.join('');

    var itdoes = fs.existsSync(path.join(p, clue));
    return itdoes ? p : testDir(parts.slice(0, -1));
  }

  return testDir(splitPath(currentFullPath));
}

function mothership(start, ismothership, cb) {
  (function findShip (root) {
    findParentDir(root, 'package.json', function (err, packageDir) {
      if (err) return cb(err);
      if (!packageDir) return cb();

      var pack;
      try {
        pack = require(path.join(packageDir, 'package.json'));
        if (ismothership(pack)) return cb(null, { path: path.join(packageDir, 'package.json'), pack: pack });
        findShip(path.resolve(root, '..'));
      } catch (e) {
        cb(e);
      }
    });

  })(start);
}


mothership.sync = function sync(start, ismothership) {
  return (function findShip (root) {
    var packageDir = findParentDir.sync(root, 'package.json')

      var pack;
      try {
        pack = require(path.join(packageDir, 'package.json'));
        if (ismothership(pack)) return { path: path.join(packageDir, 'package.json'), pack: pack };
        return findShip(path.resolve(root, '..'));
      } catch (e) {
        return false
      }

  })(start);
}


function rangeComparator(a, b) {
  return a.from > b.from ? 1 : -1;
}

//check how meriyah handles this
function getReplacements(fromName, toName, src) {
  var regex = new RegExp('^' + fromName);
  
  var res = detective.find(src, { word: fromName, nodes: true, parse: { tolerant: true, range: true } });
  return res.nodes.map(function (n) {
    var c = n.callee;
      var code = src.slice(c.range[0], c.range[1]).replace(regex, toName);
      return { from: c.range[0], to: c.range[1], code: code };
  });
}


/**
 * Replaces every function call named `from` with another one that is named `to`.
 *
 * #### Example
 *
 *    rename(src, 'log', 'print');
 *    // => log(x) becomes print(x)
 *
 * @name rename
 * @function
 * @param {string} origSrc the original source
 * @param {string} fromName name under which function is currently called
 * @param {string} toName name to which the function calls should be renamed
 * @return {string} source with function calls renamed
 */
function rename(fromName, toName, origSrc) {
  var src = origSrc;

  // ensure that at least one of the function call statements we want to replace is in the code
  // before we perform the expensive operation of finding them by creating an AST
  var regex = new RegExp(fromName + ' *\\(.*\\)');
  if (!regex.test(src)) return src
    
  // we need to remove hashbang BEFORE feeding src into detective, since if the latter replaces it our ranges are off
  // we are assuming that the hashbang is on the first line - if not this breaks horribly
  var hb = src.match(/^#![^\n]*\n/);
  var hbs = hb ? hb[0] : '';
  if (hb) src = src.slice(hbs.length);
  
  var offset = 0;
  return hbs + getReplacements(fromName, toName, src)
    .sort(rangeComparator)
    .reduce(function(acc, replacement) {
      var from = replacement.from + offset
        , to   = replacement.to + offset
        , code = replacement.code;

      // all ranges will be invalidated since we are changing the code
      // therefore keep track of the offset to adjust them in case we replace multiple requires
      var diff = code.length - (to - from);
      offset += diff;
      return acc.slice(0, from) + code + acc.slice(to);
    }, src);
}




function validate(key, config, dir) {
    var msg
      , details = 'When evaluating shim "' + key + '": ' + inspect(config) + '\ninside ' + dir + '\n';
  
    if (!config.hasOwnProperty('exports')) {
      msg = 'browserify-shim needs at least a path and exports to do its job, you are missing the exports. ' +
            '\nIf this module has no exports, specify exports as null.'
      throw new Error(details + msg);
    }
}
  
function updateCache(packageDir, pack, resolvedShims, exposeGlobals) {
    shimsCache[packageDir] = { pack: pack, shims: resolvedShims, exposeGlobals: exposeGlobals };
    Object.keys(resolvedShims).forEach(function(fullPath) {
      var shim = resolvedShims[fullPath]; 
      validate(fullPath, shim, packageDir);
      shimsByPath[fullPath] = shim;
    });
  }
  
function resolveDependsRelativeTo(dir, browser, depends, packDeps, messages) {
    var resolved;
  
    if (!depends) return undefined;
  
    return Object.keys(depends).reduce(function (acc, k) {
      if (browser[k]){
        acc[k] = depends[k];
        messages.push(format('Found depends "%s" exposed in browser field', k));
      } else if (!isPath(k)) {
        acc[k] = depends[k];
        if (packDeps[k]) {
          messages.push(format('Found depends "%s" as an installed dependency of the package', k));
        } else {
          messages.push(format('WARNING, depends "%s" is not a path, nor is it exposed in the browser field, nor was it found in package dependencies.', k));
        }
      } else {
        // otherwise resolve the path
        resolved = path.resolve(dir, k);
        acc[resolved] = depends[k];
        messages.push(format('Depends "%s" was resolved to be at [%s]', k, resolved));
      }
  
      return acc;
    }, {})
  }
  
function resolvePaths (packageDir, shimFileDir, browser, shims, packDeps, messages) {
    return Object.keys(shims)
      .reduce(function (acc, relPath) {
        var shim = shims[relPath];
        var exposed = browser[relPath];
        var shimPath;
  
        if (exposed) {
          // lib exposed under different name/path in package.json's browser field
          // and it is referred to by this alias in the shims (either external or in package.json)
          // i.e.: 'non-cjs': { ... } -> browser: { 'non-cjs': './vendor/non-cjs.js }
          shimPath = path.resolve(packageDir, exposed);
          messages.push(format('Found "%s" in browser field referencing "%s" and resolved it to "%s"', relPath, exposed, shimPath));
        } else if (shimFileDir) {
          // specified via relative path to shim file inside shim file
          // i.e. './vendor/non-cjs': { exports: .. } 
          shimPath = path.resolve(shimFileDir, relPath);
          messages.push(format('Resolved "%s" found in shim file to "%s"', relPath, shimPath));
        } else {
          // specified via relative path in package.json browserify-shim config
          // i.e. 'browserify-shim': { './vendor/non-cjs': 'noncjs' }
          shimPath = path.resolve(packageDir, relPath);
          messages.push(format('Resolved "%s" found in package.json to "%s"', relPath, shimPath));
        }
        var depends = resolveDependsRelativeTo(shimFileDir || packageDir, browser, shim.depends, packDeps, messages);
  
        acc[shimPath] = { exports: shim.exports, depends: depends };
        return acc;
      }, {});
  }
  
  function mapifyExposeGlobals(exposeGlobals) {
    return Object.keys(exposeGlobals)
      .reduce(function (acc, k) {
  
        var val = exposeGlobals[k];
        var parts = val.split(':');
  
        if (parts.length < 2 || !parts[1].length) { 
          throw new Error(
              'Expose Globals need to have the format "global:expression.\n"'
            + inspect({ key: k, value: val }) + 'does not.'
          );
        }
  
        // this also handle unlikely cases of 'global:_.someFunc(':')' with a `:` in the actual global expression
        parts.shift();
        acc[k] = parts.join(':');
  
        return acc;
      }, {});
  }
  
  function separateExposeGlobals(shims) {
    var onlyShims = {}
      , exposeGlobals = {};
  
    Object.keys(shims).forEach(function (k) {
      var val = shims[k]
        , exp = val && val.exports;
  
      if (exp && /^global\:/.test(exp)) {
        exposeGlobals[k] = exp;
      } else {
        onlyShims[k] = val;
      }
    });
  
    return { shims: onlyShims, exposeGlobals: mapifyExposeGlobals(exposeGlobals) };
  }
  
  function resolveFromShimFile(packageDir, pack, shimField, messages) {
    var shimFile =  path.join(packageDir, shimField)
      , shimFileDir = path.dirname(shimFile);
  
    var allShims = require(shimFile);
    var separated = separateExposeGlobals(allShims);
  
    var resolvedShims = resolvePaths(packageDir, shimFileDir, pack.browser || {}, separated.shims, pack.dependencies || {}, messages);
    return { shims: resolvedShims, exposeGlobals: separated.exposeGlobals };
  }
  
  function resolveInlineShims(packageDir, pack, shimField, messages) {
    var allShims = parseInlineShims(shimField);
    var separated = separateExposeGlobals(allShims);
  
    var resolvedShims = resolvePaths(packageDir, null, pack.browser || {}, separated.shims, pack.dependencies || {}, messages);
    return { shims: resolvedShims, exposeGlobals: separated.exposeGlobals };
  }
  

  function resolveShims (file, messages, cb) {
    // find the package.json that defines browserify-shim config for this file
    mothership(file, function (pack) { return !! pack['browserify-shim'] }, function (err, res) {
      if (err) return cb(err);
  
      if (!res || !res.pack) return cb(new Error('Unable to find a browserify-shim config section in the package.json for ' + file));
  
      var pack       = res.pack;
      var packFile   = res.path;
      var packageDir = path.dirname(packFile);
  
      // we cached this before which means it was also grouped by file
      var cached = shimsCache[packageDir];
      // if it was cached, that means any package fixes were applied as well
      if (cached) { 
        return cb(null, { 
            package_json       :  packFile
          , packageDir         :  packageDir
          , resolvedPreviously :  true
          , shim               :  shimsByPath[file]
          , exposeGlobals      :  cached.exposeGlobals
          , browser            :  pack.browser
          , 'browserify-shim'  :  pack['browserify-shim']
          , dependencies       :  pack.dependencies
        });
      }
  
        try {
          pack = require(packFile);
  
          var shimField = pack['browserify-shim'];
          if (!shimField) return cb(null, { package_json: packFile, shim: undefined }); 
  
          var resolved = typeof shimField === 'string'
            ? resolveFromShimFile(packageDir, pack, shimField, messages)
            : resolveInlineShims(packageDir, pack, shimField, messages);
  
          messages.push({ resolved: resolved.shims });
          updateCache(packageDir, pack, resolved.shims, resolved.exposeGlobals);
  
          cb(null, { 
              package_json      :  packFile
            , packageDir        :  packageDir 
            , shim              :  shimsByPath[file]
            , exposeGlobals     :  resolved.exposeGlobals
            , browser           :  pack.browser
            , 'browserify-shim' :  pack['browserify-shim']
            , dependencies      :  pack.dependencies
          });
  
        } catch (err) {
          console.trace();
          return cb(err);
        }
      });
  }





function requireDependencies(depends, packageRoot, browserAliases?, dependencies?) {
  if (!depends) return '';

  function customResolve (k) { 
    // resolve aliases to full paths to avoid conflicts when require is injected into a file
    // inside another package, i.e. the it's shim was defined in a package.json one level higher
    // aliases don't get resolved by browserify in that case, since it only looks in the package.json next to it
    var browserAlias = browserAliases && browserAliases[k]
      , dependency = dependencies && dependencies[k]
      , alias;
    
    try {
      // prefer browser aliases defined explicitly
      alias =  browserAlias 
        ? path.resolve(packageRoot, browserAlias) 

        // but also consider dependencies installed in the package in which shims were defined
        : dependency 
          ? resolve.sync(k, { basedir: packageRoot }) 

          // lets hope for the best that browserify will be able to resolve this, cause we can't
          : k;
    } catch (err) {
      // resolve.sync may fail, in which case we give up and hope browserify can figure it out
      alias = k;
    }

    return { alias: alias, exports: depends[k] || null }; 
  }

  function noResolve(k) { 
    return { alias: k, exports: depends[k] || null };
  }

  return Object.keys(depends)

    // if the package was looked up from the parent of its enclosing package we need to pre-resolve the depends
    .map(customResolve)
    .reduce(
      function (acc, dep) {
        var alias = dep.alias.replace(/\\/g, "\\\\");
        return dep.exports 
          // Example: jQuery = global.jQuery = require("jquery");
          // the global dangling variable is needed cause some libs reference it as such and it breaks outside of the browser,
          // i.e.: (function ($) { ... })( jQuery )
          // This little extra makes it work everywhere and since it's on top, it will be shadowed by any other definitions 
          // so it doesn't conflict with anything.
          ? acc + dep.exports + ' = global.' + dep.exports + ' = require("' + alias + '");\n'
          : acc + 'require("' + alias + '");\n';
      }
    , '\n; '
  );
}

function bindWindowWithExports(s, dependencies) {
  // purposely make module, exports, require and define be 'undefined',
  // but pass a function that allows exporting our dependency from the window or the context
  
  // This results in code similarly to this example which shims ember which depends on jquery:

  /**
   * -- browserify wrapper
   * function(require,module,exports){ 
   *
   *    -- our deps (which still have access to require)
   *    jquery = global.jquery = require("/full/path/to/jquery.js");
   *
   *    -- assigning shimmed require to actual require
   *    -- this shouldn't matter, but would fix cases where libraries reach __browserify_shim_require__(x) as long 
   *    -- as x was included in the bundle
   *
   *    __browserify_shim_require__=require;
   *
   *    -- also it won't hurt anything
   *
   *    -- browserify-shim wrapper
   *    (function browserifyShim(module, exports, require, define, browserify_shim__define__module__export__) { 
   *       -- inside this function neither module, exports, require, or define are defined
   *
   *       -- browserify_shim__define__module__export__ allows exporting (since module and exports aren't available)
   *       
   *       [..] -- code that needs shimming
   *
   *       -- exporting whatever ember attached to the window
   *       ; browserify_shim__define__module__export__(typeof ember != "undefined" ? ember : window.ember); 
   *
   *    }).call(global, undefined, undefined, undefined, undefined, function defineExport(ex) { module.exports = ex; });
   *    -- browserify-shim wrapper closed
   *  }
   *  -- browserify wrapper closed
   */

  // Shadowing require is necessary to fix code that tries to do common-js, but ends up requiring deps that cannot be resolved
  // In the case below we want the below condition to be false at run time.
  /**
   * if (!jQuery && typeof require === 'function') {
   *   jQuery = require('jquery');
   * }
   */

   // Additionally `require('jquery')` needs to be refactored to prevent browserify from looking for 'jquery' at bundle time.
   // The rewriting step happens inside the main @see shim function.
   // Thus it gets rewritten via rename-function-calls:
  /**
   * if (!jQuery && typeof require === 'function') {
   *   jQuery = __browserify_shim_removed_require__('jquery');
   * }
   */
  // The fact that __browserify_shim_removed_require__ is not defined doesn't matter since we never enter that block.

  return dependencies
      + '; var ' + shimRequire + '=require;' 
      + '(function browserifyShim(module, exports, require, define, browserify_shim__define__module__export__) {\n'
      + s 
      + '\n}).call(global, undefined, undefined, undefined, undefined, function defineExport(ex) { module.exports = ex; });\n';
}

function bindWindowWithoutExports(s, dependencies) {
  // if a module doesn't need anything to be exported, it is likely, that it exports itself properly
  // therefore it is not a good idea to override the module here, however we need to still disable require
  // all else is similar to @see bindWindowWithExports
  return dependencies
      + '; var ' + shimRequire + '=require;' 
      + '(function browserifyShim(module, define, require) {\n'
      + s 
      + '\n}).call(global, module, undefined, undefined);\n';
}

function moduleExport(exp) {
  return format('\n; browserify_shim__define__module__export__(typeof %s != "undefined" ? %s : window.%s);\n', exp, exp, exp);
}

function wrap(content, config, packageRoot, browserAliases) {
  var exported = config.exports
      ? content + moduleExport(config.exports)
      : content
  , dependencies = requireDependencies(config.depends, packageRoot, browserAliases)
  , boundWindow = config.exports
      ? bindWindowWithExports(exported, dependencies)
      : bindWindowWithoutExports(exported, dependencies);

  return boundWindow;
}

function shim(file) {
  var content = '';
  var stream = through(write, end);
  return stream;
  function write(buf) { content += buf; }
  function end() {
    var messages = [];
    resolveShims(file, messages, function (err, info) {
      if (err) {
        stream.emit('error', err);
        return stream.queue(null);
      }
      debug('');
      debug.inspect({ file: file, info: info, messages: messages });
      var eg = info.exposeGlobals;
      if(eg && Object.keys(eg)) {
        content = expose(eg, content);
      }
      if (info.shim) { 
        // at this point we consider all remaining (not exposified) require statements to be invalid (why else are we shimming this)
        content = rename('require', shimRequire, content);

        var transformed = wrap(content, info.shim, info.packageDir, info.browser)
        stream.queue(transformed);
      } else { 
        stream.queue(content);
      }

      stream.queue(null);
    });
  }
}

function parseDepends(deps) {
  if (!deps) return undefined;
  // allow depends: [ '..' ] and depends: '..'
  deps = Array.isArray(deps) ? deps : [ deps ];

  return deps.reduce(function (acc, d) {
      var parts = d.split(':');
      if (!parts 
          || parts.length > 2 
          || parts.length < 1
          || !parts[0]) 
        throw new Error('Invalid depends specification: "' + d + '". Needs to have format: "nameORpath:export"');
      parts = parts.map(function (p) { 
        return typeof p === 'string' ? p.trim() : p 
      });
        
      acc[parts[0]] = parts[1] || null;
      return acc;
    }, {});
}


function parseInlineShims(config) {
  return Object.keys(config)
    .reduce(function (acc, field) {
      var conf = config[field];
      // normalize two possible formats:
      //    "key": "export,
      //    "key": { "exports": "export" .. }
      if (typeof conf === 'string') conf = { exports: conf };

      var exps = conf.exports && conf.exports.length ? conf.exports.trim() : null;

      acc[field.trim()] = {
          exports: exps 
        , depends: parseDepends(conf.depends)
      }

      return acc;
    }, {});
}


export default shim
