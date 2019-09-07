'use strict';

import fs from 'fs'
import path from 'path'

//import sourceMap from './source-map'

var SM = require('./source-map')

var SourceMapGenerator = SM.SourceMapGenerator //require('./source-map').SourceMapGenerator;
var SourceMapConsumer  = SM.SourceMapConsumer //require('./source-map').SourceMapConsumer;


function decodeBase64(base64) {
  return Buffer.from(base64, 'base64').toString();
}

function stripComment(sm) {
  return sm.split(',').pop();
}



function memoize(func, resolver) {
  if (typeof func != 'function' || (resolver && typeof resolver != 'function')) {
    throw new TypeError('Expected a function');
  }
  var memoized = function() {
    var args = arguments
    var key = resolver ? resolver.apply(this, args) : args[0]
    //@ts-ignore
    var cache = memoized.cache;

    if (cache.has(key)) {
      return cache.get(key);
    }
    var result = func.apply(this, args);

    //@ts-ignore
    memoized.cache = cache.set(key, result);
    return result;
  };

  //@ts-ignore
  memoized.cache = new Map();
  return memoized;
}


/* -------------------------------------------------------------------------- */
/*                              inline-source-map                             */
/* -------------------------------------------------------------------------- */

function offsetMapping(mapping, offset) {
  return { line: offset.line + mapping.line, column: offset.column + mapping.column };
}

function newlinesIn(src) {
  if (!src) return 0;
  var newlines = src.match(/\n/g);

  return newlines ? newlines.length : 0;
}
 
function Generator(opts) {
  opts = opts || {};
  this.generator = new SourceMapGenerator({ file: opts.file || '', sourceRoot: opts.sourceRoot || '' });
  this.sourcesContent = undefined;
  this.opts = opts;
}


Generator.prototype.addMappings = function (sourceFile, mappings, offset) { 
  var generator = this.generator; 

  offset = offset || {};
  offset.line = offset.hasOwnProperty('line') ? offset.line : 0;
  offset.column = offset.hasOwnProperty('column') ? offset.column : 0;

  mappings.forEach(function (m) {
    // only set source if we have original position to handle edgecase (see inline-source-map tests)
    generator.addMapping({
        source    :  m.original ? sourceFile : undefined
      , original  :  m.original
      , generated :  offsetMapping(m.generated, offset)
    });
  });
  return this;
};


Generator.prototype.addGeneratedMappings = function (sourceFile, source, offset) {
  var mappings = []
    , linesToGenerate = newlinesIn(source) + 1;

  for (var line = 1; line <= linesToGenerate; line++) {
    var location = { line: line, column: 0 };
    mappings.push({ original: location, generated: location });
  }

  return this.addMappings(sourceFile, mappings, offset);
};


Generator.prototype.addSourceContent = function (sourceFile, sourcesContent) {
  this.sourcesContent = this.sourcesContent || {};
  this.sourcesContent[sourceFile] = sourcesContent;
  return this;
};


Generator.prototype.base64Encode = function () {
  var map = this.toString();
  return Buffer.from(map).toString('base64');
};


Generator.prototype.inlineMappingUrl = function () {
  var charset = this.opts.charset || 'utf-8';
  return '//# sourceMappingURL=data:application/json;charset=' + charset + ';base64,' + this.base64Encode();
};

Generator.prototype.toJSON = function () {
  var map = this.generator.toJSON();
  if (!this.sourcesContent) return map;

  var toSourcesContent = (function (s) {
    if (typeof this.sourcesContent[s] === 'string') {
      return this.sourcesContent[s];
    } else {
      return null;
    }
  }).bind(this);
  map.sourcesContent = map.sources.map(toSourcesContent);
  return map;
};

Generator.prototype.toString = function () {
  return JSON.stringify(this);
};

Generator.prototype._mappings = function () {
  return this.generator._mappings._array;
};

Generator.prototype.gen = function () {
  return this.generator;
};

function createGenerator(opts) { return new Generator(opts); };
createGenerator.Generator = Generator;




/* -------------------------------------------------------------------------- */
/*                               mappingsFromMap                              */
/* -------------------------------------------------------------------------- */

/** @param map {Object} the JSON.parse()'ed map @return {Array} array of mappings */
function mappingsFromMap(map) {
  var consumer = new SourceMapConsumer(map);
  var mappings = [];

  consumer.eachMapping(function (mapping) {
    // only set source if we have original position to handle edgecase (see inline-source-map tests)
    mappings.push({
      original: mapping.originalColumn != null ? {
        column: mapping.originalColumn
      , line: mapping.originalLine
      } : undefined
    , generated: {
        column: mapping.generatedColumn
      , line: mapping.generatedLine
      }
    , source: mapping.originalColumn != null ? mapping.source : undefined
    , name: mapping.name
    });
  });

  return mappings;
}

