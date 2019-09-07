
var template = require('@babel/template').default
var syntax = require('@babel/plugin-syntax-dynamic-import').default

const buildImport = template(`(Promise.resolve(require(SOURCE)))`);

module.exports = function() {
  return {
    inherits: syntax,

    visitor: {
        Import(path) {
            path.parentPath.replaceWith(buildImport({
                SOURCE: path.parentPath.node.arguments
            }));
        }
    }
  };
}