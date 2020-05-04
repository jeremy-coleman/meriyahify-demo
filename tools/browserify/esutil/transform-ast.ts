
//var acorn = require('acorn')
import * as acorn from 'acorn'

import MagicString from './magic-string'
import { convert as convertSourceMap, merge as mergeSourceMap } from './sm-helpers'
import {dashAst} from './dash-ast'

function isBuffer (obj) {
    return obj != null && obj.constructor != null &&
      typeof obj.constructor.isBuffer === 'function' && obj.constructor.isBuffer(obj)
}

function astTransform (source, options, cb) {
  if (typeof options === 'function') {
    cb = options
    options = {}
  }
  if (typeof source === 'object' && !isBuffer(source)) {
    options = source
  }
  if (!options) options = {}
  if (options.source) {
    source = options.source
    delete options.source
  }
  if (isBuffer(source)) {
    source = source.toString('utf8')
  }

  var parse = (options.parser || acorn).parse

  var inputMap = convertSourceMap.fromSource(source)
  source = convertSourceMap.removeComments(source)
  var string = new MagicString(source, options)
  var ast = options.ast ? options.ast : parse(source, options)

  dashAst(ast, {
    enter: function (node, parent) {
      string.addSourcemapLocation(node.start)
      string.addSourcemapLocation(node.end)

      node.parent = parent
      if (node.edit === undefined) {
        addHelpers(node)
      }
    },
    leave: cb
  })

  var toString = string.toString.bind(string);

  //@ts-ignore
  string.toString = function (opts) {
    var src = toString()
    if (opts && opts.map) {
      src += '\n' + convertSourceMap.fromObject(getSourceMap()).toComment() + '\n'
    }
    return src
  }

  //@ts-ignore
  string.inspect = toString;

  //@ts-ignore
  string.walk = function (cb) {
    dashAst(ast, {
      enter: function (node, parent) {
        node.parent = parent
        if (node.edit === undefined) {
          addHelpers(node)
        }
      },
      leave: cb
    })
  }

  Object.defineProperty(string, 'map', {
    get: getSourceMap
  })

  return string

  function getSourceMap () {
    if (inputMap) inputMap = inputMap.toObject()

    var magicMap = string.generateMap({
      source: options.inputFilename || 'input.js',
      includeContent: true
    })

    if (inputMap) {
      return mergeSourceMap(inputMap, magicMap)
    }

    return magicMap
  }

  function addHelpers (node) {
    var edit = new Helpers(node, string)
    node.edit = edit
    node.getSource = edit.source.bind(edit)
    if (node.update === undefined) node.update = edit.update.bind(edit)
    if (node.source === undefined) node.source = edit.source.bind(edit)
    if (node.append === undefined) node.append = edit.append.bind(edit)
    if (node.prepend === undefined) node.prepend = edit.prepend.bind(edit)
  }
}

function Helpers (node, string) {
  this.node = node
  this.string = string
}
Helpers.prototype.source = function source () {
  return this.string.slice(this.node.start, this.node.end)
}
Helpers.prototype.update = function update (replacement) {
  this.string.overwrite(this.node.start, this.node.end, replacement)
  return this
}
Helpers.prototype.append = function append (append) {
  this.string.appendLeft(this.node.end, append)
  return this
}
Helpers.prototype.prepend = function prepend (prepend) {
  this.string.prependRight(this.node.start, prepend)
  return this
}
Helpers.prototype.inspect = function () { return '[Helpers]' }


export default astTransform

export {astTransform}