/* -------------------------------------------------------------------------- */
/*                             combineSourceMap                             */
/* -------------------------------------------------------------------------- */

var pathIsAbsolute = path.isAbsolute
var protocolRx = /^[a-z]+:\/\//;


var rebaseRelativePath: any = memoize(function(sourceFile, relativeRoot, relativePath) {
  if (!relativePath) {
    return relativePath;
  }

  var relativeRootedPath = relativeRoot ? path.join(relativeRoot, relativePath) : relativePath;
  relativeRootedPath = relativeRootedPath.replace(/\\/g, '/');
  sourceFile = sourceFile.replace(/\\/g, '/');

  if (sourceFile === relativeRootedPath ||    // same path,
      pathIsAbsolute(relativeRootedPath) ||   // absolute path, nor
      protocolRx.test(relativeRootedPath)) {  // absolute protocol need rebasing
    return relativeRootedPath;
  }

  // make relative to source file
  return path.join(path.dirname(sourceFile), relativeRootedPath).replace(/\\/g, '/');
}, function(a, b, c) {
  return a + '::' + b + '::' + c;
});

function resolveMap(source) {
  var gen = convert.fromSource(source);
  return gen ? gen.toObject() : null;
}

function hasInlinedSource(existingMap) {
  return existingMap.sourcesContent && !!existingMap.sourcesContent[0];
}

function Combiner(file, sourceRoot) {
  // since we include the original code in the map sourceRoot actually not needed
  this.generator = createGenerator({ file: file || 'generated.js', sourceRoot: sourceRoot });
}

Combiner.prototype._addGeneratedMap = function (sourceFile, source, offset) {
  this.generator.addGeneratedMappings(sourceFile, source, offset);
  this.generator.addSourceContent(sourceFile, source);
  return this;
};

Combiner.prototype._addExistingMap = function (sourceFile, source, existingMap, offset) {
  var mappings = mappingsFromMap(existingMap);

  // add all of the sources from the map
  for (var i = 0, len = existingMap.sources.length; i < len; i++) {
    if (!existingMap.sourcesContent) continue;

    this.generator.addSourceContent(
      rebaseRelativePath(sourceFile, existingMap.sourceRoot, existingMap.sources[i]),
      existingMap.sourcesContent[i]);
  }

  mappings.forEach(function(mapping) {
    this.generator.addMappings(
      rebaseRelativePath(sourceFile, null, mapping.source), [mapping], offset);
  }, this);

  return this;
};

Combiner.prototype.addFile = function (opts, offset) {

  offset = offset || {};
  if (!offset.hasOwnProperty('line'))  offset.line    =  0;
  if (!offset.hasOwnProperty('column')) offset.column =  0;

  var existingMap = resolveMap(opts.source);

  return existingMap && hasInlinedSource(existingMap)
    ? this._addExistingMap(opts.sourceFile, opts.source, existingMap, offset)
    : this._addGeneratedMap(opts.sourceFile, opts.source, offset);
};

Combiner.prototype.base64 = function () {
  return this.generator.base64Encode();
};

Combiner.prototype.comment = function () {
  return this.generator.inlineMappingUrl();
};

const create = function (file?, sourceRoot?) { return new Combiner(file, sourceRoot); };

const removeComments = function (src) {
  if (!src.replace) return src;
  return src.replace(commentRegex, '').replace(mapFileCommentRegex, '');
};




// var commentRx = /^\s*\/(?:\/|\*)[@#]\s+sourceMappingURL=data:(?:application|text)\/json;(?:charset[:=]\S+;)?base64,(.*)$/mg;
// var mapFileCommentRx =
//   //Example (Extra space between slashes added to solve Safari bug. Exclude space in production):
//   //     / /# sourceMappingURL=foo.js.map           /*# sourceMappingURL=foo.js.map */
//   /(?:\/\/[@#][ \t]+sourceMappingURL=([^\s'"]+?)[ \t]*$)|(?:\/\*[@#][ \t]+sourceMappingURL=([^\*]+?)[ \t]*(?:\*\/){1}[ \t]*$)/mg
// var commentRegex = commentRx

