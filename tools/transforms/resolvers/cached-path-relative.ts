
//var path = require('path')

import path from 'path'


var lastCwd = process.cwd()
var pathCache = Object.create(null)

/* -------------------------------------------------------------------------- */
/*                            cached path relative                            */
/* -------------------------------------------------------------------------- */
function cachedPathRelative (from, to) {
  var cwd = process.cwd()
  if (cwd !== lastCwd) {
    pathCache = {}
    lastCwd = cwd
  }
  if (pathCache[from] && pathCache[from][to]) return pathCache[from][to]
  var result = path.relative.call(path, from, to)
  pathCache[from] = pathCache[from] || {}
  pathCache[from][to] = result
  return result

}

export default cachedPathRelative
