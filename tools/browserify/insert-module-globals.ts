import { parse } from 'acorn';
import { isBuffer } from "util";
import { create, removeComments } from './esutil/sm-helpers';
import { through } from './streams';
import path from 'path'
import assert from 'assert'


var processPath = require.resolve('./compats/process.js');
//var combineSourceMap = require('./combine-source-map');


/* -------------------------------------------------------------------------- */
/*                               undeclaredIdentifiers                        */
/* -------------------------------------------------------------------------- */
function isNode (node) {
  return typeof node === 'object' && node && typeof node.type === 'string'
}




function dashAst (ast, cb) {
  assert(ast && typeof ast === 'object' && typeof ast.type === 'string',
    'dash-ast: ast must be an AST node')

  if (typeof cb === 'object') {
    assert(typeof cb.enter === 'function' || typeof cb.leave === 'function',
      'dash-ast: visitor must be an object with enter/leave functions')

    walk(ast, null, cb.enter || undefined, cb.leave || undefined)
  } else {
    assert(cb && typeof cb === 'function',
      'dash-ast: callback must be a function')

    walk(ast, null, cb, undefined)
  }
}

/**
 * Call `cb` on each node in `ast`. Each node will have a `.parent` property.
 */
dashAst.withParent = function dashAstParent (ast, cb) {
  assert(ast && typeof ast === 'object' && typeof ast.type === 'string',
    'dash-ast.withParent: ast must be an AST node')

  if (typeof cb === 'object') {
    assert(typeof cb.enter === 'function' || typeof cb.leave === 'function',
      'dash-ast.withParent: visitor must be an object with enter/leave functions')

    var enter = cb.enter
    var leave = cb.leave
    walk(ast, null, function (node, parent) {
      node.parent = parent
      if (enter !== undefined) return enter(node)
    }, leave ? function (node) { leave(node) } : undefined)
  } else {
    assert(cb && typeof cb === 'function',
      'dash-ast.withParent: callback must be a function')

    walk(ast, null, function (node, parent) {
      node.parent = parent
      return cb(node)
    }, undefined)
  }
}

function walk (node, parent, enter, leave) {
  var cont = enter !== undefined ? enter(node, parent) : undefined
  if (cont === false) return

  for (var k in node) {
    if (has(node, k)) {
      if (k === 'parent') continue
      if (isNode(node[k])) {
        walk(node[k], node, enter, leave)
      } else if (Array.isArray(node[k])) {
        walkArray(node[k], node, enter, leave)
      }
    }
  }

  if (leave !== undefined) leave(node, parent)
}

function walkArray (nodes, parent, enter, leave) {
  for (var i = 0; i < nodes.length; i++) {
    if (isNode(nodes[i])) walk(nodes[i], parent, enter, leave)
  }
}



/**
 * Get a list of all identifiers that are initialised by this (possibly destructuring)
 * node.
 * eg with input: var { a: [b, ...c], d } = xyz returns the nodes for 'b', 'c', and 'd'
 */
function getAssignedIdentifiers (node, identifiers?) {
  assert.equal(typeof node, 'object', 'get-assigned-identifiers: node must be object')
  assert.equal(typeof node.type, 'string', 'get-assigned-identifiers: node must have a type')

  identifiers = identifiers || []

  if (node.type === 'ImportDeclaration') {
    node.specifiers.forEach(function (el) {
      getAssignedIdentifiers(el, identifiers)
    })
  }

  if (node.type === 'ImportDefaultSpecifier' || node.type === 'ImportNamespaceSpecifier' || node.type === 'ImportSpecifier') {
    node = node.local
  }

  if (node.type === 'RestElement') {
    node = node.argument
  }

  if (node.type === 'ArrayPattern') {
    node.elements.forEach(function (el) {
      // `el` might be `null` in case of `[x,,y] = whatever`
      if (el) {
        getAssignedIdentifiers(el, identifiers)
      }
    })
  }

  if (node.type === 'ObjectPattern') {
    node.properties.forEach(function (prop) {
      if (prop.type === 'Property') {
        getAssignedIdentifiers(prop.value, identifiers)
      } else if (prop.type === 'RestElement') {
        getAssignedIdentifiers(prop, identifiers)
      }
    })
  }

  if (node.type === 'Identifier') {
    identifiers.push(node)
  }

  return identifiers
}


function visitFunction (node, state, ancestors) {
  if (node.params.length > 0) {
    var idents = []
    for (var i = 0; i < node.params.length; i++) {
      var sub = getAssignedIdentifiers(node.params[i])
      for (var j = 0; j < sub.length; j++) idents.push(sub[j])
    }
    declareNames(node, idents)
  }
  if (node.type === 'FunctionDeclaration') {
    var parent = getScopeNode(ancestors, 'const')
    declareNames(parent, [node.id])
  } else if (node.type === 'FunctionExpression' && node.id) {
    declareNames(node, [node.id])
  }
}

var scopeVisitor = {
  VariableDeclaration: function (node, state, ancestors) {
    var parent = getScopeNode(ancestors, node.kind)
    for (var i = 0; i < node.declarations.length; i++) {
      declareNames(parent, getAssignedIdentifiers(node.declarations[i].id))
    }
  },
  FunctionExpression: visitFunction,
  FunctionDeclaration: visitFunction,
  ArrowFunctionExpression: visitFunction,
  ClassDeclaration: function (node, state, ancestors) {
    var parent = getScopeNode(ancestors, 'const')
    if (node.id) {
      declareNames(parent, [node.id])
    }
  },
  ImportDeclaration: function (node, state, ancestors) {
    declareNames(ancestors[0] /* root */, getAssignedIdentifiers(node))
  },
  CatchClause: function (node) {
    if (node.param) declareNames(node, [node.param])
  }
}

var bindingVisitor = {
  Identifier: function (node, state, ancestors) {
    if (!state.identifiers) return
    var parent = ancestors[ancestors.length - 1]
    if (parent.type === 'MemberExpression' && parent.property === node) return
    if (parent.type === 'Property' && !parent.computed && parent.key === node) return
    if (parent.type === 'MethodDefinition' && !parent.computed && parent.key === node) return
    if (parent.type === 'LabeledStatement' && parent.label === node) return
    if (!has(state.undeclared, node.name)) {
      for (var i = ancestors.length - 1; i >= 0; i--) {
        if (ancestors[i]._names !== undefined && has(ancestors[i]._names, node.name)) {
          return
        }
      }

      state.undeclared[node.name] = true
    }

    if (state.wildcard &&
        !(parent.type === 'MemberExpression' && parent.object === node) &&
        !(parent.type === 'VariableDeclarator' && parent.id === node) &&
        !(parent.type === 'AssignmentExpression' && parent.left === node)) {
      state.undeclaredProps[node.name + '.*'] = true
    }
  },
  MemberExpression: function (node, state) {
    if (!state.properties) return
    if (node.object.type === 'Identifier' && has(state.undeclared, node.object.name)) {
      var prop = !node.computed && node.property.type === 'Identifier'
        ? node.property.name
        : node.computed && node.property.type === 'Literal'
          ? node.property.value
          : null
      if (prop) state.undeclaredProps[node.object.name + '.' + prop] = true
    }
  }
}




function undeclaredIdentifiers (src, opts) {
  opts = Object.assign({}, {
    identifiers: true,
    properties: true,
    wildcard: false
  }, opts)

  var state = {
    undeclared: {},
    undeclaredProps: {},
    identifiers: opts.identifiers,
    properties: opts.properties,
    wildcard: opts.wildcard
  }

  // Parse if `src` is not already an AST.
  var ast = typeof src === 'object' && src !== null && typeof src.type === 'string'
    ? src
    : parse(src)

  var parents = []
  dashAst(ast, {
    enter: function (node, parent) {
      if (parent) parents.push(parent)
      var visit = scopeVisitor[node.type]
      if (visit) visit(node, state, parents)
    },
    leave: function (node, parent) {
      var visit = bindingVisitor[node.type]
      if (visit) visit(node, state, parents)
      if (parent) parents.pop()
    }
  })

  return {
    identifiers: Object.keys(state.undeclared),
    properties: Object.keys(state.undeclaredProps)
  }
}

function getScopeNode (parents, kind) {
  for (var i = parents.length - 1; i >= 0; i--) {
    if (parents[i].type === 'FunctionDeclaration' || parents[i].type === 'FunctionExpression' ||
        parents[i].type === 'ArrowFunctionExpression' || parents[i].type === 'Program') {
      return parents[i]
    }
    if (kind !== 'var' && parents[i].type === 'BlockStatement') {
      return parents[i]
    }
  }
}

function declareNames (node, names) {
  if (node._names === undefined) {
    node._names = Object.create(null)
  }
  for (var i = 0; i < names.length; i++) {
    node._names[names[i].name] = true
  }
}

function has (obj, name) { return Object.prototype.hasOwnProperty.call(obj, name) }



function isbufferPath(obj) {
    return obj != null && (_isBuffer(obj) || _isSlowBuffer(obj) || !!obj._isBuffer)
  }
  
  function _isBuffer (obj) {
    return !!obj.constructor && typeof obj.constructor.isBuffer === 'function' && obj.constructor.isBuffer(obj)
  }
  
  // For Node v0.10 support. Remove this eventually.
  function _isSlowBuffer (obj) {
    return typeof obj.readFloatLE === 'function' && typeof obj.slice === 'function' && isBuffer(obj.slice(0, 0))
  }

/* -------------------------------------------------------------------------- */
/*                            insert-module-globals                           */
/* -------------------------------------------------------------------------- */

function getRelativeRequirePath(fullPath, fromPath) {
  var relpath = path.relative(path.dirname(fromPath), fullPath);
  // If fullPath is in the same directory or a subdirectory of fromPath,
  // relpath will result in something like "index.js", "src/abc.js".
  // require() needs "./" prepended to these paths.
  if (!/^\./.test(relpath) && !path.isAbsolute(relpath)) {
    relpath = "./" + relpath;
  }
  // On Windows: Convert path separators to what require() expects
  if (path.sep === '\\') {
    relpath = relpath.replace(/\\/g, '/');
  }
  return relpath;
}

var defaultVars = {
    process: function (file) {
        var relpath = getRelativeRequirePath(processPath, file);
        return 'require(' + JSON.stringify(relpath) + ')';
    },
    global: function () {
        return 'typeof global !== "undefined" ? global : '
            + 'typeof self !== "undefined" ? self : '
            + 'typeof window !== "undefined" ? window : {}'
        ;
    },
    'Buffer.isBuffer': function (file) {
        var relpath = getRelativeRequirePath(isbufferPath, file);
        return 'require(' + JSON.stringify(relpath) + ')';
    },
    Buffer: function () {
        return 'require("buffer").Buffer';
    },
    setImmediate: function () {
        return 'require("timers").setImmediate';
    },
    clearImmediate: function () {
        return 'require("timers").clearImmediate';
    },
    __filename: function (file, basedir) {
        var relpath = path.relative(basedir, file);
        // standardize path separators, use slash in Windows too
        if ( path.sep === '\\' ) {
          relpath = relpath.replace(/\\/g, '/');
        }
        var filename = '/' + relpath;
        return JSON.stringify(filename);
    },
    __dirname: function (file, basedir) {
        var relpath = path.relative(basedir, file);
        // standardize path separators, use slash in Windows too
        if ( path.sep === '\\' ) {
          relpath = relpath.replace(/\\/g, '/');
        }
        var dir = path.dirname('/' + relpath );
        return JSON.stringify(dir);
    }
};

function insertModuleGlobals(file, opts) {
    if (/\.json$/i.test(file)) return through();
    if (!opts) opts = {};
    
    var basedir = opts.basedir || '/';
    var vars = Object.assign({}, defaultVars, opts.vars);
    var varNames = Object.keys(vars).filter(function(name) {
        return typeof vars[name] === 'function';
    });
    
    var quick = RegExp(varNames.map(function (name) {
        return '\\b' + name + '\\b';
    }).join('|'));
    
    var chunks = [];
    
    return through(write, end);
    
    function write (chunk, enc, next) { chunks.push(chunk); next() }
    
    function end () {
        var self = this;
        var source = Buffer.isBuffer(chunks[0])
            ? Buffer.concat(chunks).toString('utf8')
            : chunks.join('')
        ;
        source = source
            .replace(/^\ufeff/, '')
            .replace(/^#![^\n]*\n/, '\n');
        
        if (opts.always !== true && !quick.test(source)) {
            this.push(source);
            this.push(null);
            return;
        }
        
        try {
            var undeclared = opts.always
                ? { identifiers: varNames, properties: [] }
                : undeclaredIdentifiers(parse(source), { wildcard: true })
            ;
        }
        catch (err) {
            var e:any = new SyntaxError(
                (err.message || err) + ' while parsing ' + file
            );
            e.type = 'syntax';
            e.filename = file;
            return this.emit('error', e);
        }
        
        var globals = {};
        
        varNames.forEach(function (name) {
            if (!/\./.test(name)) return;
            var parts = name.split('.')
            var prop = undeclared.properties.indexOf(name)
            if (prop === -1 || countprops(undeclared.properties, parts[0]) > 1) return;
            var value = vars[name](file, basedir);
            if (!value) return;
            globals[parts[0]] = '{'
                + JSON.stringify(parts[1]) + ':' + value + '}';
            self.emit('global', name);
        });
        varNames.forEach(function (name) {
            if (/\./.test(name)) return;
            if (globals[name]) return;
            if (undeclared.identifiers.indexOf(name) < 0) return;
            var value = vars[name](file, basedir);
            if (!value) return;
            globals[name] = value;
            self.emit('global', name);
        });
        
        this.push(closeOver(globals, source, file, opts));
        this.push(null);
    }
};

insertModuleGlobals.vars = defaultVars;

function closeOver (globals, src, file, opts) {
    var keys = Object.keys(globals);
    if (keys.length === 0) return src;
    var values = keys.map(function (key) { return globals[key] });
    
    var wrappedSource;
    if (keys.length <= 3) {
        wrappedSource = '(function (' + keys.join(',') + '){\n'
            + src + '\n}).call(this,' + values.join(',') + ')'
        ;
    }
    else {
      // necessary to make arguments[3..6] still work for workerify etc
      // a,b,c,arguments[3..6],d,e,f...
      var extra = [ '__argument0', '__argument1', '__argument2', '__argument3' ];
      var names = keys.slice(0,3).concat(extra).concat(keys.slice(3));
      values.splice(3, 0,
          'arguments[3]','arguments[4]',
          'arguments[5]','arguments[6]'
      );
      wrappedSource = '(function (' + names.join(',') + '){\n'
        + src + '\n}).call(this,' + values.join(',') + ')';
    }

    // Generate source maps if wanted. Including the right offset for
    // the wrapped source.
    if (!opts.debug) {
        return wrappedSource;
    }
    var sourceFile = path.relative(opts.basedir, file)
        .replace(/\\/g, '/');
    var sourceMap = create().addFile(
        { sourceFile: sourceFile, source: src},
        { line: 1 });
    return removeComments(wrappedSource) + "\n"
        + sourceMap.comment();
}

function countprops (props, name) {
    return props.filter(function (prop) {
        return prop.slice(0, name.length + 1) === name + '.';
    }).length;
}

export default insertModuleGlobals