export const mapFileCommentRegex = new RegExp(/(?:\/\/[@#][ \t]+sourceMappingURL=([^\s'"`]+?)[ \t]*$)|(?:\/\*[@#][ \t]+sourceMappingURL=([^\*]+?)[ \t]*(?:\*\/){1}[ \t]*$)/mg)

export const commentRegex = new RegExp(/^\s*\/(?:\/|\*)[@#]\s+sourceMappingURL=data:(?:application|text)\/json;(?:charset[:=]\S+?;)?base64,(?:.*)$/mg)

function readFromFileMap(sm, dir) {
  // NOTE: this will only work on the server since it attempts to read the map file

  var r = mapFileCommentRegex.exec(sm);

  // for some odd reason //# .. captures in 1 and /* .. */ in 2
  var filename = r[1] || r[2];
  var filepath = path.resolve(dir, filename);

  try {
    return fs.readFileSync(filepath, 'utf8');
  } catch (e) {
    throw new Error('An error occurred while trying to read the map file at ' + filepath + '\n' + e);
  }
}


type ConverterOptions = {
  isFileComment? : any,
  commentFileDir?: any,
  hasComment?: any,
  isEncoded?: any,
  isJSON?: any
}

class Converter {
  sourcemap: any;

  constructor(sm, opts: ConverterOptions = {}) {
  opts = opts || {};

  if (opts.isFileComment) sm = readFromFileMap(sm, opts.commentFileDir);
  if (opts.hasComment) sm = stripComment(sm);
  if (opts.isEncoded) sm = decodeBase64(sm);
  if (opts.isJSON || opts.isEncoded) sm = JSON.parse(sm);

  this.sourcemap = sm;
}

toJSON = function (space) {
  return JSON.stringify(this.sourcemap, null, space);
};

toBase64 = function () {
  var json = this.toJSON();
  return Buffer.from(json, 'utf8').toString('base64');
};

toComment = function (options?) {
  var base64 = this.toBase64();
  var data = 'sourceMappingURL=data:application/json;charset=utf-8;base64,' + base64;
  return options && options.multiline ? '/*# ' + data + ' */' : '//# ' + data;
};

// returns copy instead of original
toObject = function () {
  return JSON.parse(this.toJSON());
};

addProperty = function (key, value) {
  if (this.sourcemap.hasOwnProperty(key)) throw new Error('property "' + key + '" already exists on the sourcemap, use set property instead');
  return this.setProperty(key, value);
};

setProperty = function (key, value) {
  this.sourcemap[key] = value;
  return this;
};

getProperty = function (key) {
  return this.sourcemap[key];
};


get getCommentRegex () {
    return /^\s*\/(?:\/|\*)[@#]\s+sourceMappingURL=data:(?:application|text)\/json;(?:charset[:=]\S+?;)?base64,(?:.*)$/mg;
  }


get getMapFileCommentRegex () {
    // Matches sourceMappingURL in either // or /* comment styles.
    return /(?:\/\/[@#][ \t]+sourceMappingURL=([^\s'"`]+?)[ \t]*$)|(?:\/\*[@#][ \t]+sourceMappingURL=([^\*]+?)[ \t]*(?:\*\/){1}[ \t]*$)/mg;
  }

}

var fromObject = function (obj) {
  return new Converter(obj);
};

var fromJSON = function (json) {
  return new Converter(json, { isJSON: true });
};

var fromBase64 = function (base64) {
  return new Converter(base64, { isEncoded: true });
};

var fromComment = function (comment) {
  comment = comment
    .replace(/^\/\*/g, '//')
    .replace(/\*\/$/g, '');

  return new Converter(comment, { isEncoded: true, hasComment: true });
};

var fromMapFileComment = function (comment, dir) {
  return new Converter(comment, { commentFileDir: dir, isFileComment: true, isJSON: true });
};

// Finds last sourcemap comment in file or returns null if none was found
var fromSource = function (content) {
  var m = content.match(commentRegex);
  return m ? fromComment(m.pop()) : null;
};

// Finds last sourcemap comment in file or returns null if none was found
var fromMapFileSource = function (content, dir) {
  var m = content.match(mapFileCommentRegex);
  return m ? fromMapFileComment(m.pop(), dir) : null;
};

var _convert_removeComments = function (src) {
  return src.replace(commentRegex, '');
};

var removeMapFileComments = function (src) {
  return src.replace(mapFileCommentRegex, '');
};

var generateMapFileComment = function (file, options) {
  var data = 'sourceMappingURL=' + file;
  return options && options.multiline ? '/*# ' + data + ' */' : '//# ' + data;
};

const convert = {
  Converter,
  generateMapFileComment,
  removeMapFileComments,
  removeComments: _convert_removeComments,
  fromMapFileSource,
  fromSource,
  fromMapFileComment,
  fromComment,
  fromObject,
  fromJSON,
  fromBase64,
  commentRegex,
  mapFileCommentRegex
}



function offsetSourceMaps (incomingSourceMap, lineOffset) {
    var consumer = new SourceMapConsumer(incomingSourceMap);
    var generator = new SourceMapGenerator({
        file: incomingSourceMap.file,
        sourceRoot: incomingSourceMap.sourceRoot
    });
    consumer.eachMapping(function (m) {
        // skip invalid (not-connected) mapping
        // refs: https://github.com/mozilla/source-map/blob/182f4459415de309667845af2b05716fcf9c59ad/lib/source-map-generator.js#L268-L275
        if (typeof m.originalLine === 'number' && 0 < m.originalLine &&
            typeof m.originalColumn === 'number' && 0 <= m.originalColumn &&
            m.source) {
            generator.addMapping({
                source: m.source,
                name: m.name,
                original: { line: m.originalLine, column: m.originalColumn },
                generated: { line: m.generatedLine + lineOffset, column: m.generatedColumn }
            });
        }
    });
    var outgoingSourceMap = JSON.parse(generator.toString());
    if (typeof incomingSourceMap.sourcesContent !== undefined) {
        outgoingSourceMap.sourcesContent = incomingSourceMap.sourcesContent;
    }
    return outgoingSourceMap;
};





function dedent(
  strings: string | Array<string>,
  ...values: Array<string>
) {
  // $FlowFixMe: Flow doesn't undestand .raw
  //@ts-ignore
  const raw = typeof strings === "string" ? [strings] : strings.raw;

  // first, perform interpolation
  let result = "";
  for (let i = 0; i < raw.length; i++) {
    result += raw[i]
      // join lines when there is a suppressed newline
      .replace(/\\\n[ \t]*/g, "")
      // handle escaped backticks
      .replace(/\\`/g, "`");

    if (i < values.length) {
      result += values[i];
    }
  }

  // now strip indentation
  const lines = result.split("\n");
  let mindent: number | null = null;
  lines.forEach(l => {
    let m = l.match(/^(\s+)\S+/);
    if (m) {
      let indent = m[1].length;
      if (!mindent) {
        // this is the first indented line
        mindent = indent;
      } else {
        mindent = Math.min(mindent, indent);
      }
    }
  });

  if (mindent !== null) {
    const m = mindent; // appease Flow
    result = lines.map(l => l[0] === " " ? l.slice(m) : l).join("\n");
  }

//rm leading and trailing whitespace & escape newlines at the end so they don't get stripped

  return result.trim().replace(/\\n/g, "\n");
}


type SmObject = {
  sourceRoot?: any
  file?: any
} & object;

type SmString = {
  sourceRoot?: any
  file?: any
} & string;

type SM = SmObject | SmString;

function merge(oldMap: SM, newMap: SM): SM | undefined {
  if (!oldMap) return newMap
  if (!newMap) return oldMap

  var oldMapConsumer = new SourceMapConsumer(oldMap)
  var newMapConsumer = new SourceMapConsumer(newMap)
  var mergedMapGenerator = new SourceMapGenerator()

  // iterate on new map and overwrite original position of new map with one of old map
  newMapConsumer.eachMapping(function(m) {
    // pass when `originalLine` is null.
    // It occurs in case that the node does not have origin in original code.
    if (m.originalLine == null) return

    var origPosInOldMap = oldMapConsumer.originalPositionFor({
      line: m.originalLine,
      column: m.originalColumn
    })

    if (origPosInOldMap.source == null) return

    mergedMapGenerator.addMapping({
      original: {
        line: origPosInOldMap.line,
        column: origPosInOldMap.column
      },
      generated: {
        line: m.generatedLine,
        column: m.generatedColumn
      },
      source: origPosInOldMap.source,
      name: origPosInOldMap.name
    })
  })

  var consumers = [oldMapConsumer, newMapConsumer]
  consumers.forEach(function(consumer) {
    consumer.sources.forEach(function(sourceFile) {
      mergedMapGenerator._sources.add(sourceFile)
      var sourceContent = consumer.sourceContentFor(sourceFile)
      if (sourceContent != null) {
        mergedMapGenerator.setSourceContent(sourceFile, sourceContent)
      }
    })
  })

  mergedMapGenerator._sourceRoot = oldMap.sourceRoot
  mergedMapGenerator._file = oldMap.file

  return JSON.parse(mergedMapGenerator.toString())
}


export {
  fromComment,
  create,
  removeComments,
  dedent,
  convert,
  offsetSourceMaps,
  merge
}