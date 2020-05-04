import * as acorn from "acorn";
import { Options } from "acorn";
import * as walk from "./walk";

type Modules = { 
    strings: [],
    expressions: [],
    nodes?: []
};

var requireRe = /\brequire\b/;

function defined(...args) {
  for (var i = 0; i < args.length; i++) {
    if (args[i] !== undefined) return args[i];
  }
}



function parse(src, opts) {
  if (!opts) opts = {};
  var acornOpts: Options = {
    ranges: defined(opts.ranges, opts.range),
    locations: defined(opts.locations, opts.loc),
    allowReserved: defined(opts.allowReserved, true),
    allowImportExportEverywhere: defined(
      opts.allowImportExportEverywhere,
      false
    ),
  };

  // Use acorn-node's defaults for the rest.
  if (opts.ecmaVersion != null) acornOpts.ecmaVersion = opts.ecmaVersion;
  if (opts.sourceType != null) acornOpts.sourceType = opts.sourceType;
  if (opts.allowHashBang != null) acornOpts.allowHashBang = opts.allowHashBang;
  if (opts.allowReturnOutsideFunction != null)
    acornOpts.allowReturnOutsideFunction = opts.allowReturnOutsideFunction;

  return acorn.parse(src, acornOpts);
}

function detective(src, opts) {
  return detective.find(src, opts).strings;
}

detective.find = function (src, opts) {
  if (!opts) opts = {};

  var word = opts.word === undefined ? "require" : opts.word;
  if (typeof src !== "string") src = String(src);

  var isRequire =
    opts.isRequire ||
    function (node) {
      return node.callee.type === "Identifier" && node.callee.name === word;
    };

  var modules: Modules = { 
      strings: [],
      expressions: []
    };
  if (opts.nodes) modules.nodes = [];

  var wordRe = word === "require" ? requireRe : RegExp("\\b" + word + "\\b");
  
  if (!wordRe.test(src)) return modules;

  var ast = parse(src, opts.parse);

  function visit(node, st, c) {
    var hasRequire = wordRe.test(src.slice(node.start, node.end));
    if (!hasRequire) return;
    walk.base[node.type](node, st, c);
    if (node.type !== "CallExpression") return;
    if (isRequire(node)) {
      if (node.arguments.length) {
        var arg = node.arguments[0];
        
        if (arg.type === "Literal") {
          //@ts-ignore
          modules.strings.push(arg.value);
        } 

        else if (
          arg.type === "TemplateLiteral" &&
          arg.quasis.length === 1 &&
          arg.expressions.length === 0
        ) {
            //@ts-ignore
          modules.strings.push(arg.quasis[0].value.raw);
        } else {
            //@ts-ignore
          modules.expressions.push(src.slice(arg.start, arg.end));
        }
      }
      //@ts-ignore
      if (opts.nodes) modules.nodes.push(node);
    }
  }

  walk.recursive(ast, null, {
    Statement: visit,
    Expression: visit,
  });

  return modules;
};


export default detective
export {detective}