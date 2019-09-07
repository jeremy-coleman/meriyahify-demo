'use strict'

import fs from 'fs'
import path from 'path'
import postcss from 'postcss'
import extractImports from 'postcss-modules-extract-imports'
import localByDefault from 'postcss-modules-local-by-default'
import scope from 'postcss-modules-scope'
import values from 'postcss-modules-values'
import { through } from './streamz'


/* -------------------------------------------------------------------------- */
/*                              css modules stuff                             */
/* -------------------------------------------------------------------------- */


var matchConstName = /[$#]?[\w-\.]+/g;

function replaceAll(replacements, text) {
  var matches = void 0;
  while (matches = matchConstName.exec(text)) {
    var replacement = replacements[matches[0]];
    if (replacement) {
      text = text.slice(0, matches.index) + replacement + text.slice(matchConstName.lastIndex);
      matchConstName.lastIndex -= matches[0].length - replacement.length;
    }
  }
  return text;
}

function replaceSymbols(css, translations) {
  css.walkDecls(function (decl) {
    return decl.value = replaceAll(translations, decl.value);
  });
  css.walkAtRules('media', function (atRule) {
    return atRule.params = replaceAll(translations, atRule.params);
  });
};

const importRegexp = /^:import\((.+)\)$/

class Parser {
  pathFetcher: any
  exportTokens: {}
  translations: {}
  trace: any
  
  constructor( pathFetcher, trace ) {
    this.pathFetcher = pathFetcher
    this.plugin = this.plugin.bind( this )
    this.exportTokens = {}
    this.translations = {}
    this.trace = trace
  }

  plugin( css, result ) {
    return Promise.all( this.fetchAllImports( css ) )
      .then( _ => this.linkImportedSymbols( css ) )
      .then( _ => this.extractExports( css ) )
  }

  fetchAllImports( css ) {
    let imports = []
    css.each( node => {
      if ( node.type == "rule" && node.selector.match( importRegexp ) ) {
        imports.push( this.fetchImport( node, css.source.input.from, imports.length ) )
      }
    } )
    return imports
  }

  linkImportedSymbols( css ) {
    replaceSymbols(css, this.translations)
  }

  extractExports( css ) {
    css.each( node => {
      if ( node.type == "rule" && node.selector == ":export" ) this.handleExport( node )
    } )
  }

  handleExport( exportNode ) {
    exportNode.each( decl => {
      if ( decl.type == 'decl' ) {
        Object.keys(this.translations).forEach( translation => {
          decl.value = decl.value.replace(translation, this.translations[translation])
        } )
        this.exportTokens[decl.prop] = decl.value
      }
    } )
    exportNode.remove()
  }

  fetchImport( importNode, relativeTo, depNr ) {
    let file = importNode.selector.match( importRegexp )[1],
      depTrace = this.trace + String.fromCharCode(depNr)
    return this.pathFetcher( file, relativeTo, depTrace ).then( exports => {
      importNode.each( decl => {
        if ( decl.type == 'decl' ) {
          this.translations[decl.prop] = exports[decl.value]
        }
      } )
      importNode.remove()
    }, err => console.log( err ) )
  }
}
// Sorts dependencies in the following way:
// AAA comes before AA and A
// AB comes after AA and before A
// All Bs come after all As
// This ensures that the files are always returned in the following order:
// - In the order they were required, except
// - After all their dependencies
const traceKeySorter = ( a, b ) => {
  if ( a.length < b.length ) {
    return a < b.substring( 0, a.length ) ? -1 : 1
  } else if ( a.length > b.length ) {
    return a.substring( 0, b.length ) <= b ? -1 : 1
  } else {
    return a < b ? -1 : 1
  }
};

export class FileSystemLoader {
  root: any
  sources: {}
  traces: {}
  importNr: number
  core: Core
  tokensByFile: {}
  constructor( root, plugins ) {
    this.root = root
    this.sources = {}
    this.traces = {}
    this.importNr = 0
    this.core = new Core(plugins)
    this.tokensByFile = {};
  }

  fetch( _newPath, relativeTo, _trace ) {
    let newPath = _newPath.replace( /^["']|["']$/g, "" ),
      trace = _trace || String.fromCharCode( this.importNr++ )
    return new Promise( ( resolve, reject ) => {
      let relativeDir = path.dirname( relativeTo ),
        rootRelativePath = path.resolve( relativeDir, newPath ),
        fileRelativePath = path.resolve( path.join( this.root, relativeDir ), newPath )

      // if the path is not relative or absolute, try to resolve it in node_modules
      if (newPath[0] !== '.' && newPath[0] !== '/') {
        try {
          fileRelativePath = require.resolve(newPath);
        }
        catch (e) {}
      }

      const tokens = this.tokensByFile[fileRelativePath]
      if (tokens) { return resolve(tokens) }

      fs.readFile( fileRelativePath, "utf-8", ( err, source ) => {
        if ( err ) reject( err )
        this.core.load( source, rootRelativePath, trace, this.fetch.bind( this ) )
          .then( ( { injectableSource, exportTokens } ) => {
            this.sources[fileRelativePath] = injectableSource
            this.traces[trace] = fileRelativePath
            this.tokensByFile[fileRelativePath] = exportTokens
            resolve( exportTokens )
          }, reject )
      } )
    } )
  }

  get finalSource() {
    const traces = this.traces
    const sources = this.sources
    let written = new Set()

    return Object.keys( traces ).sort( traceKeySorter ).map(key => {
      const filename = traces[key]
      if (written.has(filename)) { return null }
      written.add(filename)

      return sources[filename];
    }).join( "" )
  }
}



  


export class Core {
  plugins: any
  static defaultPlugins: any
  static values: any
  static localByDefault: any
  static extractImports: any
  static scope: any
  constructor( plugins? ) {
    this.plugins = plugins || Core.defaultPlugins
  }

  load( sourceString, sourcePath, trace?, pathFetcher ?) {
    let parser = new Parser( pathFetcher, trace )

    return postcss( this.plugins.concat( [parser.plugin] ) )
      .process( sourceString, { from: "/" + sourcePath } )
      .then( result => {
        return { injectableSource: result.css, exportTokens: parser.exportTokens }
      } )
  }
}

// These four plugins are aliased under this package for simplicity.
Core.values = values
Core.localByDefault = localByDefault
Core.extractImports = extractImports
Core.scope = scope

Core.defaultPlugins = [values, localByDefault, extractImports, scope]




/* -------------------------------------------------------------------------- */
/*                                 stringifier                                */
/* -------------------------------------------------------------------------- */

function isObject(val) {
  return val != null && typeof val === 'object' && Array.isArray(val) === false;
};

function isObjectObject(o) {
  return isObject(o) === true
    && Object.prototype.toString.call(o) === '[object Object]';
}

function isRegexp(re) {
	return Object.prototype.toString.call(re) === '[object RegExp]';
};


function isPlainObject(o) {
  var ctor,prot;

  if (isObjectObject(o) === false) return false;

  // If has modified constructor
  ctor = o.constructor;
  if (typeof ctor !== 'function') return false;

  // If has modified prototype
  prot = ctor.prototype;
  if (isObjectObject(prot) === false) return false;

  // If constructor does not have an Object-specific method
  if (prot.hasOwnProperty('isPrototypeOf') === false) {
    return false;
  }

  // Most likely a plain Object
  return true;
};


function stringifyObject(val, opts?, pad?) {
	var seen = [];

	return (function stringify(val, opts?, pad?) {
		opts = opts || {};
		opts.indent = opts.indent || '\t';
		pad = pad || '';
		var tokens;
		if(opts.inlineCharacterLimit == void 0) {
			tokens = {
				newLine: '\n',
				newLineOrSpace: '\n',
				pad: pad,
				indent: pad + opts.indent
			};
		} else {
			tokens = {
				newLine: '@@__STRINGIFY_OBJECT_NEW_LINE__@@',
				newLineOrSpace: '@@__STRINGIFY_OBJECT_NEW_LINE_OR_SPACE__@@',
				pad: '@@__STRINGIFY_OBJECT_PAD__@@',
				indent: '@@__STRINGIFY_OBJECT_INDENT__@@'
			}
		}
		var expandWhiteSpace = function(string) {
			if (opts.inlineCharacterLimit == void 0) { return string; }
			var oneLined = string.
				replace(new RegExp(tokens.newLine, 'g'), '').
				replace(new RegExp(tokens.newLineOrSpace, 'g'), ' ').
				replace(new RegExp(tokens.pad + '|' + tokens.indent, 'g'), '');

			if(oneLined.length <= opts.inlineCharacterLimit) {
				return oneLined;
			} else {
				return string.
					replace(new RegExp(tokens.newLine + '|' + tokens.newLineOrSpace, 'g'), '\n').
					replace(new RegExp(tokens.pad, 'g'), pad).
					replace(new RegExp(tokens.indent, 'g'), pad + opts.indent);
			}
		};

		if (seen.indexOf(val) !== -1) {
			return '"[Circular]"';
		}

		if (val === null ||
			val === undefined ||
			typeof val === 'number' ||
			typeof val === 'boolean' ||
			typeof val === 'function' ||
			isRegexp(val)) {
			return String(val);
		}

		if (val instanceof Date) {
			return 'new Date(\'' + val.toISOString() + '\')';
		}

		if (Array.isArray(val)) {
			if (val.length === 0) {
				return '[]';
			}

			seen.push(val);

			var ret = '[' + tokens.newLine + val.map(function (el, i) {
				var eol = val.length - 1 === i ? tokens.newLine : ',' + tokens.newLineOrSpace;
				return tokens.indent + stringify(el, opts, pad + opts.indent) + eol;
			}).join('') + tokens.pad + ']';

      //idk
      //@ts-ignore
			seen.pop(val);

			return expandWhiteSpace(ret);
		}

		if (isPlainObject(val)) {
			var objKeys = Object.keys(val);

			if (objKeys.length === 0) {
				return '{}';
			}

			seen.push(val);

			var ret : any = '{' + tokens.newLine + objKeys.map(function (el, i) {
				if (opts.filter && !opts.filter(val, el)) {
					return '';
				}

				var eol = objKeys.length - 1 === i ? tokens.newLine : ',' + tokens.newLineOrSpace;
				var key = /^[a-z$_][a-z$_0-9]*$/i.test(el) ? el : stringify(el, opts);
				return tokens.indent + key + ': ' + stringify(val[el], opts, pad + opts.indent) + eol;
			}).join('') + tokens.pad + '}';

      //idk why this has an arg but whatever
      //@ts-ignore
			seen.pop(val);

			return expandWhiteSpace(ret);
		}

		val = String(val).replace(/[\r\n]/g, function (x) {
			return x === '\n' ? '\\n' : '\\r';
		});

		if (opts.singleQuotes === false) {
			return '"' + val.replace(/"/g, '\\\"') + '"';
		}

		return '\'' + val.replace(/'/g, '\\\'') + '\'';
	})(val, opts, pad);
};


var cssRE = /\.css$/i
var RegExpRE = /^\/(.*)\/(.*)$/


function stringHash(str) {
  var hash = 5381
  var i    = str.length;
  while(i) {
    hash = (hash * 33) ^ str.charCodeAt(--i);
  }
  //always positive,
  return hash >>> 0;
}

function escapeCss (css) {
  return JSON.stringify(css)
}

function hash (str) {
  return '_' + stringHash(str).toString(36)
}

function generateHashName (styleName, fileName) {
  return hash(fileName + ':' + styleName)
}

function generateDebugName (styleName, fileName) {
  var sanitisedPath = fileName
    .replace(/\.[^\.\/\\]+$/, '')
    .replace(/[\W_]+/g, '_')
    .replace(/^_|_$/g, '')

  return '_' + sanitisedPath + '__' + styleName
}


/* -------------------------------------------------------------------------- */
/*                                   cssify                                   */
/* -------------------------------------------------------------------------- */


type CssifyOptions = {
  'auto-inject'?: boolean,
  'no-auto-inject'?: boolean,
  modules?: boolean,
  debug?: boolean,
  test?: RegExp | Function | string
}

function wrapCss (fileName, css, options? : CssifyOptions, map?) {
  var escapedCss = escapeCss(css)
  var stringifiedMap = stringifyObject(map)
  //var packagePath = path.join(__dirname, '..')
  //var dirName = path.dirname(fileName)
  //var requirePath = path.relative(dirName, packagePath)

  // On Windows, path.relative returns unescaped backslashes and
  // that causes cssify to not be findable.
  //requirePath = requirePath.replace(/\\/g, '/')

  //this is the client-side js require path
  var requirePath = path.join(__dirname, 'cssifyb', 'browser.js').replace(/\\/g, '/')

  var moduleSource = options['auto-inject']
    ? [
      //'var inject = require(\'./' + requirePath + '\');',
      'var inject = require(\'' + requirePath + '\');',
      'var css = ' + escapedCss + ';',
      'inject(css, undefined, \'' + hash(fileName) + '\');',
      options.modules
        ? 'module.exports = ' + stringifiedMap + ';'
        : 'module.exports = css;'
    ].join('\n') + '\n'
    : options.modules
      ? 'module.exports = { css: ' + escapedCss + ', map: ' + stringifiedMap + ' };\n'
      : 'module.exports = ' + escapedCss + ';\n'

  return moduleSource
}

function processCss (fileName, source, options: CssifyOptions) {
  if (options.modules) {
    Core.scope.generateScopedName = options.debug
      ? generateDebugName
      : generateHashName

    var core = new Core()

    return core.load(source, path.relative(process.cwd(), fileName))
      .then(function (result) {
        console.log('CSSIFY:CORE', fileName)
        return wrapCss(
          fileName,
          result.injectableSource,
          options,
          result.exportTokens
        )
      })
  }

  return Promise.resolve(wrapCss(fileName, source, options))
}


function normalize (opts: CssifyOptions) {
  opts = Object.assign({}, opts)

  if (typeof opts['auto-inject'] === 'undefined') {
    opts['auto-inject'] = true
  }

  if (opts['no-auto-inject']) {
    opts['auto-inject'] = false
    delete opts['no-auto-inject']
  }

  if (opts.test) {
    if (typeof opts.test === 'string') {
      opts.test = stringToRegExp(opts.test)
    }
  } else {
    opts.test = cssRE
  }

  return opts
}

function skipIt (fileName, opts: CssifyOptions) {
  if (typeof opts.test === 'function') {
    if (!opts.test(fileName)) {
      return true
    }
  } else if (opts.test instanceof RegExp) {
    if (!opts.test.test(fileName)) {
      return true
    }
  }

  return false
}

function stringToRegExp (str) {
  var match = RegExpRE.exec(str)
  if (!match) return

  var re = match[1]
  var flags = match[2]
  return new RegExp(re, flags)
}


function cssify (fileName, opts: CssifyOptions) {
  opts = normalize(opts)

  if (skipIt(fileName, opts)) return through()

  var chunks = []

  return through(
    function (chunk, enc, next) {
      chunks.push(chunk)
      next()
    },
    function (done) {
      var buffer = Buffer.concat(chunks)
      var source = buffer.toString('utf-8')

      processCss(fileName, source, opts).then(function (moduleSource) {
        this.push(moduleSource)
        done()
      }.bind(this))
      .catch(done)
    }
  )
}

export default cssify