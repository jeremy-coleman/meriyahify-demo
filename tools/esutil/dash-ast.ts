
function dashAst (ast, cb) {
  if (typeof cb === 'object') {
    walk(ast, null, cb.enter || undefined, cb.leave || undefined)
  } 
  else {
    walk(ast, null, cb, undefined)
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

function isNode (node) {
  return typeof node === 'object' && node && typeof node.type === 'string'
}

function has (obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop)
}

export {dashAst, dashAst as default